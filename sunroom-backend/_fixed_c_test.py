"""Decisive test: is job 35's door failing because of the PIPELINE, or because its
wall C is one 192in door (the typo the user flagged)? Render the SAME job with
wall C split the way it was meant to be — a 96in sliding door beside a 96in
window, i.e. the shape job 27 already renders correctly — and compare."""
import json, uuid
from pathlib import Path
import httpx
from app.database import supabase
from app.prompt_builder import build_kontext_instruction
from app.replicate_service import run_model_prediction

REVIEW = Path(r"C:\Users\fnels\LORA_review")
m = json.loads((REVIEW / "manifest.json").read_text())[3]
walls = json.loads(m["wall_data"])
c = next(w for w in walls if w["id"] == "C")

# Wall C: 192in as ONE door -> 96in window + 96in door (what the user intended).
mats = c.get("unitMaterials") or [{}]
c["panelTypes"] = ["oper_kneewall", "door_t"]
c["unitWidths"] = ["96", "96"]
c["units"] = 2
c["unitMaterials"] = [
    {"transom": "glass", "kneewall": "solid", "kneewallSolidStyle": "hardieboard"},
    dict(mats[0]),
]
c["unitDoorStyles"] = ["sliding", "sliding"]
c["unitTransomHeights"] = (c.get("unitTransomHeights") or ["", ""])[:1] * 2
c["unitKneewallHeights"] = ["", ""]
fixed = json.dumps(walls)
Path("_fixed_c_walldata.json").write_text(fixed)
print("wall C ->", c["panelTypes"], c["unitWidths"])
