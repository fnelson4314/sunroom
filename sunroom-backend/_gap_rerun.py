"""Re-run the identity-gap four through kontext-dev with the CURRENT production
instruction — including the config-derived material/door detail, which the
ab_models.py CLI can't carry (wall_data is a large JSON blob). Same model, same
composites, so any difference is the prompt + tan fixes."""
import json, sys, uuid
from pathlib import Path
import httpx
from app.database import supabase
from app.prompt_builder import build_kontext_instruction
from app.replicate_service import run_model_prediction

REVIEW = Path(r"C:\Users\fnels\LORA_review")
OUT = Path("_ab_models_out"); OUT.mkdir(exist_ok=True)
PICKS = {3: "as_gable", 7: "ts_gable"}  # both sliding-door jobs
manifest = json.loads((REVIEW / "manifest.json").read_text())

gap = {}
for idx, tag in PICKS.items():
    m = manifest[idx]
    comp = sorted((REVIEW / "images").glob(f"{idx:02d}_*_composite.jpg"))[0]
    photo = sorted((REVIEW / "images").glob(f"{idx:02d}_*_photo.jpg"))[0]

    path = f"lora-test/gap9-{tag}-{uuid.uuid4().hex[:8]}.jpg"
    supabase.storage.from_("renders").upload(
        path, comp.read_bytes(), {"content-type": "image/jpeg"})
    url = supabase.storage.from_("renders").get_public_url(path)

    instr = build_kontext_instruction(
        wall_system=m.get("wall_system") or "4_inch",
        wall_color=m.get("wall_color") or "white",
        roof_style=m.get("roof_style") or "gable",
        wall_data=m.get("wall_data") or "",
    )
    print(f"\n=== {tag} ({m.get('wall_system')} / {m.get('roof_style')} / "
          f"{m.get('wall_color') or 'white'}) ===")
    print(instr[instr.index('.', instr.index('unchanged')) + 1:].strip()[:400] or "(no extra)")

    out_url = run_model_prediction("black-forest-labs/flux-kontext-dev", {
        "prompt": instr, "input_image": url,
        "aspect_ratio": "match_input_image", "output_format": "jpg", "seed": 1111,
    })
    dest = OUT / f"gap9_{tag}.jpg"
    dest.write_bytes(httpx.get(out_url, timeout=120).content)
    gap[tag] = {"composite": comp.name, "photo": photo.name, "name": m["session_name"],
                "wall_system": m.get("wall_system") or "4_inch",
                "roof_style": m.get("roof_style") or "gable",
                "wall_color": m.get("wall_color") or "white"}
    print(f"  -> {dest.name}")

(REVIEW / "gap9.json").write_text(json.dumps(gap, indent=1))
print("\ndone")
