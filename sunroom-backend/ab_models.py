"""ab_models.py — Phase 2 bake-off: which editor paints the best GLASS + ROOF?

Runs the SAME real composite (default: newest debug-composites upload) through
every candidate editing model and writes the outputs plus a side-by-side
gallery.html. Judge ONLY what the regional composite keeps from the AI: glass
realism, in-pane hallucination (invented mullions inside a pane), and roof
shingle/blend quality. Structure fidelity is IRRELEVANT here — frames, solids
and doors come from the exact composite by construction.

Usage (venv active, from sunroom-backend/):
    python ab_models.py                    # newest composite, all models, 2 runs each
    python ab_models.py --models kontext-pro,nano-banana-pro
    python ab_models.py --runs 1           # one run per model (cheapest pass)
    python ab_models.py --control <url>

Cost: roughly $0.85 for the full default sweep (2 runs x 6 models).
Outputs in ./_ab_models_out/ + gallery.html there.

A model that 404s (not on Replicate under that slug) or 422s (input schema
drifted) is SKIPPED with the error recorded in the gallery — the sweep never
dies half-way.
"""
import argparse
import html
import os
import time

import httpx

from app.database import supabase
from app.prompt_builder import build_kontext_instruction
from app.replicate_service import run_model_prediction

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ab_models_out")

# Instruction shared by every candidate (they are all instruction editors); the
# config lives in the composite pixels, so this stays SHORT on purpose — same
# rule as build_kontext_instruction.

# model slug -> (input builder, price note). Each builder returns the Replicate
# `input` dict for that model's schema. Seeds only where the schema takes one.
def _kontext(img, prompt, seed):
    d = {
        "prompt": prompt,
        "input_image": img,
        "aspect_ratio": "match_input_image",
        "output_format": "jpg",
    }
    if seed is not None:
        d["seed"] = seed
    return d


def _banana(img, prompt, seed):
    # google nano-banana family: image_input is a LIST; no seed input.
    return {"prompt": prompt, "image_input": [img], "output_format": "jpg"}


def _seedream(img, prompt, seed):
    return {"prompt": prompt, "image_input": [img]}


def _kontext_lora(img, prompt, seed):
    """Our OWN paired LoRA on kontext-dev. This is the model trained on 46 real
    Champion installs — the one thing in the field that knows what OUR sunrooms
    look like rather than a generic industry one. It was missing from the
    2026-08-15 bake-off, so nano-banana won a race the champion never entered.
    LoRA knobs are `lora_weights` (public HF resolve URL) + `lora_strength`
    (NOT lora_scale). Cold LoRA loads can exceed 3min — the poller allows it.
    """
    d = _kontext(img, prompt, seed)
    # guidance 2.5 — the value lora_ab_v2.py validated this LoRA at. Kontext's
    # own default differs; matching the harness keeps this comparable to the
    # v2 gallery the checkpoint was chosen from.
    d["guidance"] = float(os.getenv("FLUX_KONTEXT_GUIDANCE", "2.5"))
    d["lora_weights"] = os.getenv(
        "FLUX_KONTEXT_LORA_WEIGHTS",
        "https://huggingface.co/fnelson4314/sunroom-kontext-lora/resolve/main/"
        "sunroom_kontext_lora_v2_000002500.safetensors",
    )
    d["lora_strength"] = float(os.getenv("FLUX_KONTEXT_LORA_STRENGTH", "1.0"))
    return d


def _qwen(img, prompt, seed):
    d = {"prompt": prompt, "image": img, "output_format": "jpg"}
    if seed is not None:
        d["seed"] = seed
    return d


MODELS = {
    # OUR paired LoRA — the Champion-look contender. Checkpoint comes from
    # FLUX_KONTEXT_LORA_WEIGHTS so you can A/B checkpoints without editing code.
    "kontext-lora": ("black-forest-labs/flux-kontext-dev-lora", _kontext_lora, "$0.03"),
    # Base dev, NO LoRA: the cheap composite validator (follows the composite
    # literally, zero learned bias) AND the control that separates "the LoRA did
    # this" from "kontext did this".
    "kontext-dev": ("black-forest-labs/flux-kontext-dev", _kontext, "$0.03"),
    "kontext-pro": ("black-forest-labs/flux-kontext-pro", _kontext, "$0.04"),
    "kontext-max": ("black-forest-labs/flux-kontext-max", _kontext, "$0.08"),
    "nano-banana-pro": ("google/nano-banana-pro", _banana, "~$0.15"),
    "nano-banana-2": ("google/nano-banana-2", _banana, "~$0.08"),
    "seedream-4": ("bytedance/seedream-4", _seedream, "~$0.03"),
    "qwen-image-edit": ("qwen/qwen-image-edit", _qwen, "~$0.03"),
}


