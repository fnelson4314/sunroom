import httpx
from PIL import Image, ImageFilter
import io
import time
import logging
from app.config import REPLICATE_API_TOKEN
from PIL import ImageDraw
import os
from app.lora_config import get_lora_url

logger = logging.getLogger(__name__)

HEADERS = {
    "Authorization": f"Token {REPLICATE_API_TOKEN}",
    "Content-Type": "application/json"
}

POLL_INTERVAL = 3
MAX_WAIT = 600
MAX_INPAINT_SIZE = 1280  # FLUX Fill Pro optimal range — stays square-ish at any aspect ratio
LORA_SCALE = float(os.getenv("LORA_SCALE", "0.85"))




# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _handle_http_error(e: httpx.HTTPStatusError):
    status = e.response.status_code
    if status == 401:
        raise Exception("Replicate API key is invalid or missing")
    elif status == 402:
        raise Exception("Replicate account requires payment — add billing at replicate.com/account/billing")
    elif status == 422:
        raise Exception(f"Replicate rejected the request (422) — check input fields: {e.response.text}")
    elif status == 429:
        raise Exception("Replicate rate limit hit — retry later")
    else:
        raise Exception(f"Replicate API error {status}: {e.response.text}")


def _poll_prediction(client: httpx.Client, prediction_id: str):
    """Shared polling loop. Handles both list and string output formats."""
    elapsed = 0
    while elapsed < MAX_WAIT:
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

        poll = client.get(
            f"https://api.replicate.com/v1/predictions/{prediction_id}",
            headers=HEADERS
        )
        poll.raise_for_status()
        result = poll.json()
        status = result.get("status")

        logger.info(f"Prediction {prediction_id} status: {status} ({elapsed}s)")

        if status in ("starting", "processing"):
            continue
        elif status == "succeeded":
            output = result.get("output")
            # SD-style models return a list of URLs; FLUX returns a single URL string
            if isinstance(output, list):
                return output[0]
            return output
        elif status == "failed":
            logger.error(f"Prediction {prediction_id} failed: {result.get('error')}")
            raise Exception(f"AI generation failed: {result.get('error')}")

    raise Exception("AI generation timed out")


# ---------------------------------------------------------------------------
# Versioned model predictions (SHA hash) — used for MiDaS etc.
# POST /v1/predictions  { "version": "<sha>", "input": {...} }
# ---------------------------------------------------------------------------

def run_prediction(model_version: str, input_data: dict):
    try:
        with httpx.Client(timeout=httpx.Timeout(60.0)) as client:
            response = client.post(
                "https://api.replicate.com/v1/predictions",
                headers=HEADERS,
                json={"version": model_version, "input": input_data}
            )
            response.raise_for_status()
            prediction_id = response.json()["id"]
            logger.info(f"Started versioned prediction {prediction_id}")
            return _poll_prediction(client, prediction_id)

    except httpx.HTTPStatusError as e:
        _handle_http_error(e)
    except httpx.TimeoutException:
        raise Exception("AI service timed out")


# ---------------------------------------------------------------------------
# Named model predictions (owner/model slug) — used for FLUX Fill Pro etc.
# POST /v1/models/{owner}/{model}/predictions  { "input": {...} }
#
# FLUX Fill Pro has no public version SHA — requires this separate endpoint.
# ---------------------------------------------------------------------------

