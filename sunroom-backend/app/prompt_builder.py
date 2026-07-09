from app.database import supabase
import logging
import json

logger = logging.getLogger(__name__)

# ─── Prompt constants ─────────────────────────────────────────────────────────

# Built per-render with the ACTUAL frame colour so it never conflicts with the
# config (was hardcoded "white ... brick house"). Matches the LoRA's training
# caption style: "SUNRM, a <colour> aluminum-framed sunroom ...". The roof,
# house type, and "attached" wording are intentionally NOT here — the roof is
# described once by roof_fragment, and the real house is already in the photo.
def quality_prefix(frame_color: str, is_screen_room: bool = False) -> str:
    color = (frame_color or "white").strip().lower()
    if is_screen_room:
        # A screen room has NO glass. The glass wording below is the single most
        # damaging thing you can hand FLUX over a screened-porch composite — it
        # paints window panes and sky reflections onto the insect screen.
        return (
            f"SUNRM, photorealistic exterior photo of a {color} aluminum-framed "
            f"screened porch with large charcoal insect screen mesh panels, "
            f"matte dark screen mesh that you can see through into a shaded "
            f"interior, no glass anywhere, attached to the house, "
        )
    return (
        f"SUNRM, photorealistic exterior photo of a {color} aluminum-framed "
        f"sunroom with large glass walls of clear tinted reflective glass "
        f"that mirror the bright blue sky, light and airy glass with bright sky "
        f"reflections, attached to the house, "
    )

# Affirmative realism cues only (the model ignores the negative prompt, so the
# anti-cartoon guards have to live here as positive descriptors). Deliberately no
# negation words like "not a render" — FLUX latches onto the noun, not the "not".
QUALITY_SUFFIX = (
    "natural daylight, consistent soft shadows, realistic muted colors, "
    "true-to-life architectural photograph, high detail, sharp focus"
)

NEGATIVE_PROMPT = (
    "glass roof, transparent roof, polycarbonate roof, glass ceiling, greenhouse roof, "
    "cartoon, illustration, painting, sketch, render, CGI, 3D, "
    "warped, distorted, floating, unrealistic proportions, "
    "blurry, oversaturated, artifacts, watermark, text, "
    "mismatched lighting, disconnected from house, hovering, "
    "conservatory, Victorian, greenhouse, "
    "glass roof, transparent roof, glass ceiling, crystal roof, "
    "polycarbonate roof, clear roof panels, see-through roof, "
    "garden room, orangery, lean-to, "
    "furniture, chairs, patio furniture, people, plants, tables, "
    "too many windows, extra panels, wrong number of panels, "
    "octagonal roof, bay window, victorian conservatory, round roof, "
    "pyramid roof, glass ceiling, polycarbonate panels"
)

# Appended for 2_inch screen rooms. Everything that would turn insect screen back
# into glazing.
SCREEN_NEGATIVE_EXTRA = (
    ", glass walls, glass panels, window panes, windows, glazing, "
    "reflections, sky reflection, mirrored glass, shiny panels, "
    "sliding glass door, solid walls"
)

# ─── Panel type → readable description ───────────────────────────────────────

# New IDs: "door" / "door_t". Old IDs kept for backward compat with saved drafts.
PANEL_TYPE_DESCRIPTIONS = {
    "fixed_glass":    "fixed glass panel",
    "fixed_transom":  "fixed glass panel with transom",
    "fixed_kneewall": "fixed glass panel with kneewall",
    "fixed_tk":       "fixed glass panel with transom and kneewall",
    "oper_kneewall":  "operable sliding window with kneewall",
    "oper_tk":        "operable sliding window with transom and kneewall",
    # New door IDs — style is resolved in _describe_panel from unitDoorStyles
    "door":           "door",
    "door_t":         "door with transom above",
    # Legacy IDs — kept for backward compat
    "sliding_door":   "sliding glass door",
    "sliding_door_t": "sliding glass door with transom above",
    "solid_panel":    "solid aluminum panel",
    # Screen rooms (2_inch). NOT glass — describing these as glass panels is what
    # made FLUX paint window panes over a screened porch.
    "screen":         "charcoal insect screen mesh panel, no glass",
    "screen_t":       "charcoal insect screen mesh panel with a screen transom above, no glass",
    "screen_door":    "hinged screen door with a mid rail and a lever handle, screen mesh, no glass",
    "screen_door_t":  "hinged screen door with a screen transom above, screen mesh, no glass",
}

