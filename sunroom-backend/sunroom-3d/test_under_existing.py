"""
test_under_existing.py — manual render check for the "under-existing" feature.

There is no automated test suite (see CLAUDE.md). This harness exercises the
under-existing pipeline WITHOUT a real covered-patio photo: it generates a
synthetic house photo (existing roof + patio), posts an under_existing payload
to the running 3D renderer, and saves the composite + mask PNGs so you can eye
the result.

It renders three variants:
  - gable   : pitched existing roof, GLASS gable/wing fill above the header
  - solid   : same roofline, SOLID gable/wing fill
  - studio  : near-flat (shed) existing roofline, glass fill

What a CORRECT render looks like:
  - the existing roof (dark shingle) shows ABOVE the traced roofline
  - a white header beam runs along the roofline
  - the glass walls + gable/wing fill sit BELOW it, clipped to the line
If instead you get a full-height glass box covering the whole roof, the
renderer is STALE: server.js loads once at process start and does not
hot-reload (only scene.html reloads per render). Restart it:
    node sunroom-3d/server.js

Usage:
    pip install pillow requests
    python test_under_existing.py            # uses RENDERER_3D_URL or :3001
    RENDERER_3D_URL=http://localhost:3002 python test_under_existing.py
Outputs land in ./_ue_out/ next to this script.
"""
import base64
import io
import json
import os
import sys

import requests
from PIL import Image, ImageDraw

PHOTO_W, PHOTO_H = 1000, 750
RENDERER = os.environ.get("RENDERER_3D_URL", "http://localhost:3001").rstrip("/")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ue_out")

# 5 capture markers (normalized), reusing the known-good PnP test case from
# RENDERER_CONTEXT.md (solves to ~16px reprojection error).
#   pt0 left/house/top, pt1 right/front/top, pt2 right/front/bottom,
#   pt3 origin (left house bottom), pt4 left/front/ground corner.
PTS = [[237 / 1000, 344 / 750], [818 / 1000, 329 / 750], [820 / 1000, 630 / 750],
       [239 / 1000, 604 / 750], [602 / 1000, 679 / 750]]

# Existing-roof underside (eave) polylines, normalized, left -> right.
GABLE_ROOFLINE = [[0.18, 0.46], [0.30, 0.40], [0.42, 0.345],
                  [0.58, 0.345], [0.70, 0.40], [0.86, 0.47]]
STUDIO_ROOFLINE = [[0.18, 0.40], [0.40, 0.42], [0.60, 0.44], [0.86, 0.47]]


def make_photo(roofline, peak_y):
    """Synthetic house: sky, an existing roof whose underside == roofline, patio."""
    img = Image.new("RGB", (PHOTO_W, PHOTO_H), (135, 178, 214))  # sky
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, PHOTO_W, int(0.30 * PHOTO_H)], fill=(150, 170, 200))  # house wall
    rl = [(int(x * PHOTO_W), int(y * PHOTO_H)) for x, y in roofline]
    peak = (PHOTO_W // 2, int(peak_y * PHOTO_H))
    d.polygon([rl[0]] + [peak] + [rl[-1]] + list(reversed(rl)), fill=(70, 62, 58))
    d.rectangle([0, int(0.78 * PHOTO_H), PHOTO_W, PHOTO_H], fill=(120, 115, 108))  # patio
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def wall(wall_id, width_ft, n_units, glass_type, gable_count):
    return {
        "id": wall_id,
        "widthFt": str(width_ft),
        "heightFt": "8",
        "panelTypes": ["fixed_glass"] * n_units,
        "unitMaterials": [{"transom": "glass", "kneewall": "glass"}] * n_units,
        "unitWidths": [],
        "gableGlass": {"glassType": glass_type, "count": gable_count},
    }


def render(name, roofline, glass_type, peak_y):
    payload = {
        "photoBase64": make_photo(roofline, peak_y),
        "photoW": PHOTO_W,
        "photoH": PHOTO_H,
        "pts": PTS,
        "roofline": roofline,
        "roofStyle": "under_existing",
        "wallSystem": "4_inch",
        "wallColor": "white",
        "mountHeight": "",
        "projectionDistance": "10",
        "wallData": json.dumps([
            wall("B", 18, 3, glass_type, 3),  # front wall (drawn)
            wall("C", 10, 2, glass_type, 2),  # near side return (drawn)
            # wall A (hidden far return) is priced but not drawn — omitted here.
        ]),
    }
    resp = requests.post(f"{RENDERER}/render", json=payload, timeout=120)
    resp.raise_for_status()
    out = resp.json()
    for key in ("composite", "mask"):
        if out.get(key):
            path = os.path.join(OUT_DIR, f"{name}_{key}.png")
            with open(path, "wb") as f:
                f.write(base64.b64decode(out[key]))
            print(f"  wrote {os.path.relpath(path)}")


def main():
    try:
        requests.get(f"{RENDERER}/health", timeout=5).raise_for_status()
    except Exception as e:
        sys.exit(f"renderer not reachable at {RENDERER} ({e}); start it with "
                 f"`node sunroom-3d/server.js`")
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"rendering under-existing variants against {RENDERER} -> {OUT_DIR}")
    render("gable", GABLE_ROOFLINE, "glass", peak_y=0.10)
    render("solid", GABLE_ROOFLINE, "solid", peak_y=0.10)
    render("studio", STUDIO_ROOFLINE, "glass", peak_y=0.30)
    print("done.")


if __name__ == "__main__":
    main()
