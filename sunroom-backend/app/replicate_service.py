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

def _create_prediction(client: httpx.Client, url: str, payload: dict, max_429_retries: int = 4):
    """
    POST to a Replicate predictions endpoint, backing off on 429 (honouring the
    Retry-After header) so transient rate limits self-heal instead of failing
    the whole task. Returns the parsed JSON body of the created prediction.
    """
    response = None
    for attempt in range(max_429_retries + 1):
        response = client.post(url, headers=HEADERS, json=payload)
        if response.status_code == 429 and attempt < max_429_retries:
            try:
                wait = float(response.headers.get("retry-after"))
            except (TypeError, ValueError):
                wait = 5.0
            wait = min(max(wait, 1.0), 30.0)
            logger.warning(
                f"Replicate 429 — backing off {wait:.0f}s "
                f"(attempt {attempt + 1}/{max_429_retries})"
            )
            time.sleep(wait)
            continue
        response.raise_for_status()
        return response.json()
    response.raise_for_status()  # retries exhausted — surface the final 429
    return response.json()


def run_prediction(model_version: str, input_data: dict):
    try:
        with httpx.Client(timeout=httpx.Timeout(60.0)) as client:
            result = _create_prediction(
                client,
                "https://api.replicate.com/v1/predictions",
                {"version": model_version, "input": input_data},
            )
            prediction_id = result["id"]
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

def get_latest_version(owner_model: str) -> str:
    """
    Resolve a model's latest version SHA. Community models (not official
    black-forest-labs/etc.) can't use the /v1/models/{owner}/{model}/predictions
    endpoint — they must be run via /v1/predictions with a version id. We fetch
    the latest version dynamically so a model update doesn't break us.
    """
    try:
        with httpx.Client(timeout=httpx.Timeout(30.0)) as client:
            response = client.get(
                f"https://api.replicate.com/v1/models/{owner_model}",
                headers=HEADERS,
            )
            response.raise_for_status()
            version = (response.json().get("latest_version") or {}).get("id")
            if not version:
                raise Exception(f"No latest_version found for {owner_model}")
            logger.info(f"Resolved {owner_model} → version {version[:12]}…")
            return version
    except httpx.HTTPStatusError as e:
        _handle_http_error(e)


def run_model_prediction(owner_model: str, input_data: dict):
    try:
        with httpx.Client(timeout=httpx.Timeout(60.0)) as client:
            result = _create_prediction(
                client,
                f"https://api.replicate.com/v1/models/{owner_model}/predictions",
                {"input": input_data},
            )
            prediction_id = result["id"]
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


def build_silhouette_mask(
    composite_bytes: bytes,
    original_bytes: bytes,
    threshold: int = 16,
    close_px: int = 9,
    grow_px: int = 5,
    feather_px: int = 16,
) -> tuple[bytes, float]:
    """
    Build a full-structure inpaint mask by diffing the 3D composite against the
    original photo: every pixel the renderer changed (frames, glass tint, roof,
    shadow) becomes part of the mask. This captures the EXACT rendered sunroom
    silhouette — roof peak included — which a projected bounding box can't.

    Pipeline: abs colour diff → threshold → morphological close (fills glass
    interiors whose tint is faint) → slight grow to catch frame edges → feather.

    Returns (png_bytes, coverage_fraction). coverage_fraction lets the caller
    fall back to a bounding-box mask if the diff captured implausibly little
    (e.g. an almost-transparent overlay over a busy background).
    """
    import numpy as np

    comp = Image.open(io.BytesIO(composite_bytes)).convert("RGB")
    orig = Image.open(io.BytesIO(original_bytes)).convert("RGB")
    if comp.size != orig.size:
        orig = orig.resize(comp.size, Image.LANCZOS)

    c = np.asarray(comp).astype(np.int16)
    o = np.asarray(orig).astype(np.int16)
    diff = np.abs(c - o).sum(axis=2)  # 0..765 per pixel
    binary = (diff > threshold).astype(np.uint8) * 255
    mask = Image.fromarray(binary, "L")

    # Morphological close (dilate then erode) fills faint-glass interior holes.
    if close_px > 0:
        k = close_px * 2 + 1
        mask = mask.filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))
    # Grow a touch so thin frame edges and the contact shadow are fully covered.
    if grow_px > 0:
        mask = mask.filter(ImageFilter.MaxFilter(grow_px * 2 + 1))
    if feather_px > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(feather_px))

    coverage = float((np.asarray(mask) > 32).mean())

    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    return buf.getvalue(), coverage


def prepare_render_mask(
    mask_bytes: bytes,
    threshold: int = 40,
    grow_px: int = 4,
    feather_px: int = 14,
) -> tuple[bytes, float]:
    """
    Turn the renderer's exact structure mask (white sunroom on black) into a
    clean feathered inpaint mask. Unlike the diff-based silhouette mask, this is
    pixel-perfect to the geometry and immune to background tone-mapping, so it
    can never balloon to cover the whole frame. Returns (png_bytes, coverage).
    """
    import numpy as np

    img = Image.open(io.BytesIO(mask_bytes)).convert("L")
    binary = img.point(lambda p: 255 if p > threshold else 0)
    if grow_px > 0:
        binary = binary.filter(ImageFilter.MaxFilter(grow_px * 2 + 1))
    if feather_px > 0:
        binary = binary.filter(ImageFilter.GaussianBlur(feather_px))

    coverage = float((np.asarray(binary) > 32).mean())

    buf = io.BytesIO()
    binary.save(buf, format="PNG")
    return buf.getvalue(), coverage