DOOR_STYLE_DESCRIPTIONS = {
    "sliding": "wide sliding glass patio door with two large full-height glass panels that slide horizontally and a vertical pull handle, not a hinged entry door",
    "entry":   "single hinged entry door",
    "storm":   "storm door",
    "french":  "french double doors, two hinged glass doors",
}

# Position labels depend on WHICH pair of walls is rendered (the camera combo):
# the side wall recedes on the left, the front wall faces the camera. Hardcoded
# labels (old behavior) told FLUX that B was a side wall and C faced the camera
# even in an AB view where B IS the front wall and C isn't in frame at all —
# the repaint then scrambled panel layouts trying to obey a wrong description.
WALL_POSITION_BY_COMBO = {
    "AB": {
        "A": "left side wall (recedes away from the camera)",
        "B": "front wall (faces the camera)",
    },
    "BC": {
        "B": "left side wall (recedes away from the camera)",
        "C": "front wall (faces the camera)",
    },
}


def _resolve_combo(walls: list, wall_combo: str) -> str:
    """Explicit combo wins; otherwise infer from the wall set (mirrors the
    renderer's fallback): A present without C → AB, else BC."""
    if wall_combo in ("AB", "BC"):
        return wall_combo
    ids = {w.get("id") for w in walls}
    return "AB" if ("A" in ids and "C" not in ids) else "BC"


def _describe_panel(
    panel_type_id: str,
    materials: dict,
    split_transom: bool,
    split_kneewall: bool,
    transom_height_in: str,
    kneewall_height_in: str,
    door_style: str = "sliding",
) -> str:
    """
    Build a natural-language description of a single panel unit.

    transom_height_in / kneewall_height_in are already resolved
    (unit override || global default) before being passed here.
    """
    # Handle door types — style overrides the generic base description
    if panel_type_id in ("door", "door_t"):
        door_desc = DOOR_STYLE_DESCRIPTIONS.get(door_style, "door")
        if panel_type_id == "door_t":
            if transom_height_in:
                return f"{door_desc} with {transom_height_in}-inch transom above"
            return f"{door_desc} with transom above"
        return door_desc

    base = PANEL_TYPE_DESCRIPTIONS.get(panel_type_id, panel_type_id.replace("_", " "))

    has_transom  = "transom"  in panel_type_id or panel_type_id in (
        "sliding_door_t", "oper_tk", "fixed_tk", "fixed_transom"
    )
    has_kneewall = "kneewall" in panel_type_id or panel_type_id in (
        "oper_tk", "fixed_tk", "fixed_kneewall", "oper_kneewall"
    )

    details = []

    if has_transom:
        mat = materials.get("transom", "glass")
        h   = f" {transom_height_in}-inch" if transom_height_in else ""
        split_note = ", center-divided" if split_transom else ""
        details.append(f"{mat}{h} transom{split_note}")

    if has_kneewall:
        mat = materials.get("kneewall", "glass")
        h   = f" {kneewall_height_in}-inch" if kneewall_height_in else ""
        split_note = ", center-divided" if split_kneewall else ""
        details.append(f"{mat}{h} kneewall{split_note}")

    if details:
        return f"{base} with {' and '.join(details)}"
    return base


def _describe_gable_glass(
    gable: dict, wall_id: str, wall_height_ft: str, is_screen: bool = False
) -> str:
    if not gable:
        return ""

    glass_type = gable.get("glassType", "uninsulated")
    count      = gable.get("count", 1)
    wall_h     = float(wall_height_ft) if wall_height_ft else 0

    shape = "trapezoidal" if wall_h > 7 else "triangular"

    if is_screen:
        # The ScreenRoomBuilder calls this control "Gable Screen" / "Wing Screen".
        # Its non-solid value is screen mesh, not glazing.
        mat_label = "solid aluminum" if glass_type == "solid" else "charcoal insect screen mesh"
    else:
        mat_label = "solid aluminum" if glass_type == "solid" else (
            "G1 insulated glass" if glass_type == "g1" else "single-pane glass"
        )

    pane_str = f"exactly {count}-pane " if count > 1 else ""
    label    = "gable end" if wall_id == "B" else "wing end"

    return f"{pane_str}{mat_label} {shape} decorative {label} accent panel above wall panels, vertical end wall accent only"


