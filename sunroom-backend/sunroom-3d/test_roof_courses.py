"""test_roof_courses.py — check that roof shingle COURSE LINES actually render.

Why this exists: the AB (gableOnFront) roof was built from BufferGeometry quads
with NO uv attribute, so the shingle texture sampled a single texel and the roof
rendered as a flat lineless surface — Canny then had no "shingled roof" signal
and the AI painted flat/unnatural roofs on exactly the user's main capture flow.
Fixed 2026-07-12 (uv attribute + per-slope course density in scene.html).

This harness renders new-roof composites (AB gable, BC gable, studio) against a
synthetic photo, isolates the roof area (rendered dark pixels above the wall
tops), and counts horizontal course lines via the row-luminance profile. It
fails if any roof comes back lineless.

Usage (renderer must be running on :3001):
    venv/Scripts/python.exe sunroom-3d/test_roof_courses.py
Outputs land in ./_roof_out/ next to this script for eyeballing.
"""
import base64
import io
import json
import os
import sys

import numpy as np
import requests
from PIL import Image, ImageDraw

PHOTO_W, PHOTO_H = 1000, 750
RENDERER = os.environ.get("RENDERER_3D_URL", "http://localhost:3001").rstrip("/")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_roof_out")

# Known-good 5-point set (same as test_under_existing.py, ~16px reprojection).
PTS = [[237 / 1000, 344 / 750], [818 / 1000, 329 / 750], [820 / 1000, 630 / 750],
       [239 / 1000, 604 / 750], [602 / 1000, 679 / 750]]
WALL_TOP_Y = int(0.46 * PHOTO_H)  # everything above this is roof territory


def make_photo() -> tuple[str, np.ndarray]:
    """Plain sky/house/patio photo — no roof drawn, so any dark pixels the
    renderer adds above the wall tops ARE the new roof."""
    img = Image.new("RGB", (PHOTO_W, PHOTO_H), (135, 178, 214))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, PHOTO_W, int(0.30 * PHOTO_H)], fill=(150, 170, 200))
    d.rectangle([0, int(0.78 * PHOTO_H), PHOTO_W, PHOTO_H], fill=(120, 115, 108))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode(), np.asarray(img, dtype=np.int16)


def wall(wall_id, width_ft, n_units):
    return {
        "id": wall_id,
        "widthFt": str(width_ft),
        "heightFt": "8",
        "panelTypes": ["fixed_glass"] * n_units,
        "unitMaterials": [{}] * n_units,
        "unitWidths": [],
    }


def roof_texture_pct(composite: Image.Image, orig: np.ndarray) -> float:
    """% of interior roof pixels with visible luminance structure (course lines).

    Direction-agnostic on purpose: in perspective the courses are diagonal on
    some slopes, so a row-profile misses them. A lineless roof (the pre-fix AB
    bug) is a flat fill -> near-zero interior gradient; a textured one isn't.
    """
    comp = np.asarray(composite.convert("RGB"), dtype=np.int16)
    lum = comp.mean(axis=2)
    changed = np.abs(comp - orig).sum(axis=2) > 40      # pixels the renderer drew
    roofish = changed & (lum < 110)                      # dark (shingle), not white fascia
    roofish[WALL_TOP_Y:, :] = False                      # above the wall tops only
    if roofish.sum() < 500:
        return -1.0                                      # no roof found at all

    # Erode 2px so silhouette/fascia edges don't count as "texture".
    interior = roofish.copy()
    for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
        interior &= np.roll(roofish, shift, axis=axis)
        interior &= np.roll(roofish, 2 * shift, axis=axis)

    grad = np.abs(np.gradient(lum, axis=0)) + np.abs(np.gradient(lum, axis=1))
    return float((grad[interior] > 3.0).mean() * 100)


def render(name: str, wall_data: list, combo: str, roof_style: str,
           photo_b64: str, orig: np.ndarray) -> int:
    payload = {
        "photoBase64": photo_b64,
        "photoW": PHOTO_W,
        "photoH": PHOTO_H,
        "pts": PTS,
        "roofStyle": roof_style,
        "wallSystem": "4_inch",
        "wallColor": "white",
        "mountHeight": "",
        "projectionDistance": "10",
        "wallCombo": combo,
        "wallData": json.dumps(wall_data),
    }
    resp = requests.post(f"{RENDERER}/render", json=payload, timeout=120)
    resp.raise_for_status()
    out = resp.json()
    comp = Image.open(io.BytesIO(base64.b64decode(out["composite"])))
    comp.save(os.path.join(OUT_DIR, f"{name}_composite.jpg"))
    pct = roof_texture_pct(comp, orig)
    print(f"  {name:10s} combo={out.get('combo')} textured roof pixels: {pct:.1f}%")
    return pct


def main():
    try:
        requests.get(f"{RENDERER}/health", timeout=5).raise_for_status()
    except Exception as e:
        sys.exit(f"renderer not reachable at {RENDERER} ({e})")
    os.makedirs(OUT_DIR, exist_ok=True)
    photo_b64, orig = make_photo()
    print(f"rendering roof-course checks against {RENDERER} -> {OUT_DIR}")

    results = {
        "ab_gable": render("ab_gable", [wall("A", 10, 2), wall("B", 13, 3)],
                           "AB", "gable", photo_b64, orig),
        "bc_gable": render("bc_gable", [wall("B", 10, 2), wall("C", 13, 3)],
                           "BC", "gable", photo_b64, orig),
        "studio":   render("studio",   [wall("B", 10, 2), wall("C", 13, 3)],
                           "BC", "studio", photo_b64, orig),
    }
    # A flat lineless roof (the pre-fix AB bug) measures ~0-1%; a roof WITH course
    # lines measures ~5%. The absolute numbers dropped once the roof planes went
    # UNLIT dark (2026-07-21, to kill the tan-washed roofline) — a dark roof has a
    # smaller luminance gradient than the old light-washed one, so ab_gable fell
    # from ~22% to ~5%. 3% still cleanly separates "has courses" (~5%) from the
    # lineless failure (~0-1%); the studio shed shows only a grazing sliver.
    floors = {"ab_gable": 3.0, "bc_gable": 3.0, "studio": 2.0}
    bad = {k: v for k, v in results.items() if v < floors[k]}
    assert not bad, f"roof(s) render without visible course lines: {bad}"
    print("test_roof_courses: all roofs show course lines")


if __name__ == "__main__":
    main()
