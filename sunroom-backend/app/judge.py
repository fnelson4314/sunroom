"""
judge.py — OPTIONAL quality/consistency filter for the parallel render variations.

When OVERGEN_FILTER=true (backend .env), tasks.py generates a larger POOL of
variations and uses score_render() to keep only the best NUM_VARIATIONS — so the
salesman never sees an obvious dud, even though the underlying model is still
seed-variable.

FAIL-SAFE BY DESIGN: any judging error returns None, and the caller falls back to
showing the unfiltered set. So this can only ever HIDE bad renders, never make the
result worse. It also does NOT touch the composite/config lock — that's canny, and
it's untouched. This is purely a post-generation selection step.

The judge is a vision model (JUDGE_MODEL) asked how well each render matches the
already-built prompt AND how photorealistic it is. Reusing the prompt as the
"expected description" means there's no separate config spec to maintain.

NOTE: JUDGE_MODEL defaults to a general VLM; verify it still exists on Replicate
and/or point it at a stronger vision model for better discrimination (price is no
object → a top-tier VLM judge is worth it). The `input` field names below follow
the LLaVA-style schema; adjust them if you swap to a model with a different schema.
"""
import logging
import os
import re

from app.replicate_service import run_model_prediction

logger = logging.getLogger(__name__)

JUDGE_MODEL = os.getenv("JUDGE_MODEL", "yorickvp/llava-13b")

JUDGE_PROMPT = (
    "You are grading an AI-generated architectural render of a sunroom or screened "
    "porch added onto a house. Rate it from 1 to 10 on these combined: (a) how "
    "photorealistic and artifact-free it looks, and (b) how well it matches this "
    "intended description:\n\n{desc}\n\n"
    "A good render is realistic and clean and matches the described walls, doors, "
    "and materials. Give a LOW score for: wrong materials (e.g. brick when siding "
    "was described, or glass when insect screen was described), melted or warped "
    "frames, blur, duplicated/extra panels, and obvious AI artifacts. "
    "Reply with ONLY a single number from 1 to 10."
)


def score_render(image_url: str, desc: str) -> float | None:
    """Return a 1-10 quality score for one render, or None on any failure.

    None is the fail-safe signal: the caller treats it as "can't judge" and keeps
    the render rather than dropping it.
    """
    try:
        out = run_model_prediction(
            JUDGE_MODEL,
            {
                "image": image_url,
                "prompt": JUDGE_PROMPT.format(desc=desc[:1200]),
                "max_tokens": 8,
            },
        )
        text = out if isinstance(out, str) else "".join(out or [])
        m = re.search(r"\d+(?:\.\d+)?", text or "")
        if not m:
            logger.warning(f"judge returned no number: {text!r}")
            return None
        return max(0.0, min(10.0, float(m.group(0))))
    except Exception as e:
        logger.warning(f"judge score_render failed: {e}")
        return None
