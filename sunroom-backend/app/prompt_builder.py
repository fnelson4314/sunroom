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
def quality_prefix(frame_color: str) -> str:
    color = (frame_color or "white").strip().lower()
    return (
        f"SUNRM, photorealistic exterior photo of a {color} aluminum-framed "
        f"sunroom with glass walls attached to the house, "
    )

QUALITY_SUFFIX = "natural daylight, consistent shadows"

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
}

DOOR_STYLE_DESCRIPTIONS = {
    "sliding": "wide sliding glass patio door with two large full-height glass panels that slide horizontally and a vertical pull handle, not a hinged entry door",
    "entry":   "single hinged entry door",
    "storm":   "storm door",
    "french":  "french double doors, two hinged glass doors",
}

WALL_POSITION = {
    "A": "left wall",
    "B": "side wall (runs perpendicular to camera)",
    "C": "front wall (faces camera)",
}


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


def _describe_gable_glass(gable: dict, wall_id: str, wall_height_ft: str) -> str:
    if not gable:
        return ""

    glass_type = gable.get("glassType", "uninsulated")
    count      = gable.get("count", 1)
    wall_h     = float(wall_height_ft) if wall_height_ft else 0

    shape = "trapezoidal" if wall_h > 7 else "triangular"

    mat_label = "solid aluminum" if glass_type == "solid" else (
        "G1 insulated glass" if glass_type == "g1" else "single-pane glass"
    )

    pane_str = f"exactly {count}-pane " if count > 1 else ""
    label    = "gable end" if wall_id == "B" else "wing end"

    return f"{pane_str}{mat_label} {shape} decorative {label} accent panel above wall panels, vertical end wall accent only"


def build_wall_description(wall_data: str) -> str:
    """
    Convert the wall builder JSON into natural language for FLUX.

    Accepts both old field names (widthFt/heightFt, transomHeightIn/kneewallHeightIn)
    and new field names (widthFt already converted on frontend, unitTransomHeights[]/
    unitKneewallHeights[] per-unit arrays, unitDoorStyles[] array).

    The frontend sends widthFt/heightFt as ceiling-ft strings and resolves
    per-unit heights before serialising to wallData.
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

    wall_descs = []

    for wall in walls:
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

        position = WALL_POSITION.get(wall_id, f"Wall {wall_id}")

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
            gable_str = _describe_gable_glass(gable_glass, wall_id, height_ft)

        parts = [f"{position} (Wall {wall_id})"]
        if dims:
            parts.append(f"is {dims}")
        parts.append(f"with {units} panel unit{'s' if units > 1 else ''}: {units_str}")
        if gable_str:
            parts.append(f"and {gable_str}")

        wall_descs.append(" ".join(parts))

    if not wall_descs:
        return ""

    return "Sunroom structure: " + ". ".join(wall_descs) + "."


# ─── Main prompt builder ──────────────────────────────────────────────────────

def build_prompt(
    selected_option_ids: list[str],
    wall_data: str = "",
    roof_style: str = "",
    wall_system: str = "",
    wall_color: str = "white",
) -> tuple[str, str]:
    """
    Build (positive_prompt, negative_prompt) for the AI repaint step.

    Order: quality prefix (with frame colour) → roof → wall structure → option
    fragments → quality suffix.

    NOTE: negative_prompt is returned for completeness but the current models
    (flux-fill-dev / flux-canny-dev) do not accept a negative prompt input, so
    it is effectively unused downstream.
    """
    prefix = quality_prefix(wall_color)
    try:
        wall_description = build_wall_description(wall_data)

        # Roof style enforcement. The roof colour comes entirely from the prompt
        # (Canny only conveys the roof's shape), so be explicit: dark asphalt
        # shingles that match the existing house roof, never a light/white roof.
        roof_fragments = {
            "gable": "peaked gable roof covered in dark gray-black matte asphalt shingles that exactly match the existing house roof in color and texture, opaque solid shingled roof, matte and non-reflective, NOT a white roof, NOT a light roof, NOT a reflective or glossy roof, NOT a roof reflecting the sky, NOT a metal roof, NOT a glass roof",
            "studio":         "single-slope roof covered in dark asphalt shingles matching the existing house roof in color and texture, opaque solid shingled roof, NOT a white, light, metal, or glass roof",
            "under_existing": "roof tucked under the existing house roof, opaque dark shingled ceiling matching the house",
            "roof_only":      "freestanding patio roof covered in dark asphalt shingles matching the existing house roof, opaque, NOT a white or metal roof",
        }
        roof_fragment = roof_fragments.get(roof_style, "dark asphalt shingled roof matching the existing house roof, opaque, not white")

        # Transom enforcement — if wall_data mentions transom, force it
        has_transom  = "transom"  in wall_data.lower() if wall_data else False
        has_kneewall = "kneewall" in wall_data.lower() if wall_data else False
        transom_fragment  = "narrow glass transom band at top of each panel, " if has_transom else ""
        kneewall_fragment = "solid aluminum kneewall panels at base, knee-height solid wall below glass, " if has_kneewall else ""

        # Keywords that conflict with opaque roof enforcement — exclude these fragments
        ROOF_CONFLICT_KEYWORDS = [
            "glass roof", "glass panel", "glass gable", "glass ceiling",
            "insulated glass", "double pane", "energy efficient",
            "G1", "single pane", "uninsulated",
            "6-inch", "4-inch", "2-inch", "inch insulated",
            "all-season vinyl", "convertible screen",
            "SUNRM",  # already in prefix, skip duplicates from DB
        ]

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
                fragments.append(frag)

        middle_parts = []
        if roof_fragment:
            middle_parts.append(roof_fragment)
        if transom_fragment:
            middle_parts.append(transom_fragment)
        if kneewall_fragment:
            middle_parts.append(kneewall_fragment)
        if wall_description:
            middle_parts.append(wall_description)
        if fragments:
            middle_parts.append(", ".join(fragments))

        if middle_parts:
            positive = prefix + " ".join(middle_parts) + ", " + QUALITY_SUFFIX
        else:
            positive = prefix + QUALITY_SUFFIX

        logger.info(f"Built prompt positive: {positive}")
        return positive, NEGATIVE_PROMPT

    except Exception as e:
        logger.error(f"Prompt builder error: {str(e)}")
        return prefix + QUALITY_SUFFIX, NEGATIVE_PROMPT