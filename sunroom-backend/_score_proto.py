"""Prototype a scorer that actually works against a flat CGI reference.
drift_score excludes glass and erodes the boundary, which leaves only featureless
white frame interiors (37 edges — under its own 200 minimum, so it returns 0).
Every real cue lives ON the frame/glass boundary.

Metric: EDGE RECALL. What fraction of the composite's structural edges are
missing from the candidate? Losing a door stile / threshold / kneewall line
scores badly; reflections ADDING edges is ignored, since that is legitimate
photorealism rather than config drift.
"""
import base64, io, json
import httpx, numpy as np
from PIL import Image
from app.database import supabase
from app.config_gate import _gray, _edges, _dilate

SID = "9f8f730c-92a1-4f97-8b9e-221f2373f875"
GOOD, BAD = {1111, 4444}, {2222, 3333, 5555}

row = supabase.table("configurations").select("*").eq("id", SID).execute().data[0]
ds = row["draft_state"]; meta = ds.get("_meta") or {}
img = Image.open(io.BytesIO(httpx.get(row["house_photo_url"], timeout=60).content)).convert("RGB")
if max(img.size) > 1280: img.thumbnail((1280, 1280), Image.LANCZOS)
buf = io.BytesIO(); img.save(buf, "JPEG", quality=95); pb, (W, H) = buf.getvalue(), img.size
wc = json.loads(meta.get("wall_corners") or "{}"); pl = ds.get("selectedProductLine") or {}
j = httpx.post("http://localhost:3001/render", timeout=180, json={
    "photoBase64": base64.b64encode(pb).decode(), "photoW": W, "photoH": H, "pts": wc.get("_5pt"),
    "wallData": json.dumps(ds["walls"]), "wallSystem": pl.get("wall_system") or "4_inch",
    "wallColor": ds.get("wallColor") or "white", "roofStyle": ds.get("roofStyle") or "gable",
    "wallCombo": ds.get("wallCombo"), "includeGableWings": True, "repaintMode": "kontext"}).json()
comp = base64.b64decode(j["composite"]); smask = base64.b64decode(j["mask"])

ref_img = Image.open(io.BytesIO(comp)).convert("L"); size = ref_img.size
r = np.asarray(ref_img).astype(np.float32)
m = _gray(smask, size) > 128
re = _edges(r) & m
print(f"composite structural edges in mask: {int(re.sum())}")

def recall_miss(cand_bytes, tol=2):
    f = _gray(cand_bytes, size)
    fe = _edges(f) & m
    missing = re & ~_dilate(fe, tol)
    return float(missing.sum() / max(1, re.sum()))

rows = sorted(
    (recall_miss(open(f"_ab_models_out/v3a_s{sd}.jpg", "rb").read()), sd,
     "GOOD" if sd in GOOD else "bad ")
    for sd in sorted(GOOD | BAD)
)
print("\nranked by MISSING composite edges (lower = kept the drawn config):")
for sc, sd, lab in rows:
    print(f"   {sc:.4f}  seed {sd}  [{lab}]")
top2 = {sd for _, sd, _ in rows[:2]}
print("\nPASS — scorer picks exactly the two correct renders" if top2 == GOOD
      else f"\nFAIL — top2={sorted(top2)} truth={sorted(GOOD)}")
