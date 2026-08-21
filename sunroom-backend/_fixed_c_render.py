import base64, io, json, uuid
from pathlib import Path
import httpx
from PIL import Image
from app.database import supabase
from app.prompt_builder import build_kontext_instruction
from app.replicate_service import run_model_prediction

REVIEW = Path(r"C:\Users\fnels\LORA_review")
m = json.loads((REVIEW / "manifest.json").read_text())[3]
wall_data = Path("_fixed_c_walldata.json").read_text()

photo = httpx.get(m["house_photo_url"], timeout=60).content
img = Image.open(io.BytesIO(photo)).convert("RGB")
if max(img.size) > 1280:
    img.thumbnail((1280, 1280), Image.LANCZOS)
buf = io.BytesIO(); img.save(buf, "JPEG", quality=95)
pb, (W, H) = buf.getvalue(), img.size

wc = json.loads(m["wall_corners"])
pts = wc.get("_5pt")

r = httpx.post("http://localhost:3001/render", timeout=180, json={
    "photoBase64": base64.b64encode(pb).decode(), "photoW": W, "photoH": H, "pts": pts,
    "wallData": wall_data, "wallSystem": m.get("wall_system") or "6_inch",
    "wallColor": m.get("wall_color") or "white", "roofStyle": m.get("roof_style") or "gable",
    "mountHeight": m.get("mount_height") or "", "projectionDistance": m.get("projection_distance") or "",
    "wallCombo": m.get("wall_combo"), "includeGableWings": True, "repaintMode": "kontext",
})
r.raise_for_status()
comp = base64.b64decode(r.json()["composite"])
Path("_ab_models_out/fixedC_composite.jpg").write_bytes(comp)

path = f"lora-test/fixedc-{uuid.uuid4().hex[:8]}.jpg"
supabase.storage.from_("renders").upload(path, comp, {"content-type": "image/jpeg"})
url = supabase.storage.from_("renders").get_public_url(path)

instr = build_kontext_instruction(wall_system=m.get("wall_system") or "6_inch",
                                  wall_color=m.get("wall_color") or "white",
                                  roof_style=m.get("roof_style") or "gable",
                                  wall_data=wall_data)
out = run_model_prediction("black-forest-labs/flux-kontext-dev", {
    "prompt": instr, "input_image": url, "aspect_ratio": "match_input_image",
    "output_format": "jpg", "seed": 1111})
Path("_ab_models_out/fixedC_render.jpg").write_bytes(httpx.get(out, timeout=120).content)
print("done -> fixedC_composite.jpg / fixedC_render.jpg")
