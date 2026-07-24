from app.worker import celery_app
from app.database import supabase
from app.prompt_builder import build_prompt, build_kontext_instruction
from app.replicate_service import (
    prepare_and_mask,
    run_flux_fill_lora,
    run_flux_control_dev,
    run_flux_kontext,
    build_silhouette_mask,
    prepare_render_mask,
    composite_masked,
)
from app.config import validate_uuid
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
        parsed_corners = None
        if wall_corners:
            try:
                parsed_corners = json.loads(wall_corners)
            except Exception:
                logger.warning(f"[{session_id}] Could not parse wall_corners")

        pts = None
        single_wall = False
        if parsed_corners and "_5pt" in parsed_corners:
            pts = parsed_corners["_5pt"]
        elif parsed_corners:
            # 1-wall "nook fill": the camera stores the 4 opening corners under
            # "B" (no _5pt). Flat single-wall capture — the renderer solves a
            # planar pose and draws only wall B facing the camera.
            b = parsed_corners.get("B")
            if isinstance(b, list) and len(b) == 4:
                pts = b
                single_wall = True

        # Under-existing: the traced existing-roof underside polyline. The renderer
        # clips the walls to it and draws a header beam instead of a new roof.
        roofline = None
        if parsed_corners and isinstance(parsed_corners.get("_roofline"), list):
            roofline = parsed_corners["_roofline"]

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
            photo_b64 = base64.b64encode(photo_bytes).decode()
            render_payload = {
                "photoBase64":       photo_b64,
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
        needs_composite = FLUX_REPAINT_MODE in ("full", "controlnet", "kontext")

        # Kontext mode: instruction-based image EDIT of the composite. Short
        # instruction — the composite image itself carries the config.
        kontext_instruction = None
        if FLUX_REPAINT_MODE == "kontext":
            kontext_instruction = build_kontext_instruction(
                wall_system=wall_system,
                wall_color=wall_color,
                roof_style=roof_style,
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

        def render_one(index: int, seed: int) -> str:
            """One photoreal variation: AI repaint (Step 7) + background restore
            (Step 8). Returns the final render URL. Raises on failure so the
            caller can skip just this variation."""
            if FLUX_REPAINT_MODE == "kontext":
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

            if needs_composite and composite_mask_bytes is not None:
                try:
                    composited_bytes = composite_masked(
                        out_url, photo_bytes, composite_mask_bytes
                    )
                    out_url = upload_bytes(composited_bytes, "jpg", "renders")
                    logger.info(f"[{session_id}] [v{index}] Masked composite applied")
                except Exception as comp_err:
                    logger.warning(
                        f"[{session_id}] [v{index}] Masked composite failed "
                        f"({comp_err}) — using raw AI output"
                    )
            return out_url

        # Over-generate a larger pool when the filter is on, so we can drop duds.
        n = OVERGEN_POOL if OVERGEN_FILTER else NUM_VARIATIONS
        base_seed = random.randint(1, 2_000_000_000)
        logger.info(
            f"[{session_id}] Running {n} variation(s) "
            f"(mode={FLUX_REPAINT_MODE}, strength={repaint_strength}"
            f"{', overgen-filter ON' if OVERGEN_FILTER else ''})"
        )

        results: list[str | None] = [None] * n
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
        if OVERGEN_FILTER and len(render_urls) > NUM_VARIATIONS:
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
