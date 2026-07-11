"""
tune_consistency.py — A/B harness for render CONSISTENCY.

Goal: find the LoRA scale / guidance that makes the parallel variations land
consistently good — so EVERY seed is a decent choice — WITHOUT pinning seeds in
production. It runs ONE composite + prompt across a small grid of lora_scale
values, each at the SAME set of seeds, so you can see which scale tightens the
batch (all seeds converge on a good look) vs which lets them wander.

Why this isolates the right thing: a higher LoRA scale pulls every seed toward
the LoRA's learned look, so the batch gets more consistent (at the cost of some
variety/realism if pushed too far). Sweeping it at fixed seeds shows the trade-off
directly. Guidance behaves similarly (higher = tighter adherence).

COSTS REPLICATE CREDITS: (num scales) × (num seeds) predictions. Keep the grid
small — default 4 scales × 3 seeds = 12 renders.

Usage (from sunroom-backend/, with the venv active so app.* + .env load).
NOTE: PowerShell — keep it on ONE line (no `\` continuation; that's bash):

    python tune_consistency.py --control "https://.../debug-composites/xxxx.jpg" --prompt-file prompt.txt --wall-system 4_inch --roof-style gable --scales 0.4,0.6,0.8,1.0 --seeds 1111,2222,3333

Grab --control from the Celery log line "DEBUG 3D composite: <url>" and the prompt
from "Built prompt positive: <...>" of a recent REAL generation, so you tune on a
true case (paste the prompt into prompt.txt). Then:

  - Outputs land in ./_tune_out/scale_<s>_seed_<n>.jpg.
  - View them as a grid: rows = scale, cols = seed.
  - Pick the SMALLEST scale where every seed is good (smaller keeps more realism).
  - Set FLUX_CONTROL_LORA_SCALE (and/or FLUX_CONTROL_GUIDANCE) in .env, restart Celery.
"""
import argparse
import os
import sys

import httpx

from app.replicate_service import run_model_prediction, get_lora_url

MODEL = os.getenv("FLUX_CONTROL_MODEL", "black-forest-labs/flux-canny-dev")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tune_out")


def render(control, prompt, guidance, steps, lora_url, lora_scale, seed):
    inp = {
        "prompt": prompt,
        "control_image": control,
        "guidance": guidance,
        "num_inference_steps": steps,
        "output_format": "jpg",
        "output_quality": 95,
        "seed": seed,
    }
    if lora_url:
        inp["extra_lora"] = lora_url
        inp["extra_lora_scale"] = lora_scale
    return run_model_prediction(MODEL, inp)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--control", required=True, help="composite image URL (from 'DEBUG 3D composite')")
    ap.add_argument("--prompt", help="prompt text (or use --prompt-file)")
    ap.add_argument("--prompt-file", help="path to a file containing the prompt")
    ap.add_argument("--wall-system", default="4_inch")
    ap.add_argument("--roof-style", default="gable")
    ap.add_argument("--scales", default="0.4,0.6,0.8,1.0", help="LoRA scales to sweep")
    ap.add_argument("--seeds", default="1111,2222,3333", help="fixed seeds, same for every scale")
    ap.add_argument("--guidance", type=float, default=float(os.getenv("FLUX_CONTROL_GUIDANCE", "30")))
    ap.add_argument("--steps", type=int, default=int(os.getenv("FLUX_CONTROL_STEPS", "28")))
    a = ap.parse_args()

    prompt = a.prompt
    if not prompt and a.prompt_file:
        with open(a.prompt_file, encoding="utf-8") as f:
            prompt = f.read().strip()
    if not prompt:
        sys.exit("Provide --prompt or --prompt-file")

    scales = [float(s) for s in a.scales.split(",")]
    seeds = [int(s) for s in a.seeds.split(",")]
    lora_url = get_lora_url(a.wall_system, a.roof_style)
    if not lora_url:
        print(f"WARNING: no LoRA for {a.wall_system}/{a.roof_style} — scale won't matter (base model).")

    os.makedirs(OUT, exist_ok=True)
    total = len(scales) * len(seeds)
    print(f"{total} predictions ({len(scales)} scales × {len(seeds)} seeds) — this costs Replicate credits.")
    print(f"model={MODEL}  guidance={a.guidance}  steps={a.steps}  lora={'yes' if lora_url else 'no'}\n")

    for sc in scales:
        for sd in seeds:
            print(f"  scale={sc} seed={sd} ...", flush=True)
            try:
                url = render(a.control, prompt, a.guidance, a.steps, lora_url, sc, sd)
                img = httpx.get(url, timeout=60).content
                p = os.path.join(OUT, f"scale_{sc}_seed_{sd}.jpg")
                with open(p, "wb") as f:
                    f.write(img)
                print(f"    -> {p}")
            except Exception as e:
                print(f"    FAILED: {e}")

    print(f"\nDone. Compare {OUT} as a grid (rows = scale, cols = seed).")
    print("Pick the SMALLEST scale where every seed is good, set FLUX_CONTROL_LORA_SCALE")
    print("in .env, and restart Celery.")


if __name__ == "__main__":
    main()
