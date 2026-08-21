from app.worker import celery_app
from app.database import supabase
from app.prompt_builder import (
    build_prompt,
    build_gpt_instruction,
    build_kontext_instruction,
)
from app.replicate_service import (
    prepare_and_mask,
    run_flux_fill_lora,
    run_flux_control_dev,
    run_flux_kontext,
    run_flux_polish,
    run_gpt_image,
    run_nano_banana,
    run_topaz_upscale,
    NANO_FINISH_PROMPT,
    prepare_regional_masks,
    build_silhouette_mask,
    prepare_render_mask,
    composite_masked,
    composite_bytes_masked,
    union_masks,
)
from app.config import validate_uuid
from app.config_gate import (
    gate_passes,
    glass_hallucination_score,
    structure_edge_miss,
)
import httpx
import uuid
import base64
import logging
import json
import os
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image
import io

logger = logging.getLogger(__name__)

# URL of the Node.js 3D renderer service (set as env var on Railway)
RENDERER_3D_URL = os.environ.get("RENDERER_3D_URL", "http://localhost:3001")

# How the AI treats the 3D composite. The composite is the source of truth — its
# config/placement are already correct — so the AI should ONLY restyle the grey
# sunroom into photoreal glass/aluminum and change nothing else.
#   "full"       → TRUE inpaint (flux-fill-dev) of the sunroom silhouette only;
#                  pixels outside the mask are preserved exactly (your real
#                  photo). Low strength hugs the composite so the config stays
#                  correct. RECOMMENDED.
#   "controlnet" → flux-canny-dev: regenerates the WHOLE frame from edges. Does
#                  NOT preserve the photo and reinvents the config — kept only
#                  for experimentation, not default.
FLUX_REPAINT_MODE = os.environ.get("FLUX_REPAINT_MODE", "full")
#   "photoreal" → HYBRID: ship the geometrically-exact 3D composite as the
#                 deliverable. FLUX_POLISH=true adds a light img2img realism pass
#                 (flux-dev, low prompt_strength) that preserves config; off = the
#                 raw composite (deterministic, zero AI cost).
FLUX_POLISH = os.environ.get("FLUX_POLISH", "false").lower() == "true"
# REGIONAL GLASS composite: keep the AI's photoreal GLASS only (inside the
# renderer's glass-only mask) and take frames/solids/doors/roof + background
# straight from the EXACT 3D composite. The AI (kontext etc.) adds glass realism
# but CANNOT hallucinate config — the composite is the source of truth for every
# non-glass pixel. Works with any AI mode that produces a full-frame output.
REGIONAL_GLASS = os.environ.get("REGIONAL_GLASS", "false").lower() == "true"
# Inpaint denoise strength. The exact mask confines changes to the sunroom, so
# this can run fairly high safely. Too low (~0.4) leaves a faint ghost; ~0.7 is
# a good start for a solid photoreal sunroom. Lower it if the config drifts,
# raise it toward 0.85 if it still looks washed-out. LoRA off (FLUX_FILL_USE_LORA).
FLUX_REPAINT_STRENGTH = float(os.environ.get("FLUX_REPAINT_STRENGTH", "0.85"))
# Manual vertical nudge (feet) to seat the structure on the ground when the
# traced markers sit slightly above the real patio. Positive drops it down.
STRUCTURE_DROP_FT = float(os.environ.get("STRUCTURE_DROP_FT", "0"))
# ── Parallel variations (feature flag + count, one knob) ──────────────────────
# How many photoreal renders to generate per request. The expensive setup
# (prompt, photo resize, 3D composite, mask) runs ONCE; only the AI repaint is
# fanned out, concurrently, with a distinct seed each → the user picks the best.
#   1  → single render, identical to the old behavior, ZERO extra credit spend.
#   5  → five variations in parallel (≈ same wall-clock, ~5× inference credits).
# Set NUM_VARIATIONS in the backend .env. Clamped to a sane [1, 8].
NUM_VARIATIONS = max(1, min(8, int(os.environ.get("NUM_VARIATIONS", "1"))))
# ── Over-generate + auto-filter (OFF by default; FAIL-SAFE) ───────────────────
# When true: generate OVERGEN_POOL variations, score each with app.judge, and keep
# only the best NUM_VARIATIONS — so the gallery never shows an obvious dud. If the
# judge is unavailable or scores too few, we fall back to the first NUM_VARIATIONS
# unfiltered, so this can only ever HIDE bad renders, never make things worse.
# Config-lock (canny) is untouched. Costs ~POOL/NUM_VARIATIONS× more inference.
OVERGEN_FILTER = os.environ.get("OVERGEN_FILTER", "false").lower() == "true"
OVERGEN_POOL = max(NUM_VARIATIONS, min(8, int(os.environ.get("OVERGEN_POOL", str(NUM_VARIATIONS + 2)))))


def _photo_dimensions(photo_bytes: bytes) -> tuple[int, int]:
    img = Image.open(io.BytesIO(photo_bytes))
    return img.size  # (width, height)


def _parse_capture(wall_corners: str) -> tuple[list | None, bool, list | None]:
    """Camera capture JSON → (pts, single_wall, roofline).

    5-point L-shaped capture under "_5pt"; a 1-wall "nook fill" stores the 4
    opening corners under "B" instead (planar pose, only wall B is drawn).
    "_roofline" is the traced existing-roof underside for under-existing rooms.
    """
    if not wall_corners:
        return None, False, None
    try:
        parsed = json.loads(wall_corners)
    except Exception:
        logger.warning("Could not parse wall_corners")
        return None, False, None

    pts, single_wall = None, False
    if "_5pt" in parsed:
        pts = parsed["_5pt"]
    else:
        b = parsed.get("B")
        if isinstance(b, list) and len(b) == 4:
            pts, single_wall = b, True

    roofline = parsed.get("_roofline")
    if not isinstance(roofline, list):
        roofline = None
    return pts, single_wall, roofline


