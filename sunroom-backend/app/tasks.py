from app.worker import celery_app
from app.database import supabase
from app.prompt_builder import build_prompt
from app.replicate_service import prepare_and_mask, run_flux_fill_lora
from app.config import validate_uuid
import httpx
import uuid
import base64
import logging
import json
import os
from PIL import Image
import io

logger = logging.getLogger(__name__)

# URL of the Node.js 3D renderer service (set as env var on Railway)
RENDERER_3D_URL = os.environ.get("RENDERER_3D_URL", "http://localhost:3001")


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
    wall_corners: str = "",
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

        # ── Step 1: Build prompt ──────────────────────────────────────────────
        logger.info(f"[{session_id}] Building prompt")
        positive_prompt, negative_prompt = build_prompt(
            selected_option_ids,
            wall_data=wall_data,
            roof_style=roof_style,
            wall_system=wall_system,
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

        # ── Step 5: 3D render via Node.js service ─────────────────────────────
        use_3d_composite = pts is not None

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
                }

                with httpx.Client(timeout=90) as client:
                    resp = client.post(
                        f"{RENDERER_3D_URL}/render",
                        json=render_payload,
                        headers={"Content-Type": "application/json"},
                    )
                    resp.raise_for_status()
                    composite_bytes = resp.content

                logger.info(f"[{session_id}] 3D render succeeded ({len(composite_bytes)} bytes)")

                # Upload debug composite
                debug_url = upload_bytes(composite_bytes, "jpg", "debug-composites")
                logger.info(f"[{session_id}] DEBUG 3D composite: {debug_url}")

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

        # ── Step 6: Build edge mask for FLUX ─────────────────────────────────
        # FLUX only blends the ground contact shadow at low strength
        # We generate a mask that covers ONLY the bottom edge of the structure
        # (not the full footprint) so FLUX doesn't touch the roof.
        if use_composite:
            logger.info(f"[{session_id}] Generating edge-only mask for FLUX ground blending")
            inpaint_image_url = upload_bytes(composite_bytes, "jpg", "house-photos")

            if pts:
                # Build a tight mask covering only the ground contact zone:
                # bottom ~15% of the structure bounding box
                edge_mask_bytes = _build_ground_contact_mask(
                    pts, photo_w, photo_h,
                    ground_fraction=0.15,
                    feather_px=28,
                )
                mask_url = upload_bytes(edge_mask_bytes, "png", "masks")
            else:
                # Fallback: use box mask
                _, mask_url = prepare_and_mask(
                    house_photo_url, box_x1, box_y1, box_x2, box_y2
                )
        else:
            inpaint_image_url = resized_image_url
            _, mask_url = prepare_and_mask(
                house_photo_url, box_x1, box_y1, box_x2, box_y2
            )

        if is_cancelled():
            return {"status": "cancelled"}

        # ── Step 7: FLUX Fill — edge blending only ────────────────────────────
        # Low strength: FLUX only softens the ground contact line,
        # it does NOT touch the roof (mask excludes it).
        logger.info(f"[{session_id}] Running FLUX Fill for ground contact blending")
        render_url = run_flux_fill_lora(
            image_url=inpaint_image_url,
            mask_url=mask_url,
            prompt=positive_prompt,
            negative_prompt=negative_prompt,
            wall_system=wall_system,
            roof_style=roof_style,
        )

        if is_cancelled():
            logger.info(f"[{session_id}] Cancelled after Replicate returned — discarding")
            return {"status": "cancelled"}

        supabase.table("configurations")\
            .update({"status": "complete", "render_url": render_url})\
            .eq("id", session_id)\
            .execute()

        logger.info(f"[{session_id}] Generation complete: {render_url}")
        return {"status": "complete", "render_url": render_url}

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