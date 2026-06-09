"""
sunroom_renderer.py
Parametric sunroom renderer with perspective-correct 5-point placement.

Composite rendering strategy (Option 3):
  - Sample house roof shingle colour from top 15% of house photo
  - Render a peaked gable above Wall B with a noisy shingle texture in that colour
  - Wall C is flat-topped (no gable)
  - Frame lines are given a subtle inner shadow for depth
  - Kneewall / solid panels rendered with slight gradient for realism
  - Goal: FLUX barely invents anything — it only blends edges
"""

from __future__ import annotations

import io
import json
import random
from dataclasses import dataclass, field
from typing import Optional, Tuple
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np
import logging

logger = logging.getLogger(__name__)

# ─── Colours ──────────────────────────────────────────────────────────────────

GLASS_BLUE     = (160, 210, 240, 255)
GLASS_OP_BLUE  = (140, 195, 228, 255)
DOOR_BLUE      = (100, 168, 210, 255)
SOLID_CREAM    = (220, 208, 190, 255)
KNEEWALL_SOLID = (200, 188, 170, 255)
TRANSOM_TINT   = (175, 218, 242, 255)
GABLE_GLASS    = (160, 210, 240, 255)
GABLE_SOLID    = (200, 188, 170, 255)
FRAME_WHITE    = (225, 225, 225, 255)
FRAME_TAN      = (184, 154, 106, 255)
FRAME_BRONZE   = (62,  40,  16,  255)
HANDLE_GREY    = (150, 150, 150, 255)

FRAME_COLOURS = {
    "white":  FRAME_WHITE,
    "tan":    FRAME_TAN,
    "bronze": FRAME_BRONZE,
}

PANEL_MAIN_COLOUR = {
    "fixed_glass":    GLASS_BLUE,
    "fixed_transom":  GLASS_BLUE,
    "fixed_kneewall": GLASS_BLUE,
    "fixed_tk":       GLASS_BLUE,
    "oper_kneewall":  GLASS_OP_BLUE,
    "oper_tk":        GLASS_OP_BLUE,
    "door":           DOOR_BLUE,
    "door_t":         DOOR_BLUE,
    "solid_panel":    SOLID_CREAM,
}

DOOR_SPLIT = {"sliding", "french"}

# ─── Spec dataclasses ─────────────────────────────────────────────────────────

@dataclass
class UnitSpec:
    panel_type:    str
    width_in:      float
    door_style:    str   = "sliding"
    transom_mat:   str   = "glass"
    kneewall_mat:  str   = "glass"
    transom_h_in:  float = 0.0
    kneewall_h_in: float = 0.0

@dataclass
class WallSpec:
    wall_id:        str
    width_in:       float
    height_in:      float
    frame_width_in: float = 4.0
    units:          list[UnitSpec] = field(default_factory=list)
    split_transom:  bool  = False
    split_kneewall: bool  = False
    gable_glass:    Optional[dict] = None

@dataclass
class RoofSpec:
    style:           str
    width_in:        float = 0.0
    depth_in:        float = 0.0
    wall_height_in:  float = 0.0
    mount_height_in: float = 0.0
    sub_style:       Optional[str] = None

@dataclass
class SunroomSpec:
    walls:        list[WallSpec]
    roof:         RoofSpec
    frame_colour: str = "white"
    wall_system:  str = "4_inch"

# ─── Config parser ────────────────────────────────────────────────────────────