def run_model_prediction(owner_model: str, input_data: dict):
    try:
        with httpx.Client(timeout=httpx.Timeout(60.0)) as client:
            response = client.post(
                f"https://api.replicate.com/v1/models/{owner_model}/predictions",
                headers=HEADERS,
                json={"input": input_data}
            )
            response.raise_for_status()
            prediction_id = response.json()["id"]
            logger.info(f"Started model prediction {prediction_id} ({owner_model})")
            return _poll_prediction(client, prediction_id)

    except httpx.HTTPStatusError as e:
        _handle_http_error(e)
    except httpx.TimeoutException:
        raise Exception("AI service timed out")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def prepare_and_mask(
    image_url: str,
    box_x1: float,
    box_y1: float,
    box_x2: float,
    box_y2: float,
    feather_px: int = 6,
    max_size: int = MAX_INPAINT_SIZE,
) -> tuple[str, str]:
    """
    Download the source image, resize it to max_size if needed, generate a
    feathered inpainting mask, upload both to Supabase.

    Returns (resized_image_url, mask_url).

    IMPORTANT: pass resized_image_url to run_flux_fill_inpaint, NOT the
    original house photo URL. Image and mask must have matching dimensions
    or FLUX will reject the request.

    Why we resize:
      Smartphone photos are typically 4000-5000px wide. FLUX Fill Pro is
      optimised for 1024-1536px. At full resolution the model loses track of
      scale and placement — the sunroom ends up in a corner or malformed.
      Resizing to MAX_INPAINT_SIZE fixes this with no loss of perceived quality
      in the final render.

    feather_px is intentionally lower (12) than the old generate_box_mask (18)
    because the image is now smaller — 12px on a 1280px image is proportionally
    correct.
    """
    from app.database import supabase
    import uuid

    # Download source image
    with httpx.Client(timeout=30) as client:
        resp = client.get(image_url)
        resp.raise_for_status()

    source = Image.open(io.BytesIO(resp.content)).convert("RGB")
    orig_w, orig_h = source.size
    logger.info(f"Source image: {orig_w}×{orig_h}")

    # Resize down if needed — thumbnail() preserves aspect ratio
    if orig_w > max_size or orig_h > max_size:
        source = source.copy()
        source.thumbnail((max_size, max_size), Image.LANCZOS)
        logger.info(f"Resized to {source.size[0]}×{source.size[1]} for inpainting")

    w, h = source.size

    # Upload resized image — FLUX receives this, not the original
    img_buf = io.BytesIO()
    source.save(img_buf, format="JPEG", quality=95)
    img_buf.seek(0)
    img_path = f"house-photos/inpaint-{uuid.uuid4()}.jpg"
    supabase.storage.from_("renders").upload(
        img_path,
        img_buf.getvalue(),
        {"content-type": "image/jpeg"}
    )
    resized_image_url = supabase.storage.from_("renders").get_public_url(img_path)
    logger.info(f"Uploaded resized image: {resized_image_url}")

    # Generate mask at resized dimensions using normalized coordinates
    px1 = int(box_x1 * w)
    py1 = int(box_y1 * h)
    px2 = int(box_x2 * w)
    py2 = int(box_y2 * h)
    logger.info(f"Mask rectangle: ({px1},{py1}) → ({px2},{py2}) on {w}×{h}")

    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle([px1, py1, px2, py2], fill=255)

    if feather_px > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=feather_px))

    mask_buf = io.BytesIO()
    mask.save(mask_buf, format="PNG")
    mask_buf.seek(0)
    mask_path = f"masks/{uuid.uuid4()}.png"
    supabase.storage.from_("renders").upload(
        mask_path,
        mask_buf.getvalue(),
        {"content-type": "image/png"}
    )
    mask_url = supabase.storage.from_("renders").get_public_url(mask_path)
    logger.info(f"Uploaded mask: {mask_url}")

    return resized_image_url, mask_url


def run_flux_fill_lora(
    image_url: str,
    mask_url: str,
    prompt: str,
    negative_prompt: str,
    wall_system: str,
    roof_style: str,
) -> str:
    """
    FLUX Fill Dev with trained sunroom LoRA.
    Falls back to base FLUX Fill Dev if no LoRA is trained for this combo.
    """
    lora_url = get_lora_url(wall_system, roof_style)

    input_data = {
        "image":          image_url,
        "mask":           mask_url,
        "prompt":         prompt,
        "num_inference_steps": 50,
        "guidance":       30,
        "strength":       1.0,
        "output_format":  "jpg",
        "output_quality": 95,
    }

    if lora_url:
        input_data["extra_lora"]       = lora_url
        input_data["extra_lora_scale"] = LORA_SCALE
        logger.info(f"Using LoRA for ({wall_system}, {roof_style}): {lora_url[:60]}...")
    else:
        logger.info(f"No LoRA for ({wall_system}, {roof_style}) — using base FLUX Fill Dev")

    return run_prediction(
        "black-forest-labs/flux-fill-dev",
        input_data,
    )


def run_midas(image_url: str) -> str:
    # Not currently called — removed from pipeline because SD inpainting
    # doesn't accept a depth map input. Re-enable if switching to a
    # ControlNet model that accepts depth conditioning.
    try:
        return run_prediction(
            model_version="cjwbw/midas:a6ba5798f04f80d3b314de0f0a62277f21ab3503c60c84d4817de83c5edfdae0",
            input_data={
                "image": image_url,
                "model_type": "dpt_beit_large_512"
            }
        )
    except Exception as e:
        logger.error(f"MiDaS error: {str(e)}")
        raise