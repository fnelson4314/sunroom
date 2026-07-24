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

from app.replicate_service import (
    get_latest_version,
    run_model_prediction,
    run_prediction,
)

logger = logging.getLogger(__name__)

JUDGE_MODEL = os.getenv("JUDGE_MODEL", "yorickvp/llava-13b")

JUDGE_PROMPT = (
    "You are grading an AI-generated architectural render of a sunroom or screened "
    "porch added onto a house. Rate it from 1 to 10 on these combined: (a) how "
    "photorealistic and artifact-free it looks, and (b) how exactly it matches this "
    "intended structure:\n\n{desc}\n\n"
    "Score 3 or LOWER if ANY structural error appears: a panel filled in as solid "
    "or white where glass is described, a missing or extra transom band, a missing "
    "door or wrong door type, extra mullions or split panels not in the description, "
    "house-style window sashes painted inside the sunroom glass, or insect screen "
    "rendered as glass. Also score LOW for unrealistic glass: heavily saturated "
    "solid-blue glass, or fully opaque black glass with no reflections — good "
    "sunroom glass is lightly tinted, slightly reflective, and partially "
    "see-through. Other flaws (warped frames, blur, artifacts, glassy reflective "
    "roof) also lower the score. Reply with ONLY a single number from 1 to 10."
)


def _focus_desc(desc: str) -> str:
    """Hand the judge the STRUCTURE part of the prompt, not the whole thing.

    The full positive prompt buries the wall config ~1000+ chars in (behind the
    quality prefix and roof boilerplate), so the old desc[:1200] truncation gave
    the judge a description with little or NO config in it — it was grading
    config match blind. The structure sentence carries the per-wall panel list,
    doors, and transoms, which is exactly what the judge needs.
    """
    for marker in ("Sunroom structure:", "Screened porch structure:"):
        i = desc.find(marker)
        if i != -1:
            return desc[i:i + 1600]
    return desc[:1600]

# Community models 404 on the named /v1/models/{owner}/{model}/predictions
# endpoint (verified live 2026-07-12 — the judge silently returned None on every
# call). Resolve the version ONCE per process and run via /v1/predictions;
# empty string = resolution failed, fall back to the named endpoint (works for
# official models if JUDGE_MODEL is ever pointed at one).
_judge_version: str | None = None


def _run_judge(input_data: dict):
    global _judge_version
    if _judge_version is None:
        try:
            _judge_version = get_latest_version(JUDGE_MODEL)
        except Exception as e:
            logger.warning(f"judge version resolution failed ({e}) — trying named endpoint")
            _judge_version = ""
    if _judge_version:
        return run_prediction(_judge_version, input_data)
    return run_model_prediction(JUDGE_MODEL, input_data)


def score_render(image_url: str, desc: str) -> float | None:
    """Return a 1-10 quality score for one render, or None on any failure.

    None is the fail-safe signal: the caller treats it as "can't judge" and keeps
    the render rather than dropping it.
    """
    try:
        out = _run_judge(
            {
                "image": image_url,
                "prompt": JUDGE_PROMPT.format(desc=_focus_desc(desc)),
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