def latest_composite_url() -> str:
    # limit: the API returns only the FIRST 100 entries by default, ordered by
    # name — and there are hundreds of composites, so the default silently picked
    # a months-old one that merely sorted first. Ask for all of them, then sort by
    # created_at ourselves.
    files = supabase.storage.from_("renders").list(
        "debug-composites", {"limit": 2000}
    )
    jpgs = [f for f in files if f["name"].endswith(".jpg")]
    if not jpgs:
        raise SystemExit("no composites found in debug-composites bucket")
    jpgs.sort(key=lambda f: f.get("created_at") or "", reverse=True)
    name = jpgs[0]["name"]
    print(f"using newest composite: {name} ({jpgs[0].get('created_at')})")
    return supabase.storage.from_("renders").get_public_url(f"debug-composites/{name}")


def write_gallery(control_url: str, cells: list[dict]):
    rows = "".join(
        f"""
      <div class="card">
        <h3>{html.escape(c['label'])} <span class="meta">{html.escape(c['meta'])}</span></h3>
        {"<img src='" + html.escape(c['file']) + "'/>" if c.get('file')
         else "<p class='err'>" + html.escape(c.get('error', '?')) + "</p>"}
      </div>"""
        for c in cells
    )
    doc = f"""<!doctype html><meta charset="utf-8"><title>Glass bake-off</title>
<style>
 body{{background:#14171a;color:#dde3e8;font:14px system-ui;margin:20px}}
 .card{{margin:0 0 26px}} img{{max-width:100%;border-radius:6px}}
 h3{{margin:6px 0}} .meta{{color:#8a949e;font-weight:400;font-size:12px}}
 .err{{color:#e08080}}
</style>
<h1>Glass + roof bake-off</h1>
<p>Judge ONLY: glass realism / in-pane hallucination / roof blend. Structure is
discarded by the regional composite.</p>
<div class="card"><h3>CONTROL — exact composite</h3><img src="{html.escape(control_url)}"/></div>
{rows}"""
    path = os.path.join(OUT_DIR, "gallery.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"\ngallery -> {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--control", help="composite URL (default: newest debug composite)")
    ap.add_argument("--models", default=",".join(MODELS), help="comma-sep of " + ",".join(MODELS))
    ap.add_argument("--runs", type=int, default=2, help="samples per model")
    ap.add_argument("--wall-system", default="4_inch")
    ap.add_argument("--wall-color", default="white")
    ap.add_argument("--roof-style", default="gable")
    ap.add_argument(
        "--instruction",
        help="override build_kontext_instruction — for A/B-ing the wording itself, "
        "e.g. the glass clause. The composite carries LAYOUT; the instruction "
        "carries STYLE, so they are independent levers.",
    )
    args = ap.parse_args()

    control = args.control or latest_composite_url()
    instruction = args.instruction or build_kontext_instruction(
        wall_system=args.wall_system,
        wall_color=args.wall_color,
        roof_style=args.roof_style,
    )
    print(f"instruction: {instruction}\n")
    os.makedirs(OUT_DIR, exist_ok=True)

    cells = []
    for short in [m.strip() for m in args.models.split(",") if m.strip()]:
        slug, build, price = MODELS[short]
        for run in range(args.runs):
            seed = 1111 + run  # honored only by models whose schema takes it
            # --runs N is the RELIABILITY check, not a nicety: Kontext is
            # stochastic, so a single good sample proves nothing about what the
            # salesperson gets on a Tuesday. Judge the WORST of N, not the best.
            label = f"{short} run{run}"
            print(f"{label} ({slug}) ...")
            t0 = time.time()
            try:
                url = run_model_prediction(slug, build(control, instruction, seed))
                fname = f"{short}_r{run}.jpg"
                with httpx.Client(timeout=120) as client:
                    r = client.get(url)
                    r.raise_for_status()
                    with open(os.path.join(OUT_DIR, fname), "wb") as f:
                        f.write(r.content)
                cells.append({
                    "label": label,
                    "meta": f"{price}, {time.time() - t0:.0f}s",
                    "file": fname,
                })
                print(f"  -> {fname} ({time.time() - t0:.0f}s)")
            except Exception as e:
                cells.append({"label": label, "meta": price, "error": str(e)[:300]})
                print(f"  SKIPPED: {str(e)[:200]}")

    write_gallery(control, cells)


if __name__ == "__main__":
    main()
