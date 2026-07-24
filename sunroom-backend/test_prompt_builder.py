"""Self-check for prompt_builder config-consistency logic.

Run: venv/Scripts/python.exe test_prompt_builder.py   (needs .env for the
supabase import; no network is hit — selected_option_ids is always empty).

Covers the fixes from the 2026-07-12 session:
  1. transom fragment only when a rendered wall has a transom PANEL TYPE
     (old code substring-matched the JSON, which always contains
     "unitTransomHeights" -> fragment on every render).
  2. combo-aware gable orientation wording (TODO item 3).
  3. door description repeated at the end of the wall clause (TODO item 1).
"""
import json

from app.prompt_builder import build_prompt


def walls_json(*walls) -> str:
    return json.dumps(list(walls))


def wall(wid, panel_types, door_styles=None, **kw):
    w = {
        "id": wid,
        "widthFt": "10",
        "heightFt": "8",
        "units": len(panel_types),
        "panelTypes": panel_types,
        "unitMaterials": [{} for _ in panel_types],
        # These keys are ALWAYS present in real payloads — the old transom bug.
        "unitTransomHeights": ["" for _ in panel_types],
        "unitKneewallHeights": ["" for _ in panel_types],
        "unitDoorStyles": door_styles or ["sliding" for _ in panel_types],
    }
    w.update(kw)
    return w


def prompt(wd, **kw):
    pos, _neg = build_prompt([], wall_data=wd, **kw)
    return pos


def main():
    # 1a. No transom panels anywhere -> NO transom fragment, despite the
    #     unitTransomHeights key being present in the JSON. BUT the always-on
    #     panel-integrity constraint must still be there — removing it with the
    #     transom fix was the 2026-07-12 "walls all over the place" regression.
    p = prompt(
        walls_json(wall("A", ["fixed_glass"]), wall("B", ["fixed_glass"])),
        roof_style="studio", wall_system="4_inch", wall_combo="AB",
    )
    assert "transom" not in p.lower(), f"spurious transom fragment: {p}"
    assert "not divided, not split into sections" in p, f"anti-split constraint lost: {p}"

    # 1b. A transom panel type -> fragment present.
    p = prompt(
        walls_json(wall("A", ["fixed_tk"]), wall("B", ["fixed_glass"])),
        roof_style="studio", wall_system="4_inch", wall_combo="AB",
    )
    assert "single continuous horizontal glass band" in p, p

    # 1c. Transom only on a HIDDEN wall (C, not rendered in AB) -> no fragment.
    p = prompt(
        walls_json(
            wall("A", ["fixed_glass"]),
            wall("B", ["fixed_glass"]),
            wall("C", ["fixed_transom"]),
        ),
        roof_style="studio", wall_system="4_inch", wall_combo="AB",
    )
    assert "single continuous horizontal" not in p, f"hidden-wall transom leaked: {p}"

    # 2. Gable orientation follows the combo.
    ab = prompt(
        walls_json(wall("A", ["fixed_glass"]), wall("B", ["fixed_glass"])),
        roof_style="gable", wall_system="4_inch", wall_combo="AB",
    )
    assert "gable end faces the camera" in ab, ab
    bc = prompt(
        walls_json(wall("B", ["fixed_glass"]), wall("C", ["fixed_glass"])),
        roof_style="gable", wall_system="4_inch", wall_combo="BC",
    )
    assert "parallel to the front wall" in bc, bc

    # 3. Door emphasis: affirmative-only repetition with an exact count. The
    #    negation-laden per-unit description must appear exactly ONCE — repeating
    #    "not a hinged entry door" doubled the "hinged entry door" noun and FLUX
    #    painted hinged doors (2026-07-12 regression).
    p = prompt(
        walls_json(wall("B", ["fixed_glass", "door"], door_styles=["sliding", "sliding"])),
        roof_style="studio", wall_system="4_inch", wall_combo="BC",
    )
    assert "The structure has exactly one door" in p, p
    assert "tall dark vertical pull handle" in p, p
    assert p.count("hinged entry door") == 1, f"negation noun duplicated: {p}"

    # 4. Screen room unaffected: screen lead + screen transom detected via type.
    p = prompt(
        walls_json(wall("B", ["screen", "screen_door"]), wall("C", ["screen_t"])),
        roof_style="studio", wall_system="2_inch", wall_combo="BC",
    )
    assert p.startswith("SUNRM") and "screened porch" in p.lower(), p
    assert "single continuous horizontal screen mesh band" in p, p
    assert "single uninterrupted screen mesh panel" in p, p  # integrity, screen wording

    # 5. Judge focus: the judge must see the STRUCTURE part of the prompt, not
    #    the roof boilerplate the old desc[:1200] truncation handed it.
    from app.judge import _focus_desc
    p = prompt(
        walls_json(wall("B", ["fixed_tk", "door"], door_styles=["sliding", "sliding"])),
        roof_style="gable", wall_system="4_inch", wall_combo="BC",
    )
    focused = _focus_desc(p)
    assert focused.startswith("Sunroom structure:"), focused[:80]
    assert "transom" in focused and "door" in focused, focused

    print("test_prompt_builder: all checks pass")


if __name__ == "__main__":
    main()
