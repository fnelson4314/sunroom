from app.worker import celery_app
from app.database import supabase
from app.prompt_builder import build_prompt
from app.replicate_service import (
    prepare_and_mask,
    run_flux_fill_lora,
    run_flux_control_dev,
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
#   "ground"     → legacy: blend the ground-contact shadow only.
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
        if parsed_corners and "_5pt" in parsed_corners:
            pts = parsed_corners["_5pt"]

        # Under-existing: the traced existing-roof underside polyline. The renderer
        # clips the walls to it and draws a header beam instead of a new roof.
        roofline = None
        if parsed_corners and isinstance(parsed_corners.get("_roofline"), list):
            roofline = parsed_corners["_roofline"]

        # ── Step 5: 3D render via Node.js service ─────────────────────────────
        use_3d_composite = pts is not None
        render_mask_bytes = None  # exact structure mask from the renderer, if any

        if use_3d_composite:
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
                    "screenOptions":     parsed_screen_options,
                }

                with httpx.Client(timeout=90) as client:
                    resp = client.post(
                        f"{RENDERER_3D_URL}/render",
                        json=render_payload,
                        headers={"Content-Type": "application/json"},
                    )
                    resp.raise_for_status()
                    render_data = resp.json()

                # Renderer now returns the composite AND an exact structure mask
                # (white sunroom on black) — pixel-perfect, immune to the
                # tone-mapping that made diff-based masks flag the whole frame.
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

                # SINGLE SOURCE OF TRUTH for the wall combo: the renderer returns
                # the combo it ACTUALLY drew (explicit, inferred, or geometric
                # auto-detect). If the prompt was built assuming a different pair,
                # rebuild it — a prompt describing one wall layout over a composite
                # showing the other makes FLUX repaint a scrambled panel patchwork.
                resolved_combo = render_data.get("combo")
                if resolved_combo in ("AB", "BC") and resolved_combo != wall_combo:
                    logger.info(
                        f"[{session_id}] renderer resolved wall combo "
                        f"{resolved_combo} (request had {wall_combo!r}) — rebuilding prompt"
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

                use_composite = True

            except Exception as render_err:
                logger.warning(f"[{session_id}] 3D renderer failed ({render_err}) — falling back to Python renderer")
                use_composite = False
        else:
            logger.info(f"[{session_id}] No 5pt corners — using Python renderer fallback")
            use_composite = False

        # ── Step 5b: Python renderer fallback ────────────────────────────────
        if not use_composite:
            try:
                from app.sunroom_renderer import render_sunroom
                config_dict = {
                    "wallSystem":         wall_system,
                    "wallColor":          wall_color,
                    "roofStyle":          roof_style,
                    "mountHeight":        mount_height,
                    "wallData":           wall_data,
                    "projectionDistance": projection_distance,
                    "roofOnlySubStyle":   roof_only_sub_style,
                }

                effective_x1, effective_y1 = box_x1, box_y1
                effective_x2, effective_y2 = box_x2, box_y2

                if parsed_corners and "_5pt" in parsed_corners:
                    house_pts = parsed_corners["_5pt"][:4]
                    xs = [p[0] for p in house_pts]
                    ys = [p[1] for p in house_pts]
                    effective_x1, effective_y1 = min(xs), min(ys)
                    effective_x2, effective_y2 = max(xs), max(ys)

                composite_bytes, edge_mask_bytes = render_sunroom(
                    photo_bytes, config_dict,
                    effective_x1, effective_y1,
                    effective_x2, effective_y2,
                    wall_corners=parsed_corners,
                )
                debug_url = upload_bytes(composite_bytes, "jpg", "debug-composites")
                logger.info(f"[{session_id}] DEBUG Python composite: {debug_url}")
                use_composite = True
            except Exception as py_err:
                logger.warning(f"[{session_id}] Python renderer also failed ({py_err}) — using raw photo")
                use_composite = False

        if is_cancelled():
            return {"status": "cancelled"}

        # ── Step 6: Build the FLUX mask ──────────────────────────────────────
        # "controlnet"/"full": mask the ENTIRE rendered sunroom silhouette so the
        #   model repaints the whole structure photoreal (controlnet also locks
        #   geometry via the composite's edges).
        # "ground": legacy — mask only the ground-contact strip so FLUX just
        #   blends the shadow and leaves the raw 3D render visible.
        repaint_strength = 1.0
        silhouette_mask_bytes = None  # kept for the post-repaint composite step
        if use_composite:
            inpaint_image_url = upload_bytes(composite_bytes, "jpg", "house-photos")

            if FLUX_REPAINT_MODE in ("full", "controlnet"):
                # Prefer the renderer's EXACT structure mask. Only fall back to
                # the diff-based silhouette if the renderer didn't supply one.
                if render_mask_bytes:
                    mask_bytes, coverage = prepare_render_mask(render_mask_bytes)
                    logger.info(f"[{session_id}] Using exact renderer mask, coverage {coverage:.1%}")
                else:
                    mask_bytes, coverage = build_silhouette_mask(composite_bytes, photo_bytes)
                    logger.info(f"[{session_id}] Diff silhouette mask, coverage {coverage:.1%}")

                if coverage < 0.01 or coverage > 0.85:
                    # Implausible mask (near-empty, or ballooned to ~whole frame)
                    # — fall back to the structure bounding box rather than wreck
                    # the photo.
                    logger.warning(
                        f"[{session_id}] Mask coverage {coverage:.1%} implausible — "
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

            else:  # "ground" — legacy shadow-only blend
                logger.info(f"[{session_id}] Generating ground-contact mask (legacy blend)")
                if pts:
                    mask_bytes = _build_ground_contact_mask(
                        pts, photo_w, photo_h, ground_fraction=0.15, feather_px=28
                    )
                    mask_url = upload_bytes(mask_bytes, "png", "masks")
                else:
                    _, mask_url = prepare_and_mask(
                        house_photo_url, box_x1, box_y1, box_x2, box_y2
                    )
                repaint_strength = 1.0
        else:
            # No composite — inpaint the box region of the raw photo from scratch.
            inpaint_image_url = resized_image_url
            _, mask_url = prepare_and_mask(
                house_photo_url, box_x1, box_y1, box_x2, box_y2
            )
            repaint_strength = 1.0

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
        needs_composite = use_composite and FLUX_REPAINT_MODE in ("full", "controlnet")

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
            if use_composite and FLUX_REPAINT_MODE == "controlnet":
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

        n = NUM_VARIATIONS
        base_seed = random.randint(1, 2_000_000_000)
        logger.info(
            f"[{session_id}] Running {n} variation(s) "
            f"(mode={FLUX_REPAINT_MODE}, strength={repaint_strength})"
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


def _build_ground_contact_mask(
    pts: list,
    photo_w: int,
    photo_h: int,
    ground_fraction: float = 0.15,
    feather_px: int = 28,
) -> bytes:
    """
    Build a mask that covers only the ground contact zone of the sunroom:
    the bottom `ground_fraction` of the structure bounding box, feathered.

    This tells FLUX to only blend the shadow/contact line where the
    sunroom meets the patio — not the roof, walls, or glass.
    """
    from PIL import Image, ImageFilter
    import numpy as np

    # Ground points: pt3 (left bottom), pt4 (front corner), pt2 (right bottom)
    ground_pts = [pts[2], pts[3], pts[4]]  # right-bottom, left-bottom, front-corner

    xs = [p[0] * photo_w for p in ground_pts]
    ys = [p[1] * photo_h for p in ground_pts]

    # Bounding box of ground zone
    min_x = int(min(xs)) - feather_px
    max_x = int(max(xs)) + feather_px
    ground_y = int(max(ys))             # lowest point in photo coords

    # Structure top
    top_ys  = [pts[0][1] * photo_h, pts[1][1] * photo_h]
    struct_top_y = int(min(top_ys))
    struct_h     = ground_y - struct_top_y

    # Mask covers bottom ground_fraction of structure height
    mask_top_y = max(struct_top_y, ground_y - int(struct_h * ground_fraction))

    mask = Image.new("L", (photo_w, photo_h), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).rectangle(
        [max(0, min_x), mask_top_y, min(photo_w, max_x), min(photo_h, ground_y + feather_px)],
        fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(radius=feather_px))

    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    return buf.getvalue()