def _render_payload(
    photo_bytes: bytes,
    pts: list,
    single_wall: bool,
    roofline: list | None,
    wall_data: str,
    wall_system: str,
    wall_color: str,
    roof_style: str,
    mount_height: str,
    projection_distance: str,
    include_gable_wings: bool,
    wall_combo: str | None,
    parsed_screen_options,
) -> dict:
    """The /render body for the 3D service. SHARED by the generation task and the
    pre-generation preview so the preview can never show different geometry than
    the render that follows it."""
    photo_w, photo_h = _photo_dimensions(photo_bytes)
    return {
        "photoBase64":       base64.b64encode(photo_bytes).decode(),
        "photoW":            photo_w,
        "photoH":            photo_h,
        "pts":               pts,
        "wallData":          wall_data,
        "wallSystem":        wall_system,
        "wallColor":         wall_color,
        "roofStyle":         roof_style,
        "mountHeight":       mount_height,
        "projectionDistance": projection_distance,
        "dropFt":            STRUCTURE_DROP_FT,
        "roofline":          roofline,
        "includeGableWings": include_gable_wings,
        "wallCombo":         wall_combo,
        "singleWall":        single_wall,
        "screenOptions":     parsed_screen_options,
        "repaintMode":       FLUX_REPAINT_MODE,
    }