def build_wall_description(wall_data: str, wall_combo: str = None) -> str:
    """
    Convert the wall builder JSON into natural language for FLUX.

    Accepts both old field names (widthFt/heightFt, transomHeightIn/kneewallHeightIn)
    and new field names (widthFt already converted on frontend, unitTransomHeights[]/
    unitKneewallHeights[] per-unit arrays, unitDoorStyles[] array).

    The frontend sends widthFt/heightFt as ceiling-ft strings and resolves
    per-unit heights before serialising to wallData.

    Only the TWO RENDERED walls (per wall_combo) are described — a hidden third
    wall is priced but not in the image, and describing it makes FLUX paint
    phantom walls/panels.
    """
    if not wall_data:
        return ""

    try:
        walls = json.loads(wall_data)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Could not parse wall_data JSON — skipping wall description")
        return ""

    if not walls:
        return ""

    combo = _resolve_combo(walls, wall_combo)
    position_labels = WALL_POSITION_BY_COMBO[combo]

    wall_descs = []

    for wall in walls:
        # Skip walls the camera can't see — they must not be painted.
        if wall.get("id") not in position_labels:
            continue
        wall_id        = wall.get("id", "?")
        # Frontend sends widthFt/heightFt (already ceiling-converted from inches)
        width_ft       = wall.get("widthFt", "")
        height_ft      = wall.get("heightFt", "")
        units          = wall.get("units", 1)
        panel_types    = wall.get("panelTypes", ["fixed_glass"])
        unit_materials = wall.get("unitMaterials", [])
        split_transom  = wall.get("splitTransom", False)
        split_kneewall = wall.get("splitKneewall", False)
        gable_glass    = wall.get("gableGlass")

        # Per-unit heights (new format — already resolved with defaults on frontend)
        unit_transom_heights  = wall.get("unitTransomHeights", [])
        unit_kneewall_heights = wall.get("unitKneewallHeights", [])
        unit_door_styles      = wall.get("unitDoorStyles", [])

        # Legacy fallback: single wall-level heights
        legacy_transom_h  = wall.get("transomHeightIn", "")
        legacy_kneewall_h = wall.get("kneewallHeightIn", "")

        position = position_labels.get(wall_id, f"Wall {wall_id}")

        dim_parts = []
        if width_ft:  dim_parts.append(f"{width_ft}ft wide")
        if height_ft: dim_parts.append(f"{height_ft}ft tall")
        dims = " by ".join(dim_parts)

        # Describe each unit
        unit_descs = []
        for i, pt_id in enumerate(panel_types):
            mats        = unit_materials[i] if i < len(unit_materials) else {}
            transom_h   = (unit_transom_heights[i] if i < len(unit_transom_heights) else "") or legacy_transom_h
            kneewall_h  = (unit_kneewall_heights[i] if i < len(unit_kneewall_heights) else "") or legacy_kneewall_h
            door_style  = unit_door_styles[i] if i < len(unit_door_styles) else "sliding"

            unit_descs.append(_describe_panel(
                pt_id, mats, split_transom, split_kneewall,
                transom_h, kneewall_h, door_style
            ))

        # Deduplicate consecutive identical units
        condensed = []
        i = 0
        while i < len(unit_descs):
            count = 1
            while i + count < len(unit_descs) and unit_descs[i + count] == unit_descs[i]:
                count += 1
            prefix = f"{count}× " if count > 1 else ""
            condensed.append(f"{prefix}{unit_descs[i]}")
            i += count

        units_str = ", ".join(condensed)

        gable_str = ""
        if gable_glass:
            wall_is_screen = any(str(pt).startswith("screen") for pt in panel_types)
            gable_str = _describe_gable_glass(
                gable_glass, wall_id, height_ft, wall_is_screen
            )

        parts = [f"{position} (Wall {wall_id})"]
        if dims:
            parts.append(f"is {dims}")
        parts.append(f"with {units} panel unit{'s' if units > 1 else ''}: {units_str}")
        if gable_str:
            parts.append(f"and {gable_str}")

        wall_descs.append(" ".join(parts))

    if not wall_descs:
        return ""

    # Screen rooms must not be introduced as a "Sunroom" — the noun alone is enough
    # to pull FLUX back toward glass. Detect from the panel types rather than
    # threading wall_system down here.
    is_screen = any(
        str(pt).startswith("screen")
        for w in walls
        for pt in w.get("panelTypes", [])
    )
    lead = "Screened porch structure: " if is_screen else "Sunroom structure: "
    return lead + ". ".join(wall_descs) + "."


# ─── Main prompt builder ──────────────────────────────────────────────────────