def parse_config(config: dict) -> SunroomSpec:
    wall_system  = config.get("wallSystem", "4_inch")
    frame_colour = config.get("wallColor") or "white"
    roof_style   = config.get("roofStyle", "studio")
    mount_h_in   = float(config.get("mountHeight") or 0) * 12
    frame_w_in   = {"2_inch": 2.0, "4_inch": 4.0, "6_inch": 6.0}.get(wall_system, 4.0)

    raw_walls = json.loads(config.get("wallData", "[]"))
    walls: list[WallSpec] = []

    for rw in raw_walls:
        def to_inches(val_str) -> float:
            v = float(val_str) if val_str else 0.0
            return v * 12 if 0 < v <= 30 else v

        width_in  = to_inches(rw.get("widthFt") or rw.get("widthIn") or "0")
        height_in = to_inches(rw.get("heightFt") or rw.get("heightIn") or "0")

        panel_types      = rw.get("panelTypes", ["fixed_glass"])
        unit_materials   = rw.get("unitMaterials", [])
        unit_widths_raw  = rw.get("unitWidths", [])
        unit_transom_h   = rw.get("unitTransomHeights", [])
        unit_kneewall_h  = rw.get("unitKneewallHeights", [])
        unit_door_styles = rw.get("unitDoorStyles", [])
        n_units          = len(panel_types)

        if unit_widths_raw and len(unit_widths_raw) == n_units:
            parsed = [float(w) for w in unit_widths_raw if str(w).strip()]
            unit_widths_in = parsed if len(parsed) == n_units and sum(parsed) > 0 \
                             else [width_in / n_units] * n_units
        else:
            unit_widths_in = [width_in / n_units] * n_units

        logger.info(f"Wall {rw.get('id')}: {n_units} units, width={width_in}in")

        units = []
        for i in range(n_units):
            mat = unit_materials[i] if i < len(unit_materials) else {}
            th  = float(unit_transom_h[i])  if i < len(unit_transom_h)  and unit_transom_h[i]  else 0.0
            kh  = float(unit_kneewall_h[i]) if i < len(unit_kneewall_h) and unit_kneewall_h[i] else 0.0
            units.append(UnitSpec(
                panel_type   = panel_types[i],
                width_in     = unit_widths_in[i],
                door_style   = unit_door_styles[i] if i < len(unit_door_styles) else "sliding",
                transom_mat  = mat.get("transom", "glass"),
                kneewall_mat = mat.get("kneewall", "glass"),
                transom_h_in = th,
                kneewall_h_in= kh,
            ))

        walls.append(WallSpec(
            wall_id        = rw.get("id", "B"),
            width_in       = width_in,
            height_in      = height_in,
            frame_width_in = frame_w_in,
            units          = units,
            split_transom  = rw.get("splitTransom", False),
            split_kneewall = rw.get("splitKneewall", False),
            gable_glass    = rw.get("gableGlass"),
        ))

    b_wall    = next((w for w in walls if w.wall_id == "B"), walls[0] if walls else None)
    side_wall = next((w for w in walls if w.wall_id in ("A","C")), None)
    proj_dist = float(config.get("projectionDistance") or 0) * 12

    roof = RoofSpec(
        style          = roof_style,
        width_in       = b_wall.width_in   if b_wall    else 0.0,
        depth_in       = side_wall.width_in if side_wall else proj_dist,
        wall_height_in = b_wall.height_in  if b_wall    else 0.0,
        mount_height_in= mount_h_in,
        sub_style      = config.get("roofOnlySubStyle"),
    )

    return SunroomSpec(walls=walls, roof=roof, frame_colour=frame_colour, wall_system=wall_system)

# ─── Shingle texture helpers ──────────────────────────────────────────────────

def sample_roof_colour(photo: Image.Image) -> Tuple[int, int, int]:
    """
    Sample the average colour from the top 15% of the house photo.
    This approximates the existing roof shingle colour so the composite
    roof matches the house and FLUX doesn't need to invent one.
    """
    w, h = photo.size
    crop_h = max(1, int(h * 0.15))
    top_strip = photo.convert("RGB").crop((0, 0, w, crop_h))
    arr = np.array(top_strip, dtype=np.float32)
    r, g, b = arr[:,:,0].mean(), arr[:,:,1].mean(), arr[:,:,2].mean()
    # Darken slightly — roof shingles are usually darker than the sky above them
    factor = 0.75
    return (int(r * factor), int(g * factor), int(b * factor))