def run_flux_fill_lora(
    image_url: str,
    mask_url: str,
    prompt: str,
    negative_prompt: str,
    wall_system: str,
    roof_style: str,
    strength: float = 1.0,
    seed: int | None = None,
) -> str:
    """
    FLUX Fill Dev with trained sunroom LoRA.
    Falls back to base FLUX Fill Dev if no LoRA is trained for this combo.

    This is a TRUE inpaint: pixels outside the mask are preserved exactly, so
    the house/pool/sky stay your real photo. `strength` controls how much the
    masked sunroom region is changed relative to the (already-correct) 3D
    composite underneath:
      - low (~0.3-0.5) → hug the composite tightly: keep the exact panel/gable
        config and just restyle grey→photoreal glass/aluminum. PREFERRED — the
        composite is the source of truth, we only want a material restyle.
      - high (~0.8-1.0) → free to reinvent the masked region; drifts the config.

    LoRA is OFF by default (FLUX_FILL_USE_LORA): the trained one carried
    watermark text. Re-enable only with a clean retrained LoRA.
    """
    use_lora = os.getenv("FLUX_FILL_USE_LORA", "false").lower() == "true"

    input_data = {
        "image":          image_url,
        "mask":           mask_url,
        "prompt":         prompt,
        "num_inference_steps": 50,
        "guidance":       30,
        "strength":       strength,
        "output_format":  "jpg",
        "output_quality": 95,
    }
    # Distinct seed per parallel variation → different photoreal outputs from the
    # same composite/mask. Omit (None) to let Replicate randomise.
    if seed is not None:
        input_data["seed"] = seed

    lora_url = get_lora_url(wall_system, roof_style) if use_lora else None
    if lora_url:
        input_data["extra_lora"]       = lora_url
        input_data["extra_lora_scale"] = LORA_SCALE
        logger.info(f"FLUX Fill with LoRA ({wall_system}, {roof_style}) strength={strength}: {lora_url[:50]}...")
    else:
        why = "disabled via env" if not use_lora else "none for this combo"
        logger.info(f"FLUX Fill base (no LoRA — {why}) strength={strength}")

    return run_prediction(
        "black-forest-labs/flux-fill-dev",
        input_data,
    )