def build_prompt(
    selected_option_ids: list[str],
    wall_data: str = "",
    roof_style: str = "",
    wall_system: str = "",
    wall_color: str = "white",
    under_existing_shape: str = None,
    include_gable_wings: bool = True,
    wall_combo: str = None,
    screen_options: dict = None,
) -> tuple[str, str]:
    """
    Build (positive_prompt, negative_prompt) for the AI repaint step.

    Order: quality prefix (with frame colour) → roof → wall structure → option
    fragments → quality suffix.

    NOTE: negative_prompt is returned for completeness but the current models
    (flux-fill-dev / flux-canny-dev) do not accept a negative prompt input, so
    it is effectively unused downstream.
    """
    # 2_inch is the screen-room product line: insect screen, not glass. Every
    # glass-flavored fragment below has to be swapped, not just the wall list.
    is_screen_room = wall_system == "2_inch"
    prefix = quality_prefix(wall_color, is_screen_room)
    negative = NEGATIVE_PROMPT + (SCREEN_NEGATIVE_EXTRA if is_screen_room else "")
    try:
        wall_description = build_wall_description(wall_data, wall_combo)

        # Roof style enforcement. The roof colour comes entirely from the prompt
        # (Canny only conveys the roof's shape), so be explicit: dark asphalt
        # shingles that match the existing house roof, never a light/white roof.
        roof_fragments = {
            "gable": "peaked gable roof covered in dark gray-black matte asphalt shingles that exactly match the existing house roof in color and texture, opaque solid shingled roof, matte and non-reflective, NOT a white roof, NOT a light roof, NOT a reflective or glossy roof, NOT a roof reflecting the sky, NOT a metal roof, NOT a glass roof",
            "studio":         "single-slope roof covered in dark asphalt shingles matching the existing house roof in color and texture, opaque solid shingled roof, NOT a white, light, metal, or glass roof",
            "under_existing": "glass sunroom walls installed underneath the existing house roof, the existing roof stays unchanged above, no new roof added, the wall tops meet a white aluminum header beam just below the existing eaves",
            "roof_only":      "freestanding patio roof covered in dark asphalt shingles matching the existing house roof, opaque, NOT a white or metal roof",
        }
        roof_fragment = roof_fragments.get(roof_style, "dark asphalt shingled roof matching the existing house roof, opaque, not white")

        # Under-existing: fold in the EXISTING roof's shape so the prompt is
        # consistent with the preserved roof in the photo (gable peak vs studio slope).
        if roof_style == "under_existing" and under_existing_shape in ("gable", "studio"):
            shape_word = "gable" if under_existing_shape == "gable" else "single-slope studio"
            beam_color = (wall_color or "white").strip().lower()
            # Screen rooms have no glass — say "screen" here too, or the walls the
            # composite draws as insect screen get repainted as glazing.
            wall_noun = (
                "screened porch walls of charcoal insect screen mesh"
                if is_screen_room else "glass sunroom walls"
            )
            infill_noun = "screen" if is_screen_room else "glass"
            if include_gable_wings:
                # Adding a NEW gable/wing infill (glass or solid) up to the roof.
                roof_fragment = (
                    f"{wall_noun} installed underneath the existing {shape_word} "
                    "house roof, the existing roof stays unchanged above, no new roof added, "
                    f"the wall tops meet a {beam_color} aluminum header beam just below the "
                    f"existing eaves, with a new {infill_noun} gable/wing infill filling the area "
                    "between the header beam and the existing roof"
                )
            else:
                # Walls only — the existing gable/end wall above is KEPT. No new
                # gable/wing infill; the walls simply run up to the existing header.
                roof_fragment = (
                    f"{wall_noun} installed underneath the existing {shape_word} "
                    "house roof, the existing roof AND its existing gable end wall stay "
                    "completely unchanged above, no new roof and no new gable infill added, "
                    f"the walls run straight up to meet a {beam_color} aluminum header "
                    "beam just below the existing eaves"
                )
        elif roof_style == "under_existing" and is_screen_room:
            roof_fragment = (
                "screened porch walls of charcoal insect screen mesh installed underneath "
                "the existing house roof, the existing roof stays unchanged above, no new "
                "roof added, the wall tops meet an aluminum header beam just below the eaves"
            )

        # Transom APPEARANCE constraint — NOT enforcement.
        # The per-unit wall_description already states exactly which units carry a
        # transom. The old code injected "transom band at top of EACH panel"
        # whenever ANY unit had one, which made the model add transoms everywhere
        # (symptom: transom where it shouldn't be). Here we only constrain how the
        # already-placed transoms LOOK — a single continuous band — which also
        # fights the model/LoRA tendency to split them. Kneewalls: no global
        # fragment at all; the per-unit description covers them precisely.
        has_transom = "transom" in wall_data.lower() if wall_data else False
        band_material = "screen mesh" if is_screen_room else "glass"
        transom_fragment = (
            f"any transom is a single continuous horizontal {band_material} band spanning the "
            "full width of its panel, not divided, not split into sections, "
            if has_transom else ""
        )
        kneewall_fragment = ""

        # Screen rooms: kneewall / chairrail / handrail span whole walls, so they
        # come from screen_options rather than the per-unit wall description.
        screen_fragment = ""
        if is_screen_room and screen_options:
            feats = []
            kn = screen_options.get("kneewall") or {}
            if kn.get("enabled"):
                style = (kn.get("solidStyle") or "panel").lower()
                style_word = {
                    "vinyl": "white vinyl",
                    "hardieboard": "painted fiber-cement",
                }.get(style, "solid aluminum")
                h = kn.get("heightIn") or ""
                h_txt = f"{h}-inch " if h else ""
                feats.append(
                    f"a {h_txt}{style_word} kneewall skirt running along the bottom "
                    "of every screen wall, below the screen mesh"
                )
            cr = screen_options.get("chairrail") or {}
            if cr.get("enabled"):
                h = cr.get("heightIn") or ""
                h_txt = f"{h}-inch " if h else ""
                feats.append(
                    f"a horizontal aluminum chairrail crossing every screen wall at "
                    f"{h_txt}height"
                )
            if (screen_options.get("handrail") or {}).get("enabled"):
                feats.append(
                    "an aluminum handrail with evenly spaced vertical pickets running "
                    "along the bottom of every screen wall"
                )
            if feats:
                screen_fragment = ", ".join(feats) + ", "

        # Keywords that conflict with opaque roof enforcement — exclude these fragments
        ROOF_CONFLICT_KEYWORDS = [
            "glass roof", "glass panel", "glass gable", "glass ceiling",
            "insulated glass", "double pane", "energy efficient",
            "G1", "single pane", "uninsulated",
            "6-inch", "4-inch", "2-inch", "inch insulated",
            "all-season vinyl", "convertible screen",
            "SUNRM",  # already in prefix, skip duplicates from DB
        ]

        # The per-unit wall_description is the SINGLE source of truth for transoms
        # and kneewalls (which panels have them + their material). Some DB option
        # fragments (e.g. a "Transom Glass" upgrade whose fragment reads "transom
        # glass windows above main panels, upper glass transom band") describe them
        # GLOBALLY, which forces a transom onto EVERY panel — the real cause of
        # "transom where it shouldn't be". Drop any fragment that mentions them.
        STRUCTURE_REDUNDANT_KEYWORDS = ["transom", "kneewall", "knee wall", "knee-wall"]

        fragments = []
        if selected_option_ids:
            result = supabase.table("options")\
                .select("prompt_fragment, affects_visual, category, sort_order")\
                .in_("id", selected_option_ids)\
                .eq("affects_visual", True)\
                .order("category")\
                .order("sort_order")\
                .execute()

            for row in result.data:
                frag = row.get("prompt_fragment", "")
                if not frag:
                    continue
                # Skip fragments that conflict with opaque roof
                if any(kw.lower() in frag.lower() for kw in ROOF_CONFLICT_KEYWORDS):
                    logger.info(f"Skipping conflicting fragment: {frag[:60]}")
                    continue
                # Skip transom/kneewall fragments — handled per-unit, never global
                if any(kw in frag.lower() for kw in STRUCTURE_REDUNDANT_KEYWORDS):
                    logger.info(f"Skipping per-unit structure fragment: {frag[:60]}")
                    continue
                fragments.append(frag)

        middle_parts = []
        if roof_fragment:
            middle_parts.append(roof_fragment)
        if transom_fragment:
            middle_parts.append(transom_fragment)
        if kneewall_fragment:
            middle_parts.append(kneewall_fragment)
        if screen_fragment:
            middle_parts.append(screen_fragment)
        if wall_description:
            middle_parts.append(wall_description)
        if fragments:
            middle_parts.append(", ".join(fragments))

        if middle_parts:
            positive = prefix + " ".join(middle_parts) + ", " + QUALITY_SUFFIX
        else:
            positive = prefix + QUALITY_SUFFIX

        logger.info(f"Built prompt positive: {positive}")
        return positive, negative

    except Exception as e:
        logger.error(f"Prompt builder error: {str(e)}")
        return prefix + QUALITY_SUFFIX, negative