def make_shingle_texture(
    width: int,
    height: int,
    base_colour: Tuple[int, int, int],
    course_height: int = 14,   # px per shingle row
    shingle_width: int = 28,   # px per shingle column
) -> Image.Image:
    """
    Generate a procedural shingle texture image of size (width, height).

    Shingles are rendered as staggered rows of slightly varying dark rectangles
    separated by thin shadow lines, approximating asphalt roof shingles.
    """
    img  = Image.new("RGB", (width, height), base_colour)
    draw = ImageDraw.Draw(img)

    br, bg, bb = base_colour

    # Random per-pixel luminance noise for texture grain
    rng = np.random.default_rng(seed=42)
    noise = rng.integers(-18, 18, (height, width, 3), dtype=np.int16)

    # Base fill with noise
    base_arr = np.clip(
        np.array([[list(base_colour)] * width] * height, dtype=np.int16) + noise,
        0, 255
    ).astype(np.uint8)
    img = Image.fromarray(base_arr, "RGB")
    draw = ImageDraw.Draw(img)

    # Draw horizontal shadow lines at each course boundary
    for row_y in range(0, height, course_height):
        # Bottom shadow of each course (darker)
        shadow = (max(0, br - 35), max(0, bg - 35), max(0, bb - 35))
        draw.line([(0, row_y), (width, row_y)], fill=shadow, width=2)
        # Highlight just above (lighter) — gives depth
        if row_y > 1:
            hilight = (min(255, br + 20), min(255, bg + 20), min(255, bb + 20))
            draw.line([(0, row_y - 1), (width, row_y - 1)], fill=hilight, width=1)

    # Draw vertical cut lines between shingles — offset every other row (stagger)
    for row_idx, row_y in enumerate(range(0, height, course_height)):
        offset = (shingle_width // 2) if row_idx % 2 else 0
        for col_x in range(offset, width, shingle_width):
            cut = (max(0, br - 25), max(0, bg - 25), max(0, bb - 25))
            draw.line([(col_x, row_y), (col_x, min(height, row_y + course_height - 2))],
                      fill=cut, width=1)

    # Slight blur to avoid looking too mechanical
    img = img.filter(ImageFilter.GaussianBlur(radius=0.6))
    return img


def _darken(colour: Tuple, factor: float) -> Tuple:
    return tuple(max(0, int(c * factor)) for c in colour[:3])

def _lighten(colour: Tuple, amount: int) -> Tuple:
    return tuple(min(255, c + amount) for c in colour[:3])

# ─── Elevation renderer ───────────────────────────────────────────────────────

class ElevationRenderer:

    def __init__(
        self,
        ppi: float,
        frame_colour: tuple,
        shingle_colour: Optional[Tuple[int, int, int]] = None,
        has_gable: bool = False,
    ):
        self.ppi            = ppi
        self.fc             = frame_colour
        self.shingle_colour = shingle_colour or (70, 65, 58)
        self.has_gable      = has_gable

    def px(self, inches: float) -> int:
        return max(1, round(inches * self.ppi))

    def render_wall(self, wall: WallSpec, is_gable_wall: bool = False) -> Image.Image:
        """
        Render the wall panels as a flat elevation image.

        If is_gable_wall=True, a photorealistic peaked gable is prepended above
        the wall panels using shingle texture sampled from the house photo.
        The gable is rendered as a triangle whose base matches the wall width
        and whose height is ~35% of the wall height.

        Wall C (front wall) is always flat-topped — no gable.
        """
        fw      = self.px(wall.frame_width_in)
        W       = self.px(wall.width_in) + (len(wall.units) + 1) * fw
        H       = self.px(wall.height_in) + 2 * fw
        inner_h = H - 2 * fw

        # Render the wall panel section — fc is a 4-tuple (R,G,B,A) from FRAME_COLOURS
        fc4 = self.fc if len(self.fc) == 4 else self.fc[:3] + (255,)
        panel_img = Image.new("RGBA", (W, H), fc4)
        x = fw
        for unit in wall.units:
            uw = self.px(unit.width_in)
            self._render_unit(panel_img, wall, unit, x, fw, uw, inner_h)
            x += uw + fw

        # Add right-edge frame shadow for depth (thin dark strip on right side)
        self._add_frame_shadow(panel_img, fw)

        if not is_gable_wall:
            return panel_img

        # ── Build gable section above panel wall ──────────────────────────────
        gable_img = self._render_gable_section(W, H, fw, wall)

        # Stack: gable on top, panel below
        gable_h = gable_img.height
        combined_h = gable_h + H
        combined = Image.new("RGBA", (W, combined_h), (0, 0, 0, 0))
        combined.paste(gable_img, (0, 0), gable_img)
        combined.paste(panel_img, (0, gable_h), panel_img)
        return combined

    def _render_gable_section(self, W: int, H: int, fw: int, wall: WallSpec) -> Image.Image:
        """
        Render the peaked gable triangle above Wall B.

        The gable height is ~38% of the wall height.
        The triangle is filled with a shingle texture matching the house roof.
        A ridge cap (slightly lighter strip) runs along the peak.
        The two sloped sides have darker shadow lines.
        """
        gable_h = max(60, round(H * 0.38))
        img     = Image.new("RGBA", (W, gable_h), (0, 0, 0, 0))

        peak_x = W // 2
        peak_y = 0
        bl     = (0,      gable_h)
        br     = (W,      gable_h)
        peak   = (peak_x, peak_y)

        # --- Fill triangle with shingle texture ---
        texture     = make_shingle_texture(W, gable_h, self.shingle_colour)
        texture_arr = np.array(texture.convert("RGBA"))

        # Create a triangle mask using PIL polygon, then apply as alpha
        mask = Image.new("L", (W, gable_h), 0)
        ImageDraw.Draw(mask).polygon([bl, peak, br], fill=255)

        # Paste texture through the triangle mask
        tex_rgba = texture.convert("RGBA")
        tex_rgba.putalpha(mask)
        img.paste(tex_rgba, (0, 0), tex_rgba)

        draw = ImageDraw.Draw(img)

        # --- Rake edges (sloped sides) — darker shadow ---
        edge_dark = _darken(self.shingle_colour, 0.55)
        draw.line([bl, peak], fill=edge_dark + (255,), width=max(3, fw))
        draw.line([peak, br], fill=edge_dark + (255,), width=max(3, fw))

        # --- Ridge cap at peak — lighter strip ---
        ridge_light = _lighten(self.shingle_colour, 45)
        ridge_w     = max(4, fw * 2)
        draw.line(
            [(peak_x - ridge_w, peak_y + 2), (peak_x + ridge_w, peak_y + 2)],
            fill=ridge_light + (255,),
            width=max(3, fw // 2),
        )

        # --- Bottom edge of gable = top frame rail of wall ---
        fc3 = self.fc[:3] if len(self.fc) >= 3 else self.fc
        draw.rectangle(
            [(0, gable_h - fw), (W, gable_h)],
            fill=fc3 + (255,),
        )
        # Subtle underside shadow on that rail
        shadow_c = _darken(fc3, 0.7)
        draw.rectangle(
            [(0, gable_h - fw), (W, gable_h - fw + max(2, fw // 4))],
            fill=shadow_c + (255,),
        )

        # --- Eave drip edge (thin dark line at gable base) ---
        drip  = _darken(self.shingle_colour, 0.45)
        draw.line([(0, gable_h - fw - 1), (W, gable_h - fw - 1)],
                  fill=drip + (255,), width=2)

        return img

    def _add_frame_shadow(self, img: Image.Image, fw: int) -> None:
        """
        Add a subtle darkened strip on the right edge and bottom edge
        of the wall image to simulate the frame casting a shadow into the
        panel interior. This gives depth and makes frames look structural.
        """
        draw  = ImageDraw.Draw(img)
        W, H  = img.size
        shadow_w = max(2, fw // 3)
        shadow_c = _darken(self.fc[:3], 0.65) + (120,)   # semi-transparent
        # Right edge shadow
        draw.rectangle([(W - shadow_w, 0), (W, H)], fill=shadow_c)
        # Bottom edge shadow
        draw.rectangle([(0, H - shadow_w), (W, H)], fill=shadow_c)

    def _render_unit(self, img, wall, unit, x0, fw, uw, inner_h):
        pt           = unit.panel_type
        has_transom  = pt in ("fixed_transom","fixed_tk","oper_tk","door_t")
        has_kneewall = pt in ("fixed_kneewall","fixed_tk","oper_kneewall","oper_tk")
        is_door      = pt in ("door","door_t")
        is_oper      = pt.startswith("oper")
        y = fw

        if has_transom:
            th = self.px(unit.transom_h_in) if unit.transom_h_in > 0 else max(1, round(inner_h * 0.18))
            colour = TRANSOM_TINT if unit.transom_mat == "glass" else KNEEWALL_SOLID
            self._fill(img, x0, y, uw, th, colour)
            if wall.split_transom:
                draw = ImageDraw.Draw(img)
                mid  = x0 + uw // 2
                draw.rectangle([mid - fw//2, y, mid + fw//2, y + th], fill=self.fc)
            draw = ImageDraw.Draw(img)
            draw.rectangle([x0, y + th, x0 + uw, y + th + fw], fill=self.fc)
            y += th + fw

        kh = 0
        if has_kneewall:
            kh = self.px(unit.kneewall_h_in) if unit.kneewall_h_in > 0 else max(1, round(inner_h * 0.22))

        glass_bottom = (fw + inner_h) - kh - (fw if has_kneewall else 0)
        glass_h      = max(10, glass_bottom - y)
        main_colour  = PANEL_MAIN_COLOUR.get(pt, GLASS_BLUE)
        self._fill(img, x0, y, uw, glass_h, main_colour)

        if is_door and unit.door_style in DOOR_SPLIT:
            draw = ImageDraw.Draw(img)
            mid  = x0 + uw // 2
            draw.rectangle([mid - fw//2, y, mid + fw//2, y + glass_h], fill=self.fc)
            draw.rectangle([x0 + uw - fw - 5, y + glass_h//3, x0 + uw - fw - 2, y + glass_h//3 + max(8, glass_h//5)], fill=HANDLE_GREY)
        elif is_oper:
            draw  = ImageDraw.Draw(img)
            mid_x = x0 + uw // 2
            rail_w= max(2, round(fw * 0.4))
            draw.rectangle([mid_x - rail_w//2, y, mid_x + rail_w//2, y + glass_h], fill=self.fc)

        y += glass_h

        if has_kneewall and kh > 0:
            draw = ImageDraw.Draw(img)
            draw.rectangle([x0, y, x0 + uw, y + fw], fill=self.fc)
            y += fw
            if unit.kneewall_mat == "solid":
                # Render solid kneewall with vertical gradient for realism
                self._fill_kneewall_solid(img, x0, y, uw, kh)
            else:
                self._fill(img, x0, y, uw, kh, GLASS_BLUE)

    def _fill_kneewall_solid(self, img: Image.Image, x: int, y: int, w: int, h: int) -> None:
        """
        Draw a solid kneewall panel with a subtle top-to-bottom gradient
        to simulate a raised panel or vinyl lap siding appearance.
        """
        if w <= 0 or h <= 0:
            return
        base = np.array(KNEEWALL_SOLID[:3], dtype=np.float32)
        panel_arr = np.zeros((h, w, 4), dtype=np.uint8)
        for row in range(h):
            t = row / max(1, h - 1)
            # Slightly darker at bottom
            c = np.clip(base * (1.0 - 0.12 * t), 0, 255).astype(np.uint8)
            panel_arr[row, :, :3] = c
            panel_arr[row, :,  3] = 255
        block = Image.fromarray(panel_arr, "RGBA")
        img.paste(block, (x, y), block)

    @staticmethod
    def _fill(img, x, y, w, h, colour):
        if w <= 0 or h <= 0: return
        block = Image.new("RGBA", (w, h), (colour[0], colour[1], colour[2], 255))
        img.paste(block, (x, y), block)

# ─── Perspective utilities ────────────────────────────────────────────────────

def compute_homography(src_pts, dst_pts):
    A = []
    for (sx,sy),(dx,dy) in zip(src_pts, dst_pts):
        A.append([-sx,-sy,-1, 0,  0, 0, dx*sx,dx*sy,dx])
        A.append([ 0,  0, 0,-sx,-sy,-1, dy*sx,dy*sy,dy])
    A = np.array(A, dtype=np.float64)
    _,_,Vt = np.linalg.svd(A)
    H = Vt[-1].reshape(3,3)
    return H / H[2,2]

def warp_image_perspective(src, H, out_size):
    out_w, out_h = out_size
    src_arr = np.array(src.convert("RGBA"), dtype=np.float32)
    src_h, src_w = src_arr.shape[:2]
    H_inv = np.linalg.inv(H)
    ys, xs = np.meshgrid(np.arange(out_h), np.arange(out_w), indexing="ij")
    coords = np.stack([xs, ys, np.ones_like(xs)], axis=-1).reshape(-1,3).T
    sc = H_inv @ coords
    sc /= sc[2:3,:]
    sx = sc[0].reshape(out_h, out_w)
    sy = sc[1].reshape(out_h, out_w)
    sx0 = np.clip(np.floor(sx).astype(int), 0, src_w-1)
    sy0 = np.clip(np.floor(sy).astype(int), 0, src_h-1)
    sx1 = np.clip(sx0+1, 0, src_w-1)
    sy1 = np.clip(sy0+1, 0, src_h-1)
    tx = (sx-sx0)[...,None]; ty = (sy-sy0)[...,None]
    warped = (src_arr[sy0,sx0]*(1-tx)*(1-ty) + src_arr[sy0,sx1]*tx*(1-ty) +
              src_arr[sy1,sx0]*(1-tx)*ty     + src_arr[sy1,sx1]*tx*ty).astype(np.uint8)
    valid = (sx>=0)&(sx<src_w)&(sy>=0)&(sy<src_h)
    warped[~valid] = [0,0,0,0]
    return Image.fromarray(warped, "RGBA")

def generate_edge_mask(warped_render, photo_size, edge_px=35, full_footprint=True):
    alpha = warped_render.split()[3]
    if full_footprint:
        mask = alpha.filter(ImageFilter.MaxFilter(edge_px*2+1)).filter(ImageFilter.GaussianBlur(radius=14))
    else:
        dilated = alpha.filter(ImageFilter.MaxFilter(edge_px*2+1))
        eroded  = alpha.filter(ImageFilter.MinFilter(max(3,edge_px-12)*2+1))
        edge    = np.clip(np.array(dilated,dtype=np.float32) - np.array(eroded,dtype=np.float32)*0.5, 0, 255).astype(np.uint8)
        mask    = Image.fromarray(edge,"L").filter(ImageFilter.GaussianBlur(radius=10))
    return mask.resize(photo_size, Image.LANCZOS)

# ─── 5-point perspective renderer ────────────────────────────────────────────

def render_with_5pts(
    house_photo: Image.Image,
    spec:        SunroomSpec,
    pts:         list,          # 5 normalized [x,y] points
    wall_system: str,
    ppi:         float = 5.0,
) -> tuple[Image.Image, Image.Image]:
    """
    Render using 5 traced points:
      pt0 = left house wall top
      pt1 = right house wall top
      pt2 = right house wall bottom
      pt3 = left house wall bottom
      pt4 = front corner ground (where walls meet in the patio)

    For BC combo:
      Wall B = left side wall running from house toward camera
        house attachment: pt0 (top) / pt3 (bottom)
        front face: pt4 (ground) / front_corner_top (computed)
      Wall C = front wall facing camera
        house attachment: pt1 (top) / pt2 (bottom)
        front face: pt4 (ground) / front_corner_top (computed)

    front_corner_top is computed by going UP from pt4 by
    wall_height_px, where wall_height_px is derived from the
    left house wall height (pt0→pt3) and real wall height in feet.
    """
    photo_w, photo_h = house_photo.size
    frame_colour     = FRAME_COLOURS.get(spec.frame_colour, FRAME_WHITE)

    # Sample shingle colour from house photo for gable texture
    shingle_colour   = sample_roof_colour(house_photo)
    logger.info(f"Sampled shingle colour from house photo: {shingle_colour}")

    # Convert normalized points to pixel coords
    def to_px(p):
        return np.array([p[0] * photo_w, p[1] * photo_h])

    p0 = to_px(pts[0])  # left house wall top
    p1 = to_px(pts[1])  # right house wall top
    p2 = to_px(pts[2])  # right house wall bottom
    p3 = to_px(pts[3])  # left house wall bottom
    p4 = to_px(pts[4])  # front corner ground

    # Derive pixels-per-foot from left wall height
    b_wall = next((w for w in spec.walls if w.wall_id == "B"), spec.walls[0])
    wall_h_ft  = b_wall.height_in / 12.0 if b_wall.height_in > 0 else 8.0
    left_h_px  = float(np.linalg.norm(p3 - p0))
    px_per_ft  = left_h_px / wall_h_ft if wall_h_ft > 0 else 30.0
    wall_h_px  = left_h_px  # use measured height directly

    # Front corner top = pt4 shifted upward by wall height
    left_up  = (p0 - p3) / np.linalg.norm(p0 - p3) if np.linalg.norm(p0 - p3) > 0 else np.array([0,-1])
    right_up = (p1 - p2) / np.linalg.norm(p1 - p2) if np.linalg.norm(p1 - p2) > 0 else np.array([0,-1])
    up_dir   = (left_up + right_up) / 2.0
    up_dir   = up_dir / np.linalg.norm(up_dir)

    front_corner_top = p4 + up_dir * wall_h_px

    logger.info(f"5pt render: wall_h_px={wall_h_px:.0f} px_per_ft={px_per_ft:.1f}")
    logger.info(f"  p0={p0.tolist()} p1={p1.tolist()} p2={p2.tolist()} p3={p3.tolist()} p4={p4.tolist()}")
    logger.info(f"  front_corner_top={front_corner_top.tolist()}")

    composite        = house_photo.convert("RGBA").copy()
    all_warped_alpha = Image.new("L", (photo_w, photo_h), 0)

    # Identify Wall B and Wall C
    b_wall_spec = next((w for w in spec.walls if w.wall_id == "B"), None)
    c_wall_spec = next((w for w in spec.walls if w.wall_id == "C"), None)
    a_wall_spec = next((w for w in spec.walls if w.wall_id == "A"), None)

    roof_style  = spec.roof.style
    walls_to_place: list[tuple[WallSpec, list, bool]] = []  # (wall, dst_corners, is_gable_wall)

    if b_wall_spec and c_wall_spec:
        # BC combo
        # Wall B: left side wall running toward camera — has gable
        walls_to_place.append((b_wall_spec, [p0, front_corner_top, p4, p3], roof_style == "gable"))
        # Wall C: front wall facing camera — flat-topped
        walls_to_place.append((c_wall_spec, [front_corner_top, p1, p2, p4], False))

    elif a_wall_spec and b_wall_spec:
        # AB combo
        # Wall A: front wall facing camera — flat-topped
        walls_to_place.append((a_wall_spec, [p0, front_corner_top, p4, p3], False))
        # Wall B: right side wall running away — has gable
        walls_to_place.append((b_wall_spec, [front_corner_top, p1, p2, p4], roof_style == "gable"))

    elif b_wall_spec:
        # Single wall — gable if applicable
        walls_to_place.append((b_wall_spec, [p0, p1, p2, p3], roof_style == "gable"))

    for wall, dst_corners, is_gable_wall in walls_to_place:
        renderer  = ElevationRenderer(
            ppi            = ppi,
            frame_colour   = frame_colour,
            shingle_colour = shingle_colour,
            has_gable      = is_gable_wall,
        )
        elevation = renderer.render_wall(wall, is_gable_wall=is_gable_wall)
        ew, eh    = elevation.size

        tl, tr, br, bl = [np.array(c) for c in dst_corners]

        # If gable was prepended, the dst quad must be extended upward to accommodate it.
        # The panel section is the bottom H pixels; the gable is (eh - H) pixels on top.
        # We extend the top-left and top-right corners upward proportionally.
        if is_gable_wall:
            # Compute the fraction of the total elevation height that is gable
            panel_H  = renderer.px(wall.height_in) + 2 * renderer.px(wall.frame_width_in)
            gable_H  = eh - panel_H
            frac     = gable_H / eh if eh > 0 else 0.0

            # In dst space, "up" from the top edge by the same fraction of wall height in px
            # Use up_dir derived from the house wall sides
            extra_up_px = wall_h_px * frac
            tl_ext = tl + up_dir * extra_up_px
            tr_ext = tr + up_dir * extra_up_px

            src_pts = np.array([[0,0],[ew,0],[ew,eh],[0,eh]], dtype=np.float64)
            dst_pts = np.array([tl_ext, tr_ext, br, bl],     dtype=np.float64)
        else:
            src_pts = np.array([[0,0],[ew,0],[ew,eh],[0,eh]], dtype=np.float64)
            dst_pts = np.array([tl, tr, br, bl],             dtype=np.float64)

        H      = compute_homography(src_pts, dst_pts)
        warped = warp_image_perspective(elevation, H, (photo_w, photo_h))

        # Force full opacity for non-transparent pixels
        warped_arr        = np.array(warped, dtype=np.float32)
        warped_arr[:,:,3] = np.where(warped_arr[:,:,3] > 10, 255, 0)
        warped            = Image.fromarray(warped_arr.astype(np.uint8), "RGBA")

        composite.paste(warped, (0, 0), warped)
        acc              = np.maximum(np.array(all_warped_alpha), np.array(warped.split()[3]))
        all_warped_alpha = Image.fromarray(acc.astype(np.uint8), "L")

    composite_rgb = composite.convert("RGB")
    combined      = composite.copy()
    combined.putalpha(all_warped_alpha)
    edge_mask     = generate_edge_mask(combined, (photo_w, photo_h), edge_px=40, full_footprint=True)
    return composite_rgb, edge_mask

# ─── Box-based fallback ───────────────────────────────────────────────────────

def render_with_box(
    house_photo: Image.Image,
    spec:        SunroomSpec,
    box_x1: float, box_y1: float,
    box_x2: float, box_y2: float,
    ppi:    float = 5.0,
) -> tuple[Image.Image, Image.Image]:
    photo_w, photo_h = house_photo.size
    frame_colour     = FRAME_COLOURS.get(spec.frame_colour, FRAME_WHITE)
    shingle_colour   = sample_roof_colour(house_photo)

    bx1 = int(box_x1 * photo_w); by1 = int(box_y1 * photo_h)
    bx2 = int(box_x2 * photo_w); by2 = int(box_y2 * photo_h)
    bw  = max(1, bx2-bx1); bh = max(1, by2-by1)

    walls_to_render = [w for w in spec.walls if w.width_in > 0]
    if not walls_to_render:
        return house_photo, Image.new("L", (photo_w, photo_h), 0)

    total_width_in   = sum(w.width_in for w in walls_to_render)
    composite        = house_photo.convert("RGBA").copy()
    all_warped_alpha = Image.new("L", (photo_w, photo_h), 0)
    cursor_x         = bx1
    roof_style       = spec.roof.style

    for i, wall in enumerate(walls_to_render):
        # In box mode, only the first wall (leftmost, = Wall B) gets a gable
        is_gable_wall = (i == 0 and roof_style == "gable")
        renderer  = ElevationRenderer(
            ppi            = ppi,
            frame_colour   = frame_colour,
            shingle_colour = shingle_colour,
            has_gable      = is_gable_wall,
        )
        wall_bw   = round(bw * wall.width_in / total_width_in)
        elevation = renderer.render_wall(wall, is_gable_wall=is_gable_wall)
        ew, eh    = elevation.size
        src_pts   = np.array([[0,0],[ew,0],[ew,eh],[0,eh]], dtype=np.float64)
        dst_pts   = np.array([[cursor_x,by1],[cursor_x+wall_bw,by1],[cursor_x+wall_bw,by2],[cursor_x,by2]], dtype=np.float64)
        H         = compute_homography(src_pts, dst_pts)
        warped    = warp_image_perspective(elevation, H, (photo_w, photo_h))
        warped_arr= np.array(warped, dtype=np.float32)
        warped_arr[:,:,3] = np.where(warped_arr[:,:,3] > 10, 255, 0)
        warped    = Image.fromarray(warped_arr.astype(np.uint8), "RGBA")
        composite.paste(warped, (0,0), warped)
        acc       = np.maximum(np.array(all_warped_alpha), np.array(warped.split()[3]))
        all_warped_alpha = Image.fromarray(acc.astype(np.uint8), "L")
        cursor_x += wall_bw

    composite_rgb = composite.convert("RGB")
    combined      = composite.copy(); combined.putalpha(all_warped_alpha)
    edge_mask     = generate_edge_mask(combined, (photo_w, photo_h), edge_px=40, full_footprint=True)
    return composite_rgb, edge_mask

# ─── Flat wall splitter ───────────────────────────────────────────────────────

def _split_flat_wall(flat, spec):
    tl, tr, br, bl = [np.array(p) for p in flat]
    total_w = sum(w.width_in for w in spec.walls) or 1.0
    corners = {}; cum = 0.0
    for wall in spec.walls:
        t0 = cum/total_w; t1 = (cum+wall.width_in)/total_w
        corners[wall.wall_id] = [
            (tl+t0*(tr-tl)).tolist(), (tl+t1*(tr-tl)).tolist(),
            (bl+t1*(br-bl)).tolist(), (bl+t0*(br-bl)).tolist(),
        ]
        cum += wall.width_in
    return corners

# ─── Public entry point ───────────────────────────────────────────────────────

def render_sunroom(
    house_photo_bytes: bytes,
    config:            dict,
    box_x1: float, box_y1: float,
    box_x2: float, box_y2: float,
    wall_corners: Optional[dict] = None,
    ppi: float = 5.0,
) -> tuple[bytes, bytes]:
    spec  = parse_config(config)
    photo = Image.open(io.BytesIO(house_photo_bytes)).convert("RGB")

    if wall_corners and "_5pt" in wall_corners:
        pts = wall_corners["_5pt"]
        logger.info(f"Using 5-point perspective renderer with pts={pts}")
        composite, edge_mask = render_with_5pts(photo, spec, pts, config.get("wallSystem","4_inch"), ppi=ppi)

    elif wall_corners and "_flat_wall" in wall_corners:
        split = _split_flat_wall(wall_corners["_flat_wall"], spec)
        all_pts = [p for corners in split.values() for p in corners]
        xs = [p[0] for p in all_pts]; ys = [p[1] for p in all_pts]
        composite, edge_mask = render_with_box(
            photo, spec, min(xs), min(ys), max(xs), max(ys), ppi=ppi
        )

    elif wall_corners and "B" in wall_corners:
        all_pts = [p for corners in wall_corners.values() for p in corners
                   if p and None not in p]
        if all_pts:
            xs = [p[0] for p in all_pts]; ys = [p[1] for p in all_pts]
            composite, edge_mask = render_with_box(
                photo, spec, min(xs), min(ys), max(xs), max(ys), ppi=ppi
            )
        else:
            composite, edge_mask = render_with_box(
                photo, spec, box_x1, box_y1, box_x2, box_y2, ppi=ppi
            )
    else:
        composite, edge_mask = render_with_box(
            photo, spec, box_x1, box_y1, box_x2, box_y2, ppi=ppi
        )

    comp_buf = io.BytesIO(); composite.save(comp_buf, format="JPEG", quality=95)
    mask_buf = io.BytesIO(); edge_mask.save(mask_buf, format="PNG")
    return comp_buf.getvalue(), mask_buf.getvalue()