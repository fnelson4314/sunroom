"""ab_kontext.py — A/B: FLUX Kontext (image EDIT) vs the canny pipeline.

Runs Kontext on a REAL composite (default: the newest upload in the
debug-composites bucket, i.e. your latest actual generation) across a few fixed
seeds and both model tiers, and saves the outputs locally so you can compare
them against the canny renders you already have for the same composite.

Usage (venv active, from sunroom-backend/):
    python ab_kontext.py                       # newest real composite, 3 seeds
    python ab_kontext.py --control <url>       # a specific composite URL
    python ab_kontext.py --seeds 1111,2222     # custom seeds
    python ab_kontext.py --models pro          # pro only (dev|pro, comma-sep)

Cost: seeds x models Kontext calls (~$0.03-0.04 each). Outputs in ./_ab_out/.
"""
import argparse
import os

import httpx

from app.database import supabase
from app.prompt_builder import build_kontext_instruction
from app.replicate_service import run_flux_kontext

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ab_out")
MODELS = {
    "dev": "black-forest-labs/flux-kontext-dev",
    "pro": "black-forest-labs/flux-kontext-pro",
}


def latest_composite_url() -> str:
    files = supabase.storage.from_("renders").list("debug-composites")
    jpgs = [f for f in files if f["name"].endswith(".jpg")]
    if not jpgs:
        raise SystemExit("no composites found in debug-composites bucket")
    jpgs.sort(key=lambda f: f.get("created_at") or "", reverse=True)
    name = jpgs[0]["name"]
    print(f"using newest composite: {name} ({jpgs[0].get('created_at')})")
    return supabase.storage.from_("renders").get_public_url(f"debug-composites/{name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--control", help="composite URL (default: newest debug composite)")
    ap.add_argument("--seeds", default="1111,2222,3333")
    ap.add_argument("--models", default="dev,pro", help="comma-sep of dev,pro")
    ap.add_argument("--wall-system", default="4_inch")
    ap.add_argument("--wall-color", default="white")
    ap.add_argument("--roof-style", default="gable")
    args = ap.parse_args()

    control = args.control or latest_composite_url()
    seeds = [int(s) for s in args.seeds.split(",")]
    instruction = build_kontext_instruction(
        wall_system=args.wall_system,
        wall_color=args.wall_color,
        roof_style=args.roof_style,
    )
    print(f"instruction: {instruction}\n")
    os.makedirs(OUT_DIR, exist_ok=True)

    for short in args.models.split(","):
        os.environ["FLUX_KONTEXT_MODEL"] = MODELS[short.strip()]
        for seed in seeds:
            print(f"kontext-{short} seed={seed} ...")
            url = run_flux_kontext(control, instruction, seed=seed)
            out_path = os.path.join(OUT_DIR, f"kontext_{short}_s{seed}.jpg")
            with httpx.Client(timeout=60) as client:
                r = client.get(url)
                r.raise_for_status()
                with open(out_path, "wb") as f:
                    f.write(r.content)
            print(f"  -> {os.path.relpath(out_path)}")

    print("\ndone — compare _ab_out/ against the canny renders from the same composite.")


if __name__ == "__main__":
    main()
