import base64, io, json, sys
from pathlib import Path
import httpx
from PIL import Image
from app.database import supabase
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

SID = sys.argv[1]; out = sys.argv[2]
row = supabase.table("configurations").select("*").eq("id", SID).execute().data[0]
ds = row["draft_state"]; meta = ds.get("_meta") or {}
img = Image.open(io.BytesIO(httpx.get(row["house_photo_url"], timeout=60).content)).convert("RGB")
if max(img.size) > 1280: img.thumbnail((1280, 1280), Image.LANCZOS)
buf = io.BytesIO(); img.save(buf, "JPEG", quality=95); pb, (W, H) = buf.getvalue(), img.size
wc = json.loads(meta.get("wall_corners") or "{}"); pl = ds.get("selectedProductLine") or {}
r = httpx.post("http://localhost:3001/render", timeout=180, json={
    "photoBase64": base64.b64encode(pb).decode(), "photoW": W, "photoH": H,
    "pts": wc.get("_5pt"), "wallData": json.dumps(ds["walls"]),
    "wallSystem": pl.get("wall_system") or "4_inch", "wallColor": ds.get("wallColor") or "white",
    "roofStyle": ds.get("roofStyle") or "gable", "mountHeight": _mount_ft(ds),
    "projectionDistance": ds.get("projectionDistance") or "", "wallCombo": ds.get("wallCombo"),
    "includeGableWings": ds.get("includeGableWings", True), "roofline": wc.get("_roofline"),
    "repaintMode": "kontext"})
r.raise_for_status()
j = r.json()
Path(out).write_bytes(base64.b64decode(j["composite"]))
print("fit:", json.dumps(j.get("fit"), indent=None), "| combo:", j.get("combo"))
