"""Test the OpenAI image models on a LIVE session composite.

Aspect: these models only emit 1:1 / 3:2 / 2:3. Our composite is 4:3, so it is
LETTERBOXED to 3:2 going in and cropped back on the way out — the structure keeps
its proportions instead of being stretched, which would move every frame line.
"""
import base64, io, json, os, sys, uuid
from pathlib import Path
import httpx
from PIL import Image
from dotenv import load_dotenv
load_dotenv(".env")
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

SID, tag = sys.argv[1], sys.argv[2]
MODELS = [("g15", "openai/gpt-image-1.5"), ("g2", "openai/gpt-image-2"), ("g1", "openai/gpt-image-1")]

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
    "mountHeight": _mount_ft(ds), "projectionDistance": ds.get("projectionDistance") or "",
    "wallCombo": ds.get("wallCombo"), "includeGableWings": ds.get("includeGableWings", True),
    "roofline": wc.get("_roofline"), "repaintMode": "kontext"})
r.raise_for_status()
comp = base64.b64decode(r.json()["composite"])
Path(f"_ab_models_out/{tag}_composite.jpg").write_bytes(comp)

# 4:3 -> 3:2 letterbox. 4:3 is 1.333 and 3:2 is 1.5, so the canvas needs MORE
# WIDTH, not less height — pad left/right and never stretch, since stretching
# would move every frame line and defeat the whole point.
src = Image.open(io.BytesIO(comp)).convert("RGB")
th = src.height; tw = int(round(th * 3 / 2))
pad = Image.new("RGB", (tw, th), (255, 255, 255))
off = (tw - src.width) // 2
pad.paste(src, (off, 0))
b = io.BytesIO(); pad.save(b, "JPEG", quality=95)
path = f"lora-test/{tag}-{uuid.uuid4().hex[:8]}.jpg"
supabase.storage.from_("renders").upload(path, b.getvalue(), {"content-type": "image/jpeg"})
url = supabase.storage.from_("renders").get_public_url(path)
print(f"composite {src.size} -> letterboxed {pad.size}")

instr = build_kontext_instruction(
    wall_system=pl.get("wall_system") or "4_inch", wall_color=ds.get("wallColor") or "white",
    roof_style=ds.get("roofStyle") or "gable", wall_data=wall_data, wall_combo=ds.get("wallCombo"))
# The user's ACTUAL ChatGPT prompt, verbatim. Our long instruction was tuned for
# FLUX Kontext, which had to be argued into keeping things — every clause is a
# prohibition. These models follow literally, so a wall of constraints may pull
# attention away from the picture. Prompt length is the one controllable
# difference between the working ChatGPT result and our API calls.
USER_PROMPT = ("Take this 3d composite config wall design and turn it into a "
               "photorealistic sunroom:")
PROMPTS = {"userp": USER_PROMPT, "full": instr}

key = os.getenv("OPENAI_API_KEY")

for name, slug in MODELS:
    for pname, prompt in PROMPTS.items():
        inp = {"prompt": prompt, "input_images": [url], "aspect_ratio": "3:2",
               "quality": "high", "output_format": "jpeg", "number_of_images": 1,
               "openai_api_key": key}
        if name != "g2":
            inp["input_fidelity"] = "high"
        try:
            out = run_model_prediction(slug, inp)
            raw = httpx.get(out, timeout=180).content
            o = Image.open(io.BytesIO(raw)).convert("RGB")
            o = o.resize(pad.size, Image.LANCZOS).crop((off, 0, off + src.width, th))
            o.save(f"_ab_models_out/{tag}_{name}_{pname}.jpg", quality=95)
            print(f"  {name}/{pname} -> {tag}_{name}_{pname}.jpg")
        except Exception as e:
            print(f"  {name}/{pname} FAILED: {str(e)[:160]}")
print("done")
