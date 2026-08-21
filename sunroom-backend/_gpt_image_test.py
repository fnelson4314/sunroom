"""Test openai/gpt-image-1 on a LIVE session composite. The user got a first-try
correct render from ChatGPT on the same composite, which says the bottleneck was
the model family (FLUX Kontext), not the composite."""
import base64, io, json, sys, uuid
from pathlib import Path
import httpx
from PIL import Image
from app.database import supabase
from app.prompt_builder import build_kontext_instruction
from app.replicate_service import run_model_prediction

SID, tag = sys.argv[1], sys.argv[2]
row = supabase.table("configurations").select("*").eq("id", SID).execute().data[0]
ds = row["draft_state"]; meta = ds.get("_meta") or {}
img = Image.open(io.BytesIO(httpx.get(row["house_photo_url"], timeout=60).content)).convert("RGB")
if max(img.size) > 1280: img.thumbnail((1280, 1280), Image.LANCZOS)
buf = io.BytesIO(); img.save(buf, "JPEG", quality=95); pb, (W, H) = buf.getvalue(), img.size
wc = json.loads(meta.get("wall_corners") or "{}"); pl = ds.get("selectedProductLine") or {}
wall_data = json.dumps(ds["walls"])

r = httpx.post("http://localhost:3001/render", timeout=180, json={
    "photoBase64": base64.b64encode(pb).decode(), "photoW": W, "photoH": H, "pts": wc.get("_5pt"),
    "wallData": wall_data, "wallSystem": pl.get("wall_system") or "4_inch",
    "wallColor": ds.get("wallColor") or "white", "roofStyle": ds.get("roofStyle") or "gable",
    "mountHeight": ds.get("mountHeight") or "", "projectionDistance": ds.get("projectionDistance") or "",
    "wallCombo": ds.get("wallCombo"), "includeGableWings": ds.get("includeGableWings", True),
    "roofline": wc.get("_roofline"), "repaintMode": "kontext"})
r.raise_for_status()
comp = base64.b64decode(r.json()["composite"])
Path(f"_ab_models_out/{tag}_composite.jpg").write_bytes(comp)
path = f"lora-test/{tag}-{uuid.uuid4().hex[:8]}.jpg"
supabase.storage.from_("renders").upload(path, comp, {"content-type": "image/jpeg"})
url = supabase.storage.from_("renders").get_public_url(path)

full = build_kontext_instruction(
    wall_system=pl.get("wall_system") or "4_inch", wall_color=ds.get("wallColor") or "white",
    roof_style=ds.get("roofStyle") or "gable", wall_data=wall_data, wall_combo=ds.get("wallCombo"))
short = ("Turn this 3D-rendered sunroom overlay into a photorealistic sunroom, as if "
         "actually built and professionally photographed. Keep the exact structure, "
         "framing and panel layout that is drawn. Leave the house and yard unchanged.")

for name, prompt, fid in [("full_hi", full, "high"), ("short_hi", short, "high")]:
    try:
        out = run_model_prediction("openai/gpt-image-1", {
            "prompt": prompt, "input_images": [url], "input_fidelity": fid,
            "aspect_ratio": "auto", "quality": "high", "output_format": "jpg",
            "number_of_images": 1})
        Path(f"_ab_models_out/{tag}_{name}.jpg").write_bytes(httpx.get(out, timeout=180).content)
        print(f"  {name} -> {tag}_{name}.jpg")
    except Exception as e:
        print(f"  {name} FAILED: {str(e)[:200]}")
print("done")