def render_composite_preview(
    house_photo_url: str,
    box_x1: float,
    box_y1: float,
    box_x2: float,
    box_y2: float,
    wall_corners: str = "",
    wall_data: str = "",
    wall_system: str = "4_inch",
    roof_style: str = "studio",
    wall_color: str = "white",
    mount_height: str = "",
    projection_distance: str = "",
    include_gable_wings: bool = True,
    wall_combo: str = None,
    screen_options: str = "",
) -> dict:
    """3D composite ONLY — no AI, no credits, no DB writes. Runs synchronously
    (a few seconds) so the configurator can show the salesperson exactly how the
    configured structure sits on the house BEFORE spending a generation.

    Same renderer call the real generation makes (shared _render_payload), so
    what the preview shows is what the generation starts from.
    """
    parsed_screen_options = None
    if screen_options:
        try:
            parsed_screen_options = json.loads(screen_options)
        except Exception:
            logger.warning("preview: could not parse screen_options")

    pts, single_wall, roofline = _parse_capture(wall_corners)
    if pts is None:
        raise ValueError("No perspective markers in wall_corners")

    resized_image_url, _ = prepare_and_mask(
        house_photo_url, box_x1, box_y1, box_x2, box_y2
    )
    with httpx.Client(timeout=30) as client:
        photo_bytes = client.get(resized_image_url).content

    payload = _render_payload(
        photo_bytes, pts, single_wall, roofline, wall_data, wall_system,
        wall_color, roof_style, mount_height, projection_distance,
        include_gable_wings, wall_combo, parsed_screen_options,
    )
    with httpx.Client(timeout=90) as client:
        resp = client.post(
            f"{RENDERER_3D_URL}/render",
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        body = resp.json()
        composite_b64 = body["composite"]

    data = base64.b64decode(composite_b64)
    path = f"debug-composites/preview-{uuid.uuid4()}.jpg"
    supabase.storage.from_("renders").upload(
        path, data, {"content-type": "image/jpeg"}
    )
    # "fit" is how well the CONFIGURED structure matches the plotted markers.
    # Only the preview surfaces it: a bad fit rolls the camera and the whole
    # structure looks tilted, which is impossible to diagnose from the image.
    return {
        "composite_url": supabase.storage.from_("renders").get_public_url(path),
        "fit": body.get("fit"),
    }


@celery_app.task(bind=True, max_retries=0, name="app.tasks.refine_render_task")
def refine_render_task(self, session_id: str, request_text: str,
                       source_render_url: str = None) -> dict:
    """Celery wrapper around refine_render.

    The edit is a full image-model call — measured at ~128s — so holding an HTTP
    request open for it is fragile: a phone locking, a tab sleeping or a dropped
    connection loses the response while the work completes invisibly (exactly
    what happened on the first synchronous version, user 2026-08-20). Same
    pattern as generate_sunroom: the client polls instead.

    Progress lives on the session row's `refine_status` so /refine/status can
    report it without a second table.
    """
    def _set(**fields):
        try:
            supabase.table("configurations").update(fields)                .eq("id", session_id).execute()
        except Exception as e:
            logger.warning(f"[{session_id}] refine status write failed: {e}")

    _set(refine_status="working", refine_error=None)
    try:
        result = refine_render(session_id, request_text, source_render_url)
        _set(refine_status="complete")
        return result
    except Exception as e:
        logger.error(f"[{session_id}] refine failed: {e}")
        _set(refine_status="failed", refine_error=str(e)[:400])
        raise


def refine_render(
    session_id: str,
    request_text: str,
    source_render_url: str = None,
) -> dict:
    """Salesperson-driven follow-up edit of an EXISTING render.

    Feeds the previous RENDER back to the image model (not the composite), so
    everything already correct is preserved and only the requested thing changes
    — the same conversational loop that made ChatGPT feel good to work with.

    Synchronous: one model call, a few seconds, so the client just awaits it. The
    structure mask for the background re-lock is regenerated locally from the
    session's own draft_state — free, no AI, no credits — which is why refining
    does not need the original render's masks to have been stored.

    The salesperson's text is DATA, not instructions to the pipeline: it is
    embedded inside our own scoped sentence, never used as the whole prompt.
    """
    row = supabase.table("configurations").select("*").eq("id", session_id)        .execute().data
    if not row:
        raise ValueError("session not found")
    row = row[0]
    ds = row.get("draft_state") or {}
    meta = ds.get("_meta") or {}

    urls = row.get("render_urls") or ([row["render_url"]] if row.get("render_url") else [])
    src = source_render_url or (urls[-1] if urls else None)
    if not src:
        raise ValueError("no existing render to refine")

    request_text = (request_text or "").strip()
    if not request_text:
        raise ValueError("no change requested")

    prompt = (
        f"In this photo of a sunroom: {request_text}. "
        "Change nothing else — the structure, framing, panel layout, doors, "
        "roof, house, yard and sky all stay exactly as they are."
    )
    logger.info(f"[{session_id}] refine: {prompt}")
    out_url = run_gpt_image(src, prompt)

    # Background re-lock, same as a generate. Rebuild the mask from the config.
    try:
        photo_url = row.get("house_photo_url") or meta.get("photoUri")
        pts, single_wall, roofline = _parse_capture(meta.get("wall_corners") or "")
        if photo_url and pts:
            resized_url, _ = prepare_and_mask(
                photo_url,
                float(meta.get("box_x1") or 0), float(meta.get("box_y1") or 0),
                float(meta.get("box_x2") or 1), float(meta.get("box_y2") or 1),
            )
            with httpx.Client(timeout=30) as c:
                photo_bytes = c.get(resized_url).content
            pl = ds.get("selectedProductLine") or {}
            payload = _render_payload(
                photo_bytes, pts, single_wall, roofline,
                json.dumps(ds.get("walls") or []), pl.get("wall_system") or "4_inch",
                ds.get("wallColor") or "white", ds.get("roofStyle") or "gable",
                str((float(ds.get("mountHeight") or 0)) / 12),
                ds.get("projectionDistance") or "",
                ds.get("includeGableWings", True), ds.get("wallCombo"), None,
            )
            with httpx.Client(timeout=90) as c:
                rr = c.post(f"{RENDERER_3D_URL}/render", json=payload,
                            headers={"Content-Type": "application/json"})
                rr.raise_for_status()
                rj = rr.json()
            smask = base64.b64decode(rj["mask"]) if rj.get("mask") else None
            shmask = base64.b64decode(rj["shadowMask"]) if rj.get("shadowMask") else None
            lock = smask
            if smask and shmask:
                try:
                    lock = union_masks(smask, shmask)
                except Exception:
                    pass
            if lock:
                composited = composite_masked(out_url, photo_bytes, lock)
                path = f"renders/{uuid.uuid4()}.jpg"
                supabase.storage.from_("renders").upload(
                    path, composited, {"content-type": "image/jpeg"}
                )
                out_url = supabase.storage.from_("renders").get_public_url(path)
    except Exception as relock_err:
        # The edit itself is still valid without the re-lock; ship it rather than
        # failing the whole request.
        logger.warning(f"[{session_id}] refine re-lock skipped ({relock_err})")

    # Append, never replace — every version stays reachable in the editor gallery
    # so a bad request costs nothing but the one call.
    new_urls = [*urls, out_url]
    try:
        supabase.table("configurations").update(
            {"render_urls": new_urls, "render_url": out_url}
        ).eq("id", session_id).execute()
    except Exception:
        supabase.table("configurations").update({"render_url": out_url})            .eq("id", session_id).execute()
    return {"render_url": out_url, "render_urls": new_urls}


@celery_app.task(bind=True, max_retries=2, name="app.tasks.generate_sunroom")
def generate_sunroom(
    self,
    session_id: str,
    house_photo_url: str,
    selected_option_ids: list,
    box_x1: float,
    box_y1: float,
    box_x2: float,
    box_y2: float,
    wall_data: str = "",
    wall_system: str = "4_inch",
    roof_style: str = "studio",
    wall_color: str = "white",
    mount_height: str = "",
    projection_distance: str = "",
    roof_only_sub_style: str = None,
    under_existing_shape: str = None,
    include_gable_wings: bool = True,
    wall_combo: str = None,
    wall_corners: str = "",
    screen_options: str = "",
):
    def is_cancelled() -> bool:
        result = supabase.table("configurations")\
            .select("status")\
            .eq("id", session_id)\
            .execute()
        return result.data and result.data[0]["status"] == "cancelled"

    def upload_bytes(data: bytes, ext: str, folder: str) -> str:
        path = f"{folder}/{uuid.uuid4()}.{ext}"
        content_type = "image/jpeg" if ext == "jpg" else "image/png"
        supabase.storage.from_("renders").upload(
            path, data, {"content-type": content_type}
        )
        return supabase.storage.from_("renders").get_public_url(path)

    try:
        validate_uuid(session_id)

        if is_cancelled():
            logger.info(f"[{session_id}] Cancelled before start — aborting")
            return {"status": "cancelled"}

        supabase.table("configurations")\
            .update({"status": "generating"})\
            .eq("id", session_id)\
            .execute()

        # Screen rooms: structure-wide kneewall / chairrail / handrail. None for
        # every other product line, and both the prompt and the renderer treat
        # absent as "draw none". Parsed here because build_prompt needs it below.
        parsed_screen_options = None
        if screen_options:
            try:
                parsed_screen_options = json.loads(screen_options)
            except Exception:
                logger.warning(f"[{session_id}] Could not parse screen_options")

        # ── Step 1: Build prompt ──────────────────────────────────────────────
        logger.info(f"[{session_id}] Building prompt")
        positive_prompt, negative_prompt = build_prompt(
            selected_option_ids,
            wall_data=wall_data,
            roof_style=roof_style,
            wall_system=wall_system,
            wall_color=wall_color,
            under_existing_shape=under_existing_shape,
            include_gable_wings=include_gable_wings,
            wall_combo=wall_combo,
            screen_options=parsed_screen_options,
        )

        if is_cancelled():
            return {"status": "cancelled"}

        # ── Step 2: Resize house photo ────────────────────────────────────────
        logger.info(f"[{session_id}] Resizing house photo")
        resized_image_url, _box_mask_url = prepare_and_mask(
            house_photo_url, box_x1, box_y1, box_x2, box_y2
        )

        # ── Step 3: Download resized photo bytes ──────────────────────────────
        logger.info(f"[{session_id}] Downloading resized photo")
        with httpx.Client(timeout=30) as client:
            photo_bytes = client.get(resized_image_url).content

        photo_w, photo_h = _photo_dimensions(photo_bytes)
        logger.info(f"[{session_id}] Photo dimensions: {photo_w}×{photo_h}")

        if is_cancelled():
            return {"status": "cancelled"}

        # ── Step 4: Parse wall_corners ────────────────────────────────────────
        # Shared with the pre-generation preview (see _parse_capture): 5-point
        # capture, the 1-wall "nook fill" 4-corner form, and the under-existing
        # roofline the renderer clips the walls to.
        pts, single_wall, roofline = _parse_capture(wall_corners)

        # -- Step 5: 3D render via Node.js service --------------------------------
        # The 3D composite is the ONLY supported render path. No 5-point capture,
        # or a renderer failure, is a hard error -- we fail loudly instead of falling
        # back to a geometrically-wrong render. (The old Python fallback had no wall-
        # combo logic and silently produced misaligned structures.)
        if pts is None:
            raise Exception(
                "No 5-point capture in wall_corners -- cannot render without "
                "perspective markers"
            )

        render_mask_bytes = None  # exact structure mask from the renderer, if any
        logger.info(f"[{session_id}] Calling 3D renderer service at {RENDERER_3D_URL}")
        try:
            render_payload = _render_payload(
                photo_bytes, pts, single_wall, roofline, wall_data, wall_system,
                wall_color, roof_style, mount_height, projection_distance,
                include_gable_wings, wall_combo, parsed_screen_options,
            )

            with httpx.Client(timeout=90) as client:
                resp = client.post(
                    f"{RENDERER_3D_URL}/render",
                    json=render_payload,
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
                render_data = resp.json()

            # Renderer returns the composite AND an exact structure mask (white
            # sunroom on black) -- pixel-perfect, immune to the tone-mapping that
            # made diff-based masks flag the whole frame.
            composite_bytes = base64.b64decode(render_data["composite"])
            _render_mask_b64 = render_data.get("mask")
            render_mask_bytes = (
                base64.b64decode(_render_mask_b64) if _render_mask_b64 else None
            )
            # Glass-only mask (white glass on black) for the regional composite.
            # Raw mask feeds the gate + hallucination scorer; the two assembly
            # masks (dilated glass, exact frames) come from prepare_regional_masks.
            _glass_mask_b64 = render_data.get("glassMask")
            glass_mask_bytes = (
                base64.b64decode(_glass_mask_b64) if _glass_mask_b64 else None
            )
            glass_expand_bytes = frames_mask_bytes = None
            if glass_mask_bytes and render_mask_bytes:
                glass_expand_bytes, frames_mask_bytes = prepare_regional_masks(
                    glass_mask_bytes, render_mask_bytes
                )
            # Contact-shadow alpha mask (renderer Pass 4). Unioned into the
            # background re-lock so the shadow survives the photo restore.
            _shadow_mask_b64 = render_data.get("shadowMask")
            shadow_mask_bytes = (
                base64.b64decode(_shadow_mask_b64) if _shadow_mask_b64 else None
            )

            logger.info(
                f"[{session_id}] 3D render succeeded "
                f"(composite {len(composite_bytes)}b, "
                f"mask {'yes' if render_mask_bytes else 'none'})"
            )

            # SINGLE SOURCE OF TRUTH for the wall combo: the renderer returns the
            # combo it ACTUALLY drew (explicit, inferred, or geometric auto-detect).
            # If the prompt was built assuming a different pair, rebuild it -- a prompt
            # describing one wall layout over a composite showing the other makes FLUX
            # repaint a scrambled panel patchwork.
            resolved_combo = render_data.get("combo")
            if resolved_combo in ("AB", "BC") and resolved_combo != wall_combo:
                logger.info(
                    f"[{session_id}] renderer resolved wall combo "
                    f"{resolved_combo} (request had {wall_combo!r}) -- rebuilding prompt"
                )
                positive_prompt, negative_prompt = build_prompt(
                    selected_option_ids,
                    wall_data=wall_data,
                    roof_style=roof_style,
                    wall_system=wall_system,
                    wall_color=wall_color,
                    under_existing_shape=under_existing_shape,
                    include_gable_wings=include_gable_wings,
                    wall_combo=resolved_combo,
                    screen_options=parsed_screen_options,
                )

            # Upload debug composite + mask
            debug_url = upload_bytes(composite_bytes, "jpg", "debug-composites")
            logger.info(f"[{session_id}] DEBUG 3D composite: {debug_url}")
            if render_mask_bytes:
                dbg_mask = upload_bytes(render_mask_bytes, "png", "debug-composites")
                logger.info(f"[{session_id}] DEBUG structure mask: {dbg_mask}")

        except Exception as render_err:
            raise Exception(f"3D renderer failed: {render_err}") from render_err

        if is_cancelled():
            return {"status": "cancelled"}

        # -- Step 6: Build the FLUX mask ------------------------------------------
        # Mask the ENTIRE rendered sunroom silhouette so the model repaints the whole
        # structure photoreal (controlnet also locks geometry via the composite's
        # edges). Prefer the renderer's EXACT structure mask; fall back to the diff-
        # based silhouette only if the renderer didn't supply one.
        inpaint_image_url = upload_bytes(composite_bytes, "jpg", "house-photos")

        if render_mask_bytes:
            mask_bytes, coverage = prepare_render_mask(render_mask_bytes)
            logger.info(f"[{session_id}] Using exact renderer mask, coverage {coverage:.1%}")
        else:
            mask_bytes, coverage = build_silhouette_mask(composite_bytes, photo_bytes)
            logger.info(f"[{session_id}] Diff silhouette mask, coverage {coverage:.1%}")

        silhouette_mask_bytes = None  # kept for the post-repaint composite step
        if coverage < 0.01 or coverage > 0.85:
            # Implausible mask (near-empty, or ballooned to ~whole frame) -- fall back
            # to the structure bounding box rather than wreck the photo.
            logger.warning(
                f"[{session_id}] Mask coverage {coverage:.1%} implausible -- "
                f"falling back to bounding-box mask"
            )
            _, mask_url = prepare_and_mask(
                house_photo_url, box_x1, box_y1, box_x2, box_y2
            )
            # we don't have bytes for the bbox mask here; Step 8 downloads it
        else:
            mask_url = upload_bytes(mask_bytes, "png", "masks")
            silhouette_mask_bytes = mask_bytes

        repaint_strength = FLUX_REPAINT_STRENGTH
        logger.info(f"[{session_id}] DEBUG repaint mask: {mask_url}")

        if is_cancelled():
            return {"status": "cancelled"}

        # ── Steps 7 + 8: AI repaint, fanned out into NUM_VARIATIONS ───────────
        # Everything above (prompt, resized photo, 3D composite, mask) is shared
        # across variations and already done. Only the AI repaint + the
        # background-restore composite differ per variation, so we run them
        # concurrently with a distinct seed each and let the user pick the best.
        #
        # The masked-composite step (Step 8) restores everything outside the
        # sunroom from the ORIGINAL photo, so the house/pool/sky stay pixel-
        # identical and any stray text artifacts are discarded. For controlnet
        # mode this is required (the model renoises the whole frame).
        needs_composite = FLUX_REPAINT_MODE in (
            "full", "controlnet", "kontext", "photoreal", "gpt",
        )

        # Kontext mode: instruction-based image EDIT of the composite. Short
        # instruction — the composite image itself carries the config.
        kontext_instruction = None
        if FLUX_REPAINT_MODE == "gpt":
            # Short on purpose — see build_gpt_instruction.
            kontext_instruction = build_gpt_instruction(wall_system=wall_system)
            logger.info(f"[{session_id}] GPT instruction: {kontext_instruction}")
        elif FLUX_REPAINT_MODE == "kontext":
            kontext_instruction = build_kontext_instruction(
                wall_system=wall_system,
                wall_color=wall_color,
                roof_style=roof_style,
                # Lets the instruction name the ACTUAL solid style (vinyl 4in vs
                # hardieboard 8in courses) and door style (sliding vs hinged vs
                # french). The composite draws these correctly, but without the
                # words the model copied the house's siding and invented door
                # types (user 2026-08-19).
                wall_data=wall_data,
                # Lets the instruction name a door wall by its camera position.
                wall_combo=wall_combo,
            )
            logger.info(f"[{session_id}] Kontext instruction: {kontext_instruction}")

        # Pre-fetch the composite mask ONCE (not per variation) when we'll need it.
        composite_mask_bytes = silhouette_mask_bytes
        if needs_composite and composite_mask_bytes is None:
            try:
                with httpx.Client(timeout=30) as client:
                    composite_mask_bytes = client.get(mask_url).content
            except Exception as mask_err:
                logger.warning(f"[{session_id}] Could not prefetch mask ({mask_err})")

        # Background re-lock mask = structure ∪ contact shadow, so the rendered
        # ground shadow survives the photo restore (the gate and tone-match keep
        # using the pure structure mask — ground pixels stay out of both).
        lock_mask_bytes = composite_mask_bytes
        if composite_mask_bytes is not None and shadow_mask_bytes is not None:
            try:
                lock_mask_bytes = union_masks(composite_mask_bytes, shadow_mask_bytes)
            except Exception as um_err:
                logger.warning(f"[{session_id}] shadow-mask union failed ({um_err})")

        def render_one(index: int, seed: int) -> str:
            """One photoreal variation: AI repaint (Step 7) + background restore
            (Step 8). Returns the final render URL. Raises on failure so the
            caller can skip just this variation."""
            if FLUX_REPAINT_MODE == "photoreal":
                # HYBRID: the 3D composite is already geometrically EXACT. Ship it
                # as the deliverable — optionally through a LIGHT img2img polish
                # (low prompt_strength) that adds photographic realism without
                # redesigning config. The composite step below still restores
                # everything outside the sunroom from the real photo.
                out_url = (
                    run_flux_polish(inpaint_image_url, seed=seed)
                    if FLUX_POLISH
                    else inpaint_image_url
                )
            elif FLUX_REPAINT_MODE == "gpt":
                # OpenAI gpt-image edit. Held the drawn config on a whole-wall
                # door where every Kontext variant and every LoRA checkpoint
                # regularized it away (user A/B, 2026-08-20).
                out_url = run_gpt_image(inpaint_image_url, kontext_instruction)
            elif FLUX_REPAINT_MODE == "kontext":
                # Glass-pass model (bake-off winner 2026-08-15: nano-banana-pro —
                # clearly the most photoreal glass/roof; structure comes from the
                # composite via the regional mask, so its cost buys pure realism).
                glass_model = os.environ.get("GLASS_PASS_MODEL", "")
                if "nano-banana" in glass_model:
                    out_url = run_nano_banana(
                        glass_model, inpaint_image_url, kontext_instruction
                    )
                else:
                    out_url = run_flux_kontext(
                        input_image_url=inpaint_image_url,
                        instruction=kontext_instruction,
                        seed=seed,
                    )
            elif FLUX_REPAINT_MODE == "controlnet":
                out_url = run_flux_control_dev(
                    control_image_url=inpaint_image_url,
                    prompt=positive_prompt,
                    wall_system=wall_system,
                    roof_style=roof_style,
                    seed=seed,
                )
            else:
                out_url = run_flux_fill_lora(
                    image_url=inpaint_image_url,
                    mask_url=mask_url,
                    prompt=positive_prompt,
                    negative_prompt=negative_prompt,
                    wall_system=wall_system,
                    roof_style=roof_style,
                    strength=repaint_strength,
                    seed=seed,
                )

            assembly_bytes = None  # the guaranteed regional assembly (gate reference)
            if REGIONAL_GLASS and glass_expand_bytes is not None:
                # Two-step assembly: (1) AI glass through the DILATED glass mask —
                # covers the pane-edge ring so no composite teal can halo the
                # panes; (2) the composite's exact FRAMES pasted back on top,
                # overwriting any AI bleed. Glass reaches the exact pane edge,
                # frames stay pixel-exact.
                ai_url = out_url
                try:
                    assembly_bytes = composite_masked(
                        out_url, composite_bytes, glass_expand_bytes
                    )
                    assembly_bytes = composite_bytes_masked(
                        composite_bytes, assembly_bytes, frames_mask_bytes
                    )
                    # Background outside structure ∪ shadow → the ORIGINAL photo
                    # pixels (the composite's background is a JPEG-round-tripped
                    # render of it — visibly softer).
                    if lock_mask_bytes is not None:
                        assembly_bytes = composite_bytes_masked(
                            assembly_bytes, photo_bytes, lock_mask_bytes
                        )
                    out_url = upload_bytes(assembly_bytes, "jpg", "renders")
                    logger.info(f"[{session_id}] [v{index}] Regional glass composite applied")
                except Exception as comp_err:
                    logger.warning(
                        f"[{session_id}] [v{index}] Regional glass composite failed "
                        f"({comp_err}) — using raw AI output"
                    )
                # Deterministic seed quality: edge density the AI INVENTED inside
                # glass panes (hallucinated mid-pane mullions). Used by the overgen
                # filter to pick the cleanest seeds — replaces the VLM judge on
                # this path. Non-fatal: unscored seeds just rank last.
                try:
                    with httpx.Client(timeout=60) as _c:
                        _ai_bytes = _c.get(ai_url).content
                    glass_scores[index] = glass_hallucination_score(
                        _ai_bytes, composite_bytes, glass_mask_bytes
                    )
                    logger.info(
                        f"[{session_id}] [v{index}] glass hallucination score "
                        f"{glass_scores[index]:.4f}"
                    )
                except Exception as sc_err:
                    logger.warning(f"[{session_id}] [v{index}] glass score failed: {sc_err}")
            elif needs_composite and composite_mask_bytes is not None:
                try:
                    composited_bytes = composite_masked(
                        out_url, photo_bytes, lock_mask_bytes
                    )
                    out_url = upload_bytes(composited_bytes, "jpg", "renders")
                    logger.info(f"[{session_id}] [v{index}] Masked composite applied")
                except Exception as comp_err:
                    logger.warning(
                        f"[{session_id}] [v{index}] Masked composite failed "
                        f"({comp_err}) — using raw AI output"
                    )

            # Finishing polish (hybrid item 6): a LIGHT img2img pass over the
            # ASSEMBLED image (exact structure + AI glass/roof) to unify it into a
            # single photograph. GATED: the finish is the one place the AI touches
            # structure again, so every polished render is compared to the
            # guaranteed assembly (edge drift in structure-minus-glass). Drift →
            # retry once (new seed, lower strength) → still drift → ship the
            # assembly, which is guaranteed-correct. Skipped in photoreal mode,
            # which already polished the raw composite instead.
            if FLUX_POLISH and FLUX_REPAINT_MODE != "photoreal":
                base_strength = float(os.environ.get("FLUX_FINISH_STRENGTH", "0.2"))
                finish_model = os.environ.get("FINISH_MODEL", "flux-dev")
                for attempt in range(2):
                    strength = max(0.1, base_strength - 0.05 * attempt)
                    try:
                        if "nano-banana" in finish_model:
                            # No strength/seed knobs — a retry is just a fresh
                            # stochastic sample; the gate decides if it held.
                            polished_url = run_nano_banana(
                                finish_model, out_url, NANO_FINISH_PROMPT
                            )
                        else:
                            polished_url = run_flux_polish(
                                out_url, seed=seed + attempt * 1000, strength=strength
                            )
                        if composite_mask_bytes is None:
                            out_url = polished_url  # no mask → no re-lock, no gate
                            break
                        pb = composite_masked(polished_url, photo_bytes, lock_mask_bytes)
                        if assembly_bytes is not None:
                            ok, score = gate_passes(
                                pb, assembly_bytes, composite_mask_bytes, glass_mask_bytes
                            )
                            if not ok:
                                if attempt == 0:
                                    logger.warning(
                                        f"[{session_id}] [v{index}] finish drifted "
                                        f"({score:.3f}) — retrying at {strength - 0.05:.2f}"
                                    )
                                    continue
                                logger.warning(
                                    f"[{session_id}] [v{index}] finish drifted again "
                                    f"({score:.3f}) — shipping guaranteed assembly"
                                )
                                break  # out_url is already the assembly
                        out_url = upload_bytes(pb, "jpg", "renders")
                        logger.info(
                            f"[{session_id}] [v{index}] Finishing polish applied "
                            f"(strength={strength}, attempt={attempt})"
                        )
                        break
                    except Exception as fin_err:
                        logger.warning(
                            f"[{session_id}] [v{index}] Finishing polish failed "
                            f"({fin_err}) — using un-polished composite"
                        )
                        break
            return out_url

        # Over-generate a larger pool when the filter is on, so we can drop duds.
        # photoreal is deterministic (no AI) — one pass, no pool / no filter.
        n = (
            1 if FLUX_REPAINT_MODE == "photoreal"
            else OVERGEN_POOL if OVERGEN_FILTER
            else NUM_VARIATIONS
        )
        base_seed = random.randint(1, 2_000_000_000)
        logger.info(
            f"[{session_id}] Running {n} variation(s) "
            f"(mode={FLUX_REPAINT_MODE}, strength={repaint_strength}"
            f"{', overgen-filter ON' if OVERGEN_FILTER else ''})"
        )

        results: list[str | None] = [None] * n
        glass_scores: dict[int, float] = {}  # index -> in-glass hallucination score
        with ThreadPoolExecutor(max_workers=n) as pool:
            future_to_index = {
                pool.submit(render_one, i, base_seed + i): i for i in range(n)
            }
            for future in as_completed(future_to_index):
                i = future_to_index[future]
                try:
                    results[i] = future.result()
                    logger.info(f"[{session_id}] [v{i}] complete: {results[i]}")
                except Exception as var_err:
                    logger.warning(f"[{session_id}] [v{i}] failed: {var_err}")

        if is_cancelled():
            logger.info(f"[{session_id}] Cancelled after Replicate returned — discarding")
            return {"status": "cancelled"}

        # Keep submission order (variation 0..n-1) so the gallery is stable.
        render_urls = [url for url in results if url]
        if not render_urls:
            raise Exception("all variations failed")

        # Over-generate filter: score the pool, keep the best NUM_VARIATIONS.
        # FAIL-SAFE — if judging is unavailable or scores too few, fall back to the
        # first NUM_VARIATIONS unfiltered. Never shows more than NUM_VARIATIONS.
        #
        # Regional path: rank by the DETERMINISTIC in-glass hallucination score
        # (lower = cleaner panes) instead of the VLM judge — free, instant, and
        # it measures exactly the one thing the AI can still get wrong here.
        # STRUCTURE-FIDELITY RANKING (2026-08-20) — the general config filter.
        # Measured on job 35: identical seeds pass/fail across THREE different LoRA
        # checkpoints, so a wall coming back wrong is sampling variance, not model
        # quality — ~2 in 5 draws hold a hard config. Variance is beaten by
        # selection, so generate a pool and keep the draw that best preserved the
        # DRAWN STRUCTURE. drift_score measures edge disagreement inside
        # structure-minus-glass, which is where every config decision lives:
        # frames, mullions, kneewall bands, transom bands, gable divisions, door
        # stiles. Glass is excluded because reflections legitimately vary.
        #
        # Deliberately NOT door-specific. A door wall was the case that surfaced
        # this, but any config the model regularizes away (a lone solid panel, an
        # odd transom, a wing) moves the same edges and ranks the same way.
        #
        # The absolute number is meaningless here (flat CGI vs a photograph scores
        # ~0.2 even when perfect) — only the ORDER across candidates matters, and
        # they all share the same composite, so the CGI-vs-photo penalty is common
        # to all of them and cancels out of the comparison.
        structure_scores: dict[int, float] = {}
        if (
            OVERGEN_FILTER
            and len(render_urls) > NUM_VARIATIONS
            and composite_bytes is not None
            and render_mask_bytes is not None
        ):
            for i, u in enumerate(results):
                if not u:
                    continue
                try:
                    with httpx.Client(timeout=60) as c:
                        cand = c.get(u).content
                    structure_scores[i] = structure_edge_miss(
                        cand, composite_bytes, render_mask_bytes
                    )
                except Exception as sc_err:
                    logger.warning(
                        f"[{session_id}] structure score failed for v{i}: {sc_err}"
                    )
            if len(structure_scores) >= NUM_VARIATIONS:
                order = sorted(structure_scores, key=lambda i: structure_scores[i])
                kept_idx = sorted(order[:NUM_VARIATIONS])
                logger.info(
                    f"[{session_id}] overgen filter (structure fidelity): kept "
                    f"{kept_idx} of {len(render_urls)} — scores "
                    + ", ".join(
                        f"v{i}={structure_scores[i]:.3f}"
                        + ("  <-- kept" if i in kept_idx else "")
                        for i in sorted(structure_scores)
                    )
                )
                render_urls = [results[i] for i in kept_idx]

        if not structure_scores and (
            OVERGEN_FILTER
            and len(render_urls) > NUM_VARIATIONS
            and REGIONAL_GLASS
            and len(glass_scores) >= NUM_VARIATIONS
        ):
            order = sorted(
                (i for i in range(n) if results[i]),
                key=lambda i: glass_scores.get(i, float("inf")),
            )
            kept_idx = sorted(order[:NUM_VARIATIONS])  # stable gallery order
            logger.info(
                f"[{session_id}] overgen filter (deterministic): kept "
                f"{kept_idx} of {len(render_urls)} "
                f"(scores {[round(glass_scores.get(i, -1), 4) for i in kept_idx]})"
            )
            render_urls = [results[i] for i in kept_idx]
        elif not structure_scores and OVERGEN_FILTER and len(render_urls) > NUM_VARIATIONS:
            try:
                from app.judge import score_render

                scored: list[tuple[float | None, str]] = []
                with ThreadPoolExecutor(max_workers=len(render_urls)) as jpool:
                    jfut = {
                        jpool.submit(score_render, u, positive_prompt): u
                        for u in render_urls
                    }
                    for f in as_completed(jfut):
                        try:
                            scored.append((f.result(), jfut[f]))
                        except Exception:
                            scored.append((None, jfut[f]))
                valid = [(s, u) for s, u in scored if s is not None]
                if len(valid) >= NUM_VARIATIONS:
                    valid.sort(key=lambda x: x[0], reverse=True)
                    kept = [u for _, u in valid[:NUM_VARIATIONS]]
                    logger.info(
                        f"[{session_id}] overgen filter: kept {len(kept)}/"
                        f"{len(render_urls)} (scores "
                        f"{[round(s, 1) for s, _ in valid]})"
                    )
                    render_urls = kept
                else:
                    logger.info(
                        f"[{session_id}] overgen filter: only {len(valid)} scored — "
                        f"showing first {NUM_VARIATIONS} unfiltered"
                    )
                    render_urls = render_urls[:NUM_VARIATIONS]
            except Exception as jerr:
                logger.warning(
                    f"[{session_id}] overgen filter failed ({jerr}) — "
                    f"showing first {NUM_VARIATIONS} unfiltered"
                )
                render_urls = render_urls[:NUM_VARIATIONS]
        elif OVERGEN_FILTER:
            # Pool produced <= NUM_VARIATIONS usable renders; nothing to filter.
            render_urls = render_urls[:NUM_VARIATIONS]

        # Final 2K upscale (topaz CGI: fidelity-only, drift 0.014 in the bake-off)
        # AFTER filtering, so dropped pool seeds never pay for it. Non-fatal per
        # image — an upscale failure ships the 1280px render.
        if os.environ.get("FINAL_UPSCALE", "false").lower() == "true":
            upscaled = []
            for u in render_urls:
                try:
                    up_url = run_topaz_upscale(u)
                    with httpx.Client(timeout=180) as _c:
                        _ub = _c.get(up_url).content
                    upscaled.append(upload_bytes(_ub, "jpg", "renders"))
                except Exception as up_err:
                    logger.warning(f"[{session_id}] upscale failed ({up_err}) — keeping 1280px")
                    upscaled.append(u)
            render_urls = upscaled
            logger.info(f"[{session_id}] Final 2x upscale applied to {len(render_urls)} render(s)")

        primary_url = render_urls[0]
        # Persist the full list in render_urls; keep render_url = first for the
        # screens (quote, session detail) that still read the single column.
        try:
            supabase.table("configurations")\
                .update({
                    "status": "complete",
                    "render_url": primary_url,
                    "render_urls": render_urls,
                })\
                .eq("id", session_id)\
                .execute()
        except Exception as col_err:
            # render_urls column not migrated yet — degrade gracefully to single.
            logger.warning(
                f"[{session_id}] Could not write render_urls ({col_err}) — "
                f"run the migration: ALTER TABLE configurations "
                f"ADD COLUMN render_urls jsonb;"
            )
            supabase.table("configurations")\
                .update({"status": "complete", "render_url": primary_url})\
                .eq("id", session_id)\
                .execute()

        logger.info(
            f"[{session_id}] Generation complete: {len(render_urls)}/{n} "
            f"variation(s), primary {primary_url}"
        )
        return {
            "status": "complete",
            "render_url": primary_url,
            "render_urls": render_urls,
        }

    except Exception as e:
        if is_cancelled():
            logger.info(f"[{session_id}] Exception during cancelled task — suppressing")
            return {"status": "cancelled"}
        logger.error(f"[{session_id}] Generation failed: {str(e)}")
        supabase.table("configurations")\
            .update({"status": "failed"})\
            .eq("id", session_id)\
            .execute()
        raise self.retry(exc=e, countdown=10)
