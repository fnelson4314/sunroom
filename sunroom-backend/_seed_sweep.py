"""5-seed sweep on a LIVE session's composite. Answers the one question none of
today's tests did: is the door failure DETERMINISTIC or a coin flip? Every prior
single-run A/B used seed 1111, so 'it always fails' was never actually measured.

  python _seed_sweep.py <session_id> [tag] [model]
"""
import base64, io, json, sys, uuid
from pathlib import Path
import httpx
from PIL import Image
from app.database import supabase
from app.prompt_builder import build_kontext_instruction
from app.replicate_service import run_model_prediction

# mountHeight is stored in INCHES in draft_state and converted to FEET at the
# API boundary (useConfigureState.ts ~L2057: `/12`). Reading draft_state directly
# BYPASSES that conversion, and the renderer multiplies by 12 again — a 133in
# peak became 133 FEET and the gable shot off the top of the frame. Any harness
# that talks to the renderer from draft_state must do this conversion itself.
def _mount_ft(ds):
    try:
        return str((float(ds.get("mountHeight") or 0)) / 12)
    except (TypeError, ValueError):
        return ""

SID = sys.argv[1]
tag = sys.argv[2] if len(sys.argv) > 2 else "seed"
model = sys.argv[3] if len(sys.argv) > 3 else "black-forest-labs/flux-kontext-dev"
import os
SEEDS = [int(x) for x in os.getenv("SEEDS", "1111,2222,3333,4444,5555").split(",")]

row = supabase.table("configurations").select("*").eq("id", SID).execute().data[0]
ds = row["draft_state"]; meta = ds.get("_meta") or {}
img = Image.open(io.BytesIO(httpx.get(row.get("house_photo_url") or meta.get("photoUri"), timeout=60).content)).convert("RGB")
if max(img.size) > 1280:
    img.thumbnail((1280, 1280), Image.LANCZOS)
buf = io.BytesIO(); img.save(buf, "JPEG", quality=95)
pb, (W, H) = buf.getvalue(), img.size
wc = json.loads(meta.get("wall_corners") or "{}")
wall_data = json.dumps(ds["walls"]); pl = ds.get("selectedProductLine") or {}

r = httpx.post("http://localhost:3001/render", timeout=180, json={
    "photoBase64": base64.b64encode(pb).decode(), "photoW": W, "photoH": H,
    "pts": wc.get("_5pt"), "wallData": wall_data,
    "wallSystem": pl.get("wall_system") or "4_inch", "wallColor": ds.get("wallColor") or "white",
    "roofStyle": ds.get("roofStyle") or "gable", "mountHeight": _mount_ft(ds),
    "projectionDistance": ds.get("projectionDistance") or "", "wallCombo": ds.get("wallCombo"),
    "includeGableWings": ds.get("includeGableWings", True), "roofline": wc.get("_roofline"),
    "repaintMode": "kontext"})
r.raise_for_status()
comp = base64.b64decode(r.json()["composite"])
Path(f"_ab_models_out/{tag}_composite.jpg").write_bytes(comp)
path = f"lora-test/{tag}-{uuid.uuid4().hex[:8]}.jpg"
supabase.storage.from_("renders").upload(path, comp, {"content-type": "image/jpeg"})
url = supabase.storage.from_("renders").get_public_url(path)

instr = build_kontext_instruction(
    wall_system=pl.get("wall_system") or "4_inch", wall_color=ds.get("wallColor") or "white",
    roof_style=ds.get("roofStyle") or "gable", wall_data=wall_data, wall_combo=ds.get("wallCombo"))

extra = {}
if "lora" in model:
    import os
    extra = {"lora_weights": os.getenv("FLUX_KONTEXT_LORA_WEIGHTS"),
             "lora_strength": float(os.getenv("FLUX_KONTEXT_LORA_STRENGTH", "1.0")),
             "guidance": 2.5}
for sd in SEEDS:
    try:
        out = run_model_prediction(model, {
            "prompt": instr, "input_image": url, "aspect_ratio": "match_input_image",
            "output_format": "jpg", "seed": sd, **extra})
        Path(f"_ab_models_out/{tag}_s{sd}.jpg").write_bytes(httpx.get(out, timeout=120).content)
        print(f"  seed {sd} -> {tag}_s{sd}.jpg")
    except Exception as e:
        print(f"  seed {sd} FAILED: {str(e)[:120]}")
print("done")