def composite_masked(ai_image_url: str, base_bytes: bytes, mask_bytes: bytes) -> bytes:
    """
    Force the final image to differ from the base photo ONLY inside the mask.

    Some inpaint/img2img models (this ControlNet one included) renoise the whole
    frame and treat the mask as soft guidance, so the house, pool and sky come
    back subtly redrawn — and any text artifacts spread everywhere. We composite
    the AI output over the ORIGINAL photo through the feathered mask, guaranteeing
    everything outside the sunroom silhouette stays pixel-identical and confining
    any model artifacts to the region we actually wanted changed.
    """
    with httpx.Client(timeout=60) as client:
        resp = client.get(ai_image_url)
        resp.raise_for_status()

    ai = Image.open(io.BytesIO(resp.content)).convert("RGB")
    base = Image.open(io.BytesIO(base_bytes)).convert("RGB")
    mask = Image.open(io.BytesIO(mask_bytes)).convert("L")

    if ai.size != base.size:
        ai = ai.resize(base.size, Image.LANCZOS)
    if mask.size != base.size:
        mask = mask.resize(base.size, Image.LANCZOS)

    # composite(image1, image2, mask): mask=255 → image1 (AI), 0 → image2 (base).
    out = Image.composite(ai, base, mask)

    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def run_flux_controlnet_inpaint(
    image_url: str,
    control_image_url: str,
    mask_url: str,
    prompt: str,
    wall_system: str,
    roof_style: str,
    strength: float = 0.8,
    conditioning_scale: float = 0.6,
) -> str:
    """
    fermatresearch/flux-controlnet-inpaint — the structure-locked photoreal path.

    Combines three constraints in one call so the AI restyles the sunroom without
    moving it or losing the house:
      - control_image (Canny ControlNet, conditioning_scale): the composite's
        frame/panel/gable edges become a HARD geometric constraint, preserving
        the camera angle and the configured layout.
      - mask: only the sunroom silhouette is regenerated; the house, pool, and
        patio stay pixel-identical.
      - image + strength: img2img base; higher strength = more photoreal freedom,
        but ControlNet still pins the structure.
      - lora_weights/lora_scale: the trained sunroom LoRA supplies material realism.

    Tuning is env-driven so it can be dialled without code changes:
      FLUX_CONTROLNET_HYPER      ("false") — Hyper-FLUX 8-step distillation. OFF by
                                  default: it conflicts with custom LoRAs + ControlNet
                                  and produces garbled text artifacts across the image.
      FLUX_CONTROLNET_STEPS      ("28")    — inference steps (use ~8 only if HYPER on).
      FLUX_CONTROLNET_GUIDANCE   ("3.5")
      FLUX_CONTROLNET_LORA_SCALE ("0.6")   — lower than the Fill default; a hot LoRA
                                  is the other common cause of text/watermark noise.
      FLUX_CONTROLNET_USE_LORA   ("true")  — set false to isolate whether the LoRA is
                                  causing artifacts.

    Field names match the model's published input schema. Note this model uses
    `lora_weights`/`lora_scale` (NOT `extra_lora`/`extra_lora_scale` like FLUX Fill
    Dev) and is a community model → run via the versioned /v1/predictions endpoint.
    """
    use_hyper  = os.getenv("FLUX_CONTROLNET_HYPER", "false").lower() == "true"
    steps      = int(os.getenv("FLUX_CONTROLNET_STEPS", "8" if use_hyper else "28"))
    guidance   = float(os.getenv("FLUX_CONTROLNET_GUIDANCE", "3.5"))
    lora_scale = float(os.getenv("FLUX_CONTROLNET_LORA_SCALE", "0.6"))
    use_lora   = os.getenv("FLUX_CONTROLNET_USE_LORA", "false").lower() == "true"

    input_data = {
        "prompt":              prompt,
        "image":               image_url,
        "control_image":       control_image_url,
        "mask":                mask_url,
        "strength":            strength,
        "conditioning_scale":  conditioning_scale,
        "guidance_scale":      guidance,
        "num_inference_steps": steps,
        "enable_hyper_flux_8_step": use_hyper,
        "output_format":       "jpg",
        "output_quality":      95,
    }

    lora_url = get_lora_url(wall_system, roof_style) if use_lora else None
    if lora_url:
        input_data["lora_weights"] = lora_url
        input_data["lora_scale"]   = lora_scale
        logger.info(
            f"ControlNet inpaint ({wall_system}, {roof_style}) hyper={use_hyper} "
            f"steps={steps} lora_scale={lora_scale}: {lora_url[:50]}..."
        )
    else:
        why = "disabled via env" if not use_lora else "none for this combo"
        logger.info(
            f"ControlNet inpaint ({wall_system}, {roof_style}) hyper={use_hyper} "
            f"steps={steps} — LoRA {why}"
        )

    # Community model → must run via the versioned /v1/predictions endpoint.
    version = get_latest_version("fermatresearch/flux-controlnet-inpaint")
    return run_prediction(version, input_data)


def run_flux_control_dev(
    control_image_url: str,
    prompt: str,
    wall_system: str,
    roof_style: str,
    seed: int | None = None,
) -> str:
    """
    First-party Black Forest Labs structure-conditioned generation
    (black-forest-labs/flux-canny-dev by default; set FLUX_CONTROL_MODEL to
    flux-depth-dev to switch). Replaces the community ControlNet model, which
    baked watermark/text artifacts into every output.

    The model derives Canny edges from control_image internally and generates a
    clean photoreal image that follows the rendered sunroom's frame/panel/gable
    geometry — a hard structure lock, which fixes both the text artifacts (clean
    first-party weights) and the wrong panel config (edges are a constraint).

    There is no mask input — the whole frame is regenerated — so the caller MUST
    composite the result back over the original photo (composite_masked) to keep
    the house/pool/sky untouched.

    Field names follow the BFL Replicate family (same as flux-fill-dev): `guidance`,
    `num_inference_steps`, `extra_lora`/`extra_lora_scale`. Official model → runs
    via the /v1/models/{owner}/{model}/predictions endpoint.
    """
    model    = os.getenv("FLUX_CONTROL_MODEL", "black-forest-labs/flux-canny-dev")
    guidance = float(os.getenv("FLUX_CONTROL_GUIDANCE", "30"))
    steps    = int(os.getenv("FLUX_CONTROL_STEPS", "28"))
    use_lora = os.getenv("FLUX_CONTROL_USE_LORA", "false").lower() == "true"

    input_data = {
        "prompt":              prompt,
        "control_image":       control_image_url,
        "guidance":            guidance,
        "num_inference_steps": steps,
        "output_format":       "jpg",
        "output_quality":      95,
    }
    # Distinct seed per parallel variation → different photoreal outputs from the
    # same composite. Omit (None) to let Replicate randomise.
    if seed is not None:
        input_data["seed"] = seed

    # LoRA is OFF by default — the previous one carried watermarks. Re-enable only
    # with a clean retrained LoRA via FLUX_CONTROL_USE_LORA=true.
    if use_lora:
        lora_url = get_lora_url(wall_system, roof_style)
        if lora_url:
            input_data["extra_lora"]       = lora_url
            input_data["extra_lora_scale"] = float(os.getenv("FLUX_CONTROL_LORA_SCALE", "0.6"))
            logger.info(f"{model} with LoRA: {lora_url[:50]}...")
    else:
        logger.info(f"{model} (no LoRA) guidance={guidance} steps={steps}")

    return run_model_prediction(model, input_data)


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