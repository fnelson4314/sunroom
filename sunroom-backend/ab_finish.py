"""ab_finish.py — Phase 3 bake-off: which model best FINISHES the assembly?

Takes the assembled regional render (exact structure + AI glass/roof) and runs
every finishing candidate over it at low creativity/strength. Writes outputs +
a gallery, and reports a whole-image edge-drift number vs the input for each
(comparative ranking only — the production config gate does the real, masked
drift check per render).

Usage (venv active, from sunroom-backend/):
    python ab_finish.py                    # newest completed render, all candidates
    python ab_finish.py --input <url>      # a specific assembled render URL
    python ab_finish.py --models clarity,topaz

Judge in the gallery: which one makes the structure look like a PHOTOGRAPH
(real siding texture, aluminum frames, unified light) while the drift number
stays low. If clarity/topaz wins, the finish and the 2K upscale collapse into
one call.
"""
import argparse
import html
import io
import os
import time

import httpx
import numpy as np
from PIL import Image

from app.config_gate import drift_score
from app.database import supabase
from app.replicate_service import (
    get_latest_version,
    run_flux_polish,
    run_model_prediction,
    run_prediction,
)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ab_finish_out")

FINISH_PROMPT = (
    "Make this a crisp professional real-estate photograph. Improve material "
    "realism and lighting only. Do not move, add, remove or resize anything."
)


def run_any(slug: str, input_data: dict) -> str:
    """Named endpoint first (official models); 404 → resolve version and use the
    generic predictions endpoint (community models)."""
    try:
        return run_model_prediction(slug, input_data)
    except Exception as e:
        if "404" not in str(e):
            raise
        return run_prediction(get_latest_version(slug), input_data)


def _flux(url):
    return run_flux_polish(url, seed=1111, strength=0.2)


def _clarity(url):
    return run_any(
        "philz1337x/clarity-upscaler",
        {
            "image": url,
            "creativity": 0.25,
            "resemblance": 1.5,
            "scale_factor": 2,  # doubles as the 2K upscale
            "output_format": "jpg",
        },
    )


def _clarity_pro(url):
    return run_any(
        "philz1337x/clarity-pro-upscaler",
        {"image": url, "creativity": 0.25, "resemblance": 1.5, "scale_factor": 2},
    )


def _banana(url):
    return run_any(
        "google/nano-banana-2",
        {"prompt": FINISH_PROMPT, "image_input": [url], "output_format": "jpg"},
    )


def _topaz(url):
    return run_any(
        "topazlabs/image-upscale",
        {"image": url, "enhance_model": "CGI", "upscale_factor": "2x"},
    )


CANDIDATES = {
    "flux-dev": (_flux, "~$0.03, current"),
    "clarity": (_clarity, "~$0.03, tile re-diffusion + 2x"),
    "clarity-pro": (_clarity_pro, "~$0.06, stronger tier + 2x"),
    "nano-banana-2": (_banana, "~$0.08, editor-class preservation"),
    "topaz-cgi": (_topaz, "~$0.05, CGI->photo + 2x"),
}


def newest_render_url() -> str:
    rows = (
        supabase.table("configurations")
        .select("render_url,updated_at")
        .eq("status", "complete")
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    if not rows.data or not rows.data[0].get("render_url"):
        raise SystemExit("no completed render found — pass --input <url>")
    url = rows.data[0]["render_url"]
    print(f"using newest completed render: {url}")
    return url


def edge_drift_vs_input(input_bytes: bytes, out_bytes: bytes) -> float:
    """Whole-image drift proxy (no masks here): white mask over everything."""
    w, h = Image.open(io.BytesIO(input_bytes)).size
    buf = io.BytesIO()
    Image.fromarray(np.full((h, w), 255, np.uint8)).save(buf, format="PNG")
    return drift_score(out_bytes, input_bytes, buf.getvalue())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", help="assembled render URL (default: newest completed)")
    ap.add_argument("--models", default=",".join(CANDIDATES))
    args = ap.parse_args()

    src = args.input or newest_render_url()
    os.makedirs(OUT_DIR, exist_ok=True)
    with httpx.Client(timeout=60) as c:
        input_bytes = c.get(src).content
    with open(os.path.join(OUT_DIR, "input.jpg"), "wb") as f:
        f.write(input_bytes)

    cells = []
    for short in [m.strip() for m in args.models.split(",") if m.strip()]:
        fn, note = CANDIDATES[short]
        print(f"{short} ...")
        t0 = time.time()
        try:
            url = fn(src)
            with httpx.Client(timeout=180) as c:
                out_bytes = c.get(url).content
            fname = f"{short}.jpg"
            with open(os.path.join(OUT_DIR, fname), "wb") as f:
                f.write(out_bytes)
            drift = edge_drift_vs_input(input_bytes, out_bytes)
            cells.append({
                "label": short,
                "meta": f"{note}, {time.time() - t0:.0f}s, drift {drift:.3f}",
                "file": fname,
            })
            print(f"  -> {fname} ({time.time() - t0:.0f}s, drift {drift:.3f})")
        except Exception as e:
            cells.append({"label": short, "meta": note, "error": str(e)[:300]})
            print(f"  SKIPPED: {str(e)[:200]}")

    rows = "".join(
        f"""
      <div class="card">
        <h3>{html.escape(c['label'])} <span class="meta">{html.escape(c['meta'])}</span></h3>
        {"<img src='" + html.escape(c['file']) + "'/>" if c.get('file')
         else "<p class='err'>" + html.escape(c.get('error', '?')) + "</p>"}
      </div>"""
        for c in cells
    )
    doc = f"""<!doctype html><meta charset="utf-8"><title>Finish bake-off</title>
<style>
 body{{background:#14171a;color:#dde3e8;font:14px system-ui;margin:20px}}
 .card{{margin:0 0 26px}} img{{max-width:100%;border-radius:6px}}
 h3{{margin:6px 0}} .meta{{color:#8a949e;font-weight:400;font-size:12px}}
 .err{{color:#e08080}}
</style>
<h1>Finishing-pass bake-off</h1>
<p>Pick: most photographic structure at the LOWEST drift number.</p>
<div class="card"><h3>INPUT — assembled render</h3><img src="input.jpg"/></div>
{rows}"""
    path = os.path.join(OUT_DIR, "gallery.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"\ngallery -> {path}")


if __name__ == "__main__":
    main()
