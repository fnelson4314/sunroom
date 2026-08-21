"""Render + dev-base a LIVE session straight from its draft_state, so the test
uses exactly what the app has (the LORA manifest is stale snapshot data — testing
against it is how I ended up proving the wrong thing)."""
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
tag = sys.argv[2] if len(sys.argv) > 2 else "live"
row = supabase.table("configurations").select("*").eq("id", SID).execute().data[0]
ds = row["draft_state"]; meta = ds.get("_meta") or {}

photo_url = row.get("house_photo_url") or meta.get("photoUri")
img = Image.open(io.BytesIO(httpx.get(photo_url, timeout=60).content)).convert("RGB")
if max(img.size) > 1280:
    img.thumbnail((1280, 1280), Image.LANCZOS)
buf = io.BytesIO(); img.save(buf, "JPEG", quality=95)
pb, (W, H) = buf.getvalue(), img.size

wc = json.loads(meta.get("wall_corners") or "{}")
pts = wc.get("_5pt") or (wc.get("B") if isinstance(wc.get("B"), list) else None)
wall_data = json.dumps(ds["walls"])
pl = ds.get("selectedProductLine") or {}

r = httpx.post("http://localhost:3001/render", timeout=180, json={
    "photoBase64": base64.b64encode(pb).decode(), "photoW": W, "photoH": H, "pts": pts,
    "wallData": wall_data, "wallSystem": pl.get("wall_system") or "4_inch",
    "wallColor": ds.get("wallColor") or "white", "roofStyle": ds.get("roofStyle") or "gable",
    "mountHeight": _mount_ft(ds), "projectionDistance": ds.get("projectionDistance") or "",
    "wallCombo": ds.get("wallCombo"), "includeGableWings": ds.get("includeGableWings", True),
    "roofline": wc.get("_roofline"), "repaintMode": "kontext",
})
r.raise_for_status()
comp = base64.b64decode(r.json()["composite"])
Path(f"_ab_models_out/{tag}_composite.jpg").write_bytes(comp)

path = f"lora-test/{tag}-{uuid.uuid4().hex[:8]}.jpg"
supabase.storage.from_("renders").upload(path, comp, {"content-type": "image/jpeg"})
url = supabase.storage.from_("renders").get_public_url(path)

instr = build_kontext_instruction(
    wall_system=pl.get("wall_system") or "4_inch", wall_color=ds.get("wallColor") or "white",
    roof_style=ds.get("roofStyle") or "gable", wall_data=wall_data, wall_combo=ds.get("wallCombo"))
out = run_model_prediction("black-forest-labs/flux-kontext-dev", {
    "prompt": instr, "input_image": url, "aspect_ratio": "match_input_image",
    "output_format": "jpg", "seed": 1111})
Path(f"_ab_models_out/{tag}_render.jpg").write_bytes(httpx.get(out, timeout=120).content)
print("done ->", f"{tag}_composite.jpg /", f"{tag}_render.jpg")
