"""End-to-end check of the gpt path exactly as tasks.py will run it: short
instruction, run_gpt_image (letterbox + crop), then the background re-lock that
forces everything outside the structure back to the real photo."""
import base64, io, json, sys, uuid
from pathlib import Path
import httpx
from PIL import Image
from dotenv import load_dotenv
load_dotenv(".env")
from app.database import supabase
from app.prompt_builder import build_gpt_instruction
from app.replicate_service import run_gpt_image, composite_masked, union_masks

SID, tag = sys.argv[1], sys.argv[2]

def _mount_ft(ds):
    try: return str((float(ds.get("mountHeight") or 0)) / 12)
    except (TypeError, ValueError): return ""

row = supabase.table("configurations").select("*").eq("id", SID).execute().data[0]
ds = row["draft_state"]; meta = ds.get("_meta") or {}
photo = httpx.get(row["house_photo_url"], timeout=60).content
img = Image.open(io.BytesIO(photo)).convert("RGB")
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
r.raise_for_status(); j = r.json()
comp = base64.b64decode(j["composite"])
Path(f"_ab_models_out/{tag}_composite.jpg").write_bytes(comp)
smask = base64.b64decode(j["mask"]) if j.get("mask") else None
shmask = base64.b64decode(j["shadowMask"]) if j.get("shadowMask") else None

path = f"debug-composites/{tag}-{uuid.uuid4().hex[:8]}.jpg"
supabase.storage.from_("renders").upload(path, comp, {"content-type": "image/jpeg"})
url = supabase.storage.from_("renders").get_public_url(path)

instr = build_gpt_instruction(wall_system=pl.get("wall_system") or "4_inch")
print("prompt:", instr)
out_url = run_gpt_image(url, instr)
raw = httpx.get(out_url, timeout=180).content
Path(f"_ab_models_out/{tag}_raw.jpg").write_bytes(raw)

lock = smask
if smask and shmask:
    try: lock = union_masks(smask, shmask)
    except Exception as e: print("union failed:", e)
if lock:
    final = composite_masked(out_url, pb, lock)
    Path(f"_ab_models_out/{tag}_final.jpg").write_bytes(final)
    print("wrote raw + background-restored final")
else:
    print("no mask — raw only")
