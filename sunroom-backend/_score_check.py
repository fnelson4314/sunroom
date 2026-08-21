"""Validate the structure-fidelity scorer against KNOWN-good/bad renders.
Ground truth from visual inspection of the v3_2000 seed sweep on job 35:
seeds 1111 and 4444 kept the full-width sliding door; 2222/3333/5555 replaced it
with windows + a kneewall. A useful scorer must rank the two good ones lowest."""
import base64, io, json
from pathlib import Path
import httpx
from PIL import Image
from app.database import supabase
from app.config_gate import drift_score

SID = "9f8f730c-92a1-4f97-8b9e-221f2373f875"
GOOD, BAD = {1111, 4444}, {2222, 3333, 5555}

row = supabase.table("configurations").select("*").eq("id", SID).execute().data[0]
ds = row["draft_state"]; meta = ds.get("_meta") or {}
img = Image.open(io.BytesIO(httpx.get(row["house_photo_url"], timeout=60).content)).convert("RGB")
if max(img.size) > 1280: img.thumbnail((1280, 1280), Image.LANCZOS)
buf = io.BytesIO(); img.save(buf, "JPEG", quality=95)
pb, (W, H) = buf.getvalue(), img.size
wc = json.loads(meta.get("wall_corners") or "{}")
pl = ds.get("selectedProductLine") or {}

r = httpx.post("http://localhost:3001/render", timeout=180, json={
    "photoBase64": base64.b64encode(pb).decode(), "photoW": W, "photoH": H,
    "pts": wc.get("_5pt"), "wallData": json.dumps(ds["walls"]),
    "wallSystem": pl.get("wall_system") or "4_inch", "wallColor": ds.get("wallColor") or "white",
    "roofStyle": ds.get("roofStyle") or "gable", "mountHeight": ds.get("mountHeight") or "",
    "projectionDistance": ds.get("projectionDistance") or "", "wallCombo": ds.get("wallCombo"),
    "includeGableWings": ds.get("includeGameWings", True) if False else ds.get("includeGableWings", True),
    "roofline": wc.get("_roofline"), "repaintMode": "kontext"})
r.raise_for_status()
j = r.json()
comp = base64.b64decode(j["composite"])
smask = base64.b64decode(j["mask"]) if j.get("mask") else None
gmask = base64.b64decode(j["glassMask"]) if j.get("glassMask") else None
print("masks:", "structure" if smask else "MISSING", "|", "glass" if gmask else "MISSING")

rows = []
for sd in sorted(GOOD | BAD):
    f = Path(f"_ab_models_out/v3a_s{sd}.jpg")
    score = drift_score(f.read_bytes(), comp, smask, gmask)
    rows.append((score, sd, "GOOD" if sd in GOOD else "bad "))
rows.sort()
print("\nranked by structure drift (lower = closer to the drawn config):")
for sc, sd, label in rows:
    print(f"   {sc:.4f}  seed {sd}  [{label}]")

top2 = {sd for _, sd, _ in rows[:2]}
print()
if top2 == GOOD:
    print("PASS — the two best-scoring renders are exactly the two correct ones")
else:
    print(f"FAIL — top 2 were {sorted(top2)}, ground truth is {sorted(GOOD)}")
