"""Check the gpt-image aspect_ratio assumption the render path now depends on.

run_gpt_image() no longer letterboxes — it asks gpt-image-2 for the source's own
aspect ratio. If Replicate ever narrows that enum, every render silently comes
back the wrong shape, so this asserts our table against the LIVE schema.

    python test_gpt_ratio.py        (needs REPLICATE_API_TOKEN; no credits spent)
"""
import os
import sys

import httpx
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from app.replicate_service import GPT_IMAGE_RATIOS  # noqa: E402

pick = lambda w, h: min(GPT_IMAGE_RATIOS, key=lambda r: abs(GPT_IMAGE_RATIOS[r] - w / h))
assert pick(1280, 960) == "4:3", pick(1280, 960)   # our composites
assert pick(1024, 1024) == "1:1"
assert pick(1920, 1080) == "16:9"

model = os.getenv("GPT_IMAGE_MODEL", "openai/gpt-image-2")
r = httpx.get(
    f"https://api.replicate.com/v1/models/{model}",
    headers={"Authorization": f"Token {os.environ['REPLICATE_API_TOKEN']}"},
    timeout=30,
)
r.raise_for_status()
schemas = r.json()["latest_version"]["openapi_schema"]["components"]["schemas"]
live = set(schemas["aspect_ratio"]["enum"])
missing = set(GPT_IMAGE_RATIOS) - live
assert not missing, f"{model} no longer accepts {sorted(missing)} — letterbox again?"
assert "png" in schemas["output_format"]["enum"]
print(f"ok — {model} accepts {sorted(GPT_IMAGE_RATIOS)} + png")
