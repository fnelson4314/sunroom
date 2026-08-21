import { useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProductLine = {
  id: string;
  product_name: string;
  description: string | null;
  wall_system: "2_inch" | "4_inch" | "6_inch";
};

export type Option = {
  id: string;
  category: string;
  name: string;
  unit_price: number;
  unit_type: string;
  affects_visual: boolean;
  sort_order: number;
  product_line_id: string | null;
};

export type UnitMaterials = {
  transom: "glass" | "solid";
  kneewall: "glass" | "solid";
};

export type SolidMaterial = "panel" | "vinyl" | "hardieboard";

export type GableGlassConfig = {
  glassType: "uninsulated" | "g1" | "solid";
  solidStyle: SolidMaterial; // only relevant when glassType === "solid"
  count: number;
};

export type DoorStyle = "sliding" | "entry" | "storm" | "french";

/**
 * Gable/wing glass follows the BASE wall type: a G1-insulated wall gets Comfort
 * G1 gable glass, a single-pane wall gets uninsulated single pane. It is NOT an
 * independent choice — the UI only picks glass vs solid — so it is derived here
 * rather than stored, which also keeps the priced option in step with the price
 * note WallBuilder shows (getGlassOptionName mirrors this test).
 */
export function gableGlassTypeForWallType(
  wallTypeName?: string | null,
): "uninsulated" | "g1" {
  const l = (wallTypeName || "").toLowerCase();
  return l.includes("6") ||
    l.includes("all-season") ||
    l.includes("g1") ||
    l.includes("insulated")
    ? "g1"
    : "uninsulated";
}

/**
 * Replace ONE wall's priced gable/wing add-on in `wallOptions`. Shared by the
 * glass-room setter, the screen-room setter and setWallType (which must re-price
 * when the base wall type changes), so a gable can never be priced as one glass
 * grade while the wall is another.
 *
 * `priceGlass=false` for SCREEN rooms: their non-solid gable is screen mesh, not
 * glass — there is no catalog line for it, and charging the $2.5k glass option
 * would be flatly wrong. Solid wing panels are priced for both room types.
 */
function applyGableAddOn(
  wallId: string,
  config: GableGlassConfig | null,
  wallOptions: Record<string, string>,
  allOptions: Option[],
  priceGlass = true,
): Record<string, string> {
  const next = { ...wallOptions };
  const find = (s: string) => allOptions.find((o) => o.name.includes(s));
  const uninsulatedOpt = find("Gable or Wing Glass Uninsulated");
  const g1Opt = find("Gable or Wing Glass Comfort");
  const solidOpt = find("Solid Wing Panel");

  [uninsulatedOpt, g1Opt, solidOpt].forEach((o) => {
    if (o) delete next[o.id];
  });
  if (!config) return next;

  if (config.glassType === "solid") {
    // Fixed price regardless of pane count — B (gable) is 2 pieces, wings are 1.
    if (solidOpt) next[solidOpt.id] = wallId === "B" ? "2" : "1";
    return next;
  }
  if (!priceGlass) return next;
  const glassOpt = config.glassType === "g1" ? g1Opt : uninsulatedOpt;
  if (glassOpt) next[glassOpt.id] = String(config.count); // priced per pane
  return next;
}

// ─── Screen room types ────────────────────────────────────────────────────────

export type ScreenUnitType = "screen" | "door";

// Screen doors are a fixed 7ft — matches DOOR_MAX_IN in ScreenRoomBuilder.tsx
export const DOOR_MAX_IN = 84;

export type ScreenWallSelection = {
  id: "A" | "B" | "C";
  widthIn: string;
  heightIn: string;
  unitWidths: string[]; // auto-calculated from widthIn, individually adjustable
  unitTypes: ScreenUnitType[];
  unitLocked: boolean[]; // true = user manually set, preserved during redistribution
  gableGlass: GableGlassConfig | null;
};

export type ScreenRoomConfig = {
  walls: ScreenWallSelection[];
  kneewall: { enabled: boolean; heightIn: string; solidStyle: SolidMaterial };
  // `walls` lists the wall ids the rail is actually on. Enabling the feature no
  // longer implies every wall — a rail is chosen per WALL (never per unit).
  // Defaults to all designed walls on enable so existing drafts price the same.
  chairrail: { enabled: boolean; heightIn: string; walls: string[] };
  handrail: { enabled: boolean; walls: string[] };
  // ONE transom for the whole screen room (was per wall). On walls with no
  // gable/wing it's the usual band inside the unit cells; on the gable/wing wall
  // that height is eaten out of the TOP of the wall and becomes the flat base of
  // the gable/wing shape instead — see screenGableFlatIn.
  transom: { enabled: boolean; heightIn: string };
};

/**
 * Inches of the structure-wide transom that belong to this wall's gable/wing
 * shape rather than its unit cells. 0 on every wall without a gable/wing, so
 * those keep the in-cell band. Shared by the configurator canvas and the
 * renderer payload so the 2D preview and the 3D composite can't disagree.
 */
export function screenGableFlatIn(
  wall: ScreenWallSelection,
  roofStyle: string | null,
  transom: ScreenRoomConfig["transom"] | undefined,
): number {
  if (!transom?.enabled || !wall.gableGlass) return 0;
  const carries =
    (wall.id === "B" && roofStyle === "gable") ||
    (wall.id !== "B" && roofStyle === "studio");
  if (!carries) return 0;
  const h = parseFloat(wall.heightIn) || 0;
  const t = parseFloat(transom.heightIn) || 0;
  // Clamp to half the wall only when we actually KNOW this wall's height. A wing
  // wall whose own height was never entered (its tab was never opened —
  // canGenerate only validated wall B until 2026-07-27) hit Math.min(t, 0) and
  // silently lost its flat base: the 2D drew the trapezoid on the wall you had
  // filled in while the 3D drew a plain triangle on the blank one. The renderer
  // re-clamps against the height it actually draws (scene.html flatH), so the
  // "never eat more than half" guarantee still holds where the height is real.
  return h > 0 ? Math.max(0, Math.min(t, h / 2)) : Math.max(0, t);
}

export type WallSelection = {
  id: "A" | "B" | "C";
  widthIn: string; // wall width in inches
  heightIn: string; // wall height in inches
  units: number;
  panelTypes: string[];
  unitMaterials: UnitMaterials[];
  unitTransomHeights: string[]; // per-unit override; "" = use global default
  unitKneewallHeights: string[]; // per-unit override; "" = use global default
  unitDoorStyles: DoorStyle[]; // per-unit door style
  splitTransom: boolean;
  splitKneewall: boolean;
  solidPanelMaterial: SolidMaterial;
  unitWidths: string[];
  unitLocked: boolean[];
  gableGlass: GableGlassConfig | null;
};

export type LineItem = {
  optionId: string;
  quantity: string;
};

export type ConfigureState = {
  selectedProductLine: ProductLine | null;
  roofStyle: "studio" | "gable" | "under_existing" | "roof_only" | null;
  roofOnlySubStyle: "gable" | "studio" | null;
  // Under-existing: the shape of the EXISTING roof the walls go beneath.
  underExistingShape: "gable" | "studio" | null;
  // Under-existing: whether to ADD a new gable/wing infill (glass or solid) above
  // the header (true), or run the walls up to the EXISTING gable that's kept in
  // place ("walls only", false — e.g. screen-room conversions). Default true.
  includeGableWings: boolean;
  roofOnlyWidthIn: string; // width in inches — ceil to ft for pricing, no overhang
  roofOnlyDepthIn: string; // depth in inches — ceil to ft for pricing, no overhang
  roofOnlyWallHeightIn: string; // wall height in inches for roof_only
  numberOfWalls: 1 | 2 | 3 | null;
  wallCombo: "AB" | "BC" | null;
  projectionDistance: string;
  mountHeight: string; // total height ground→peak/wing-top, in INCHES (converted to ft at the API boundary)
  wallColor: "white" | "tan" | "bronze" | null;
  lineItems: Record<string, string>;
  wallType: Option | null;
  // Remembered base wall type per product line id, so switching lines and back
  // restores the previously selected wall type for that line.
  wallTypeByLine: Record<string, Option>;
  walls: WallSelection[];
  wallAddOns: Record<string, Record<string, string>>;
  defaultTransomHeightIn: string; // global default transom height (inches)
  defaultKneewallHeightIn: string; // global default kneewall height (inches)
  // Structure-wide solid material (panel/vinyl/hardieboard) per feature. Picking
  // solid on a transom/kneewall/wing shares ONE style across ALL solid sections of
  // that feature — kneewall, transom, and wing are independent of each other
  // (e.g. vinyl kneewalls + hardieboard transoms). Mirrors screenRoom.kneewall.solidStyle.
  solidStyles: { transom: SolidMaterial; kneewall: SolidMaterial; wing: SolidMaterial };
  roofType: Option | null;
  roofColorNote: string;
  roofAddOns: Record<string, string>;
  customerName: string;
  customerEmail: string;
  notes: string;
  screenRoom: ScreenRoomConfig;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultUnitMaterials(): UnitMaterials {
  return { transom: "glass", kneewall: "glass" };
}

function makeWall(id: "A" | "B" | "C"): WallSelection {
  return {
    id,
    widthIn: "",
    heightIn: "",
    units: 1,
    panelTypes: ["fixed_glass"],
    unitMaterials: [defaultUnitMaterials()],
    unitTransomHeights: [""],
    unitKneewallHeights: [""],
    unitDoorStyles: ["sliding"],
    splitTransom: false,
    splitKneewall: false,
    solidPanelMaterial: "panel",
    unitWidths: [],
    unitLocked: [],
    gableGlass: null,
  };
}

function makeScreenWall(id: "A" | "B" | "C"): ScreenWallSelection {
  return {
    id,
    widthIn: "",
    heightIn: "",
    unitWidths: [],
    unitTypes: [],
    unitLocked: [],
    gableGlass: null,
  };
}

// Door leaves are a fixed 36in; every other unit divides what's left, up to 48in
// each. Applies to screen-room doors and to storm/entry doors on glass rooms —
// a sliding patio door keeps its configured width (it is a two-leaf assembly, not
// a single 36in leaf). User rule, 2026-08-20.
export const DOOR_UNIT_IN = 36;
export const MAX_UNIT_IN = 48;

/** Auto-divide wall width: doors are a fixed 36", other units share the rest (≤48" each). */
export function recalcScreenUnits(
  widthIn: string,
  existingTypes?: ScreenUnitType[],
): {
  unitWidths: string[];
  unitTypes: ScreenUnitType[];
  unitLocked: boolean[];
} {
  const w = parseFloat(widthIn) || 0;
  if (w <= 0) return { unitWidths: [], unitTypes: [], unitLocked: [] };
  const count = Math.max(1, Math.ceil(w / MAX_UNIT_IN));
  const unitTypes: ScreenUnitType[] = Array.from(
    { length: count },
    (_, i) => existingTypes?.[i] ?? "screen",
  );
  // Doors are a FIXED 36in leaf; only the non-door units share what's left of
  // the wall. Dividing everything evenly gave doors the same 48in as a screen
  // panel, which is not a product we make (user 2026-08-20).
  const unitWidths = distributeUnitWidths(
    w,
    unitTypes.map((t) => t === "door"),
  );
  const unitLocked: boolean[] = Array.from({ length: count }, () => false);
  return { unitWidths, unitTypes, unitLocked };
}

/**
 * Split a wall into unit widths where every DOOR takes a fixed DOOR_UNIT_IN and
 * the remaining width is shared evenly by the rest. Shared by the screen-room
 * auto-divide and the glass-room door handling so the two can't drift.
 * Falls back to an even split when doors would consume the whole wall.
 */
export function distributeUnitWidths(
  totalIn: number,
  isDoor: boolean[],
): string[] {
  const n = isDoor.length;
  if (n === 0 || totalIn <= 0) return [];
  const doors = isDoor.filter(Boolean).length;
  const others = n - doors;
  const remaining = totalIn - doors * DOOR_UNIT_IN;
  // Not enough wall left for the non-door units — fall back to an even split so
  // a narrow wall still produces something usable rather than negative widths.
  if (others > 0 && remaining <= 0) {
    const even = String(Math.round((totalIn / n) * 10) / 10);
    return Array.from({ length: n }, () => even);
  }
  // Every unit is a door (e.g. a narrow wall that IS the doorway): they share the
  // wall evenly rather than each taking 36in and leaving the rest of the wall
  // unaccounted for, which would open a gap in the drawn layout.
  if (others === 0) {
    const even = String(Math.round((totalIn / n) * 10) / 10);
    return Array.from({ length: n }, () => even);
  }
  const each = remaining / others;
  return isDoor.map((d) =>
    d ? String(DOOR_UNIT_IN) : String(Math.round(each * 10) / 10),
  );
}

/**
 * Convert an inch string to ceiling feet for pricing.
 * e.g. "125" → ceil(125/12) = 11 ft
 *      "120" → ceil(120/12) = 10 ft
 */
export function inToCeilFt(inches: string): number {
  const n = parseFloat(inches);
  if (!n || n <= 0) return 0;
  return Math.ceil(n / 12);
}

/**
 * EXACT inches → feet, for DISPLAY hints under dimension inputs.
 * Never use inToCeilFt for these: it made a 102" wall read "= 9 ft" when it is
 * 8.5 ft, which reads as the app silently changing the entered dimension.
 * Ceiling belongs to PRICING quantities (sq ft / lin ft) only.
 * e.g. "102" → "8.5", "96" → "8", "125" → "10.42"
 */
export function inToFtLabel(inches: string): string {
  const n = parseFloat(inches);
  if (!n || n <= 0) return "0";
  return String(Math.round((n / 12) * 100) / 100);
}

/**
 * Recount storm and french door units on a wall and sync their wallAddOns entries.
 * Called from setUnitDoorStyle and setWallPanelType so counts stay accurate when
 * either the panel type or the door style changes.
 *
 * Storm door  → catalog option matching "storm door"      — priced per unit count
 * French door → catalog option matching "cambridge double door" — priced per unit count
 */
function syncDoorStyleAddOns(
  wall: WallSelection,
  wallOptions: Record<string, string>,
  allOptions: Option[],
): Record<string, string> {
  const result = { ...wallOptions };

  let stormCount = 0;
  let frenchCount = 0;
  wall.panelTypes.forEach((ptId, i) => {
    if (ptId !== "door" && ptId !== "door_t") return;
    const ds = wall.unitDoorStyles[i] ?? "sliding";
    if (ds === "storm") stormCount++;
    if (ds === "french") frenchCount++;
  });

  const stormOpt = allOptions.find(
    (o) =>
      o.category === "wall_type" && o.name.toLowerCase().includes("storm door"),
  );
  if (stormOpt) {
    if (stormCount > 0) result[stormOpt.id] = String(stormCount);
    else delete result[stormOpt.id];
  }

  const frenchOpt = allOptions.find(
    (o) =>
      o.category === "wall_type" &&
      o.name.toLowerCase().includes("cambridge double door"),
  );
  if (frenchOpt) {
    if (frenchCount > 0) result[frenchOpt.id] = String(frenchCount);
    else delete result[frenchOpt.id];
  }

  return result;
}

const initialState: ConfigureState = {
  selectedProductLine: null,
  roofStyle: null,
  roofOnlySubStyle: null,
  underExistingShape: null,
  includeGableWings: true,
  roofOnlyWidthIn: "",
  roofOnlyDepthIn: "",
  roofOnlyWallHeightIn: "",
  numberOfWalls: null,
  wallCombo: null,
  projectionDistance: "",
  mountHeight: "",
  wallColor: null,
  lineItems: {},
  wallType: null,
  wallTypeByLine: {},
  walls: [],
  wallAddOns: {},
  defaultTransomHeightIn: "",
  defaultKneewallHeightIn: "",
  solidStyles: { transom: "panel", kneewall: "panel", wing: "panel" },
  roofType: null,
  roofColorNote: "",
  roofAddOns: {},
  customerName: "",
  customerEmail: "",
  notes: "",
  screenRoom: {
    walls: [],
    kneewall: { enabled: false, heightIn: "", solidStyle: "panel" },
    chairrail: { enabled: false, heightIn: "", walls: [] },
    handrail: { enabled: false, walls: [] },
    transom: { enabled: false, heightIn: "" },
  },
};

// ─── Hook ────────────────────────────────────────────────────────────────────

// ─── Wall dimensions are shared by both builders ─────────────────────────────
// Width/height describe the PHYSICAL wall, not the product line, so an edit in
// either builder writes both state.walls (glass) and screenRoom.walls (screen).
// They used to be independent, and the renderer solves the PnP camera purely
// from the wall widths (getPnPDims in sunroom-3d/server.js) — so two builders
// holding two footprints meant the SAME plotted points produced two different
// camera poses, and the composite came out rotated when the line was switched.
// Only the unit layout differs per builder, so each side re-divides its own.
//
// Deliberately EDIT-TIME ONLY. Syncing on load or on a product-line switch was
// tried and reverted: it silently overwrites dimensions the user entered in the
// other builder, which spreads whichever footprint is wrong instead of fixing
// it. A dimension that disagrees with the plotted points has to be retyped —
// nothing here can know which of the two sets matches the photo.

/**
 * A glass-room unit that takes the FIXED 36in door leaf. Storm and entry doors
 * are a single hinged leaf, so they get DOOR_UNIT_IN; a SLIDING or french patio
 * door is a multi-leaf assembly whose width is the opening the user configured,
 * so it keeps its share. User rule, 2026-08-20.
 */
export function isFixedWidthDoor(panelType: string, doorStyle?: string): boolean {
  return (
    String(panelType).includes("door") &&
    (doorStyle === "entry" || doorStyle === "storm")
  );
}

/**
 * Handrail quantity (lin ft) for a screen room: only the walls the rail is
 * actually ON, and each DOOR on those walls removes a 36in door leaf's worth —
 * you cannot run a handrail across a doorway (user rule, 2026-08-20). Ceiled
 * per wall, matching how every other lin-ft quantity here is priced.
 */
export function handrailLinFt(screenRoom: ScreenRoomConfig): number {
  const on = new Set(screenRoom.handrail.walls);
  return screenRoom.walls
    .filter((w) => on.has(w.id))
    .reduce((sum, w) => {
      const doors = w.unitTypes.filter((t) => t === "door").length;
      const netIn = Math.max(0, (parseFloat(w.widthIn) || 0) - doors * DOOR_UNIT_IN);
      return sum + inToCeilFt(String(netIn));
    }, 0);
}

/** Re-lay a glass wall's unit widths with fixed-width doors honoured. */
function relayoutGlassWidths(w: WallSelection): string[] {
  const totalIn = parseFloat(w.widthIn) || 0;
  const flags = w.panelTypes.map((pt, i) =>
    isFixedWidthDoor(pt, w.unitDoorStyles[i]),
  );
  if (!flags.some(Boolean)) return w.unitWidths;
  return distributeUnitWidths(totalIn, flags);
}

function applyGlassDim(
  w: WallSelection,
  field: "widthIn" | "heightIn",
  value: string,
): WallSelection {
  if (field !== "widthIn") return { ...w, [field]: value };
  const totalIn = parseFloat(value) || 0;
  const locked =
    w.unitLocked.length === w.unitWidths.length
      ? w.unitLocked
      : Array(w.units).fill(false);
  const lockedTotal = w.unitWidths.reduce(
    (s, uw, i) => (locked[i] ? s + (parseFloat(uw) || 0) : s),
    0,
  );
  const unlockedCount = locked.filter((l) => !l).length;
  const remaining = totalIn - lockedTotal;
  const evenWidth =
    unlockedCount > 0 && remaining > 0
      ? String(Math.round((remaining / unlockedCount) * 10) / 10)
      : totalIn > 0
        ? String(Math.round((totalIn / w.units) * 10) / 10)
        : "";
  const newWidths = Array.from({ length: w.units }, (_, i) =>
    locked[i] ? w.unitWidths[i] : evenWidth,
  );
  const sized = { ...w, widthIn: value, unitWidths: newWidths };
  return { ...sized, unitWidths: relayoutGlassWidths(sized) };
}

function applyScreenDim(
  w: ScreenWallSelection,
  field: "widthIn" | "heightIn",
  value: string,
): ScreenWallSelection {
  if (field !== "widthIn") return { ...w, heightIn: value };
  const { unitWidths, unitTypes, unitLocked } = recalcScreenUnits(
    value,
    w.unitTypes,
  );
  return {
    ...w,
    widthIn: value,
    unitWidths,
    unitTypes,
    unitLocked,
    // Keep gable glass pane count in sync with unit count
    gableGlass: w.gableGlass
      ? { ...w.gableGlass, count: unitWidths.length }
      : null,
  };
}

export function useConfigureState() {
  const [state, setState] = useState<ConfigureState>(initialState);

  // ─── Step 1 ────────────────────────────────────────────────────────────────

  const setProductLine = (pl: ProductLine) =>
    setState((prev) => {
      // Remember the wall type chosen for the line we're leaving, and restore the
      // one previously chosen for the line we're switching to (if any).
      const byLine = { ...prev.wallTypeByLine };
      if (prev.selectedProductLine && prev.wallType) {
        byLine[prev.selectedProductLine.id] = prev.wallType;
      }

      return {
        ...prev,
        selectedProductLine: pl,
        wallTypeByLine: byLine,
        wallType: byLine[pl.id] ?? null,
      };
    });

  const setRoofStyle = (style: ConfigureState["roofStyle"]) => {
    setState((prev) => {
      // For roof_only: clear walls entirely (no wall config)
      if (style === "roof_only") {
        return {
          ...prev,
          roofStyle: style,
          roofOnlySubStyle: null,
          numberOfWalls: null,
          wallCombo: null,
          walls: [],
        };
      }

      // Switching away from roof_only: clear sub-style
      // Also clear gable/wing glass when switching roof styles
      const updatedWalls = prev.walls.map((w) => {
        if (w.gableGlass === null) return w;
        const isGableWall = w.id === "B";
        const isWingWall = w.id === "A" || w.id === "C";
        if (isGableWall && style !== "gable") return { ...w, gableGlass: null };
        if (isWingWall && style !== "studio") return { ...w, gableGlass: null };
        return w;
      });

      return {
        ...prev,
        roofStyle: style,
        roofOnlySubStyle: null,
        walls: updatedWalls,
      };
    });
  };

  const setRoofOnlySubStyle = (sub: "gable" | "studio") =>
    setState((prev) => ({ ...prev, roofOnlySubStyle: sub }));

  const setUnderExistingShape = (shape: "gable" | "studio") =>
    setState((prev) => ({ ...prev, underExistingShape: shape }));

  // Under-existing only: toggle whether a new gable/wing infill is added above the
  // header. Turning it OFF ("walls only") drops any gable/wing glass selection and
  // its priced add-on from every wall, so nothing gable/wing is rendered or charged.
  // Turning it back ON just flips the flag — the active builder re-initializes a
  // default gable/wing config for eligible walls. Applies to BOTH builders: glass
  // rooms use state.walls, screen rooms use state.screenRoom.walls — each has its
  // own gableGlass field, so both must be cleared or the unused one goes stale.
  const setIncludeGableWings = (value: boolean, allOptions: Option[]) =>
    setState((prev) => {
      if (value) return { ...prev, includeGableWings: true };

      const gableOptIds = [
        allOptions.find((o) => o.name.includes("Gable or Wing Glass Uninsulated")),
        allOptions.find((o) => o.name.includes("Gable or Wing Glass Comfort")),
        allOptions.find((o) => o.name.includes("Solid Wing Panel")),
      ]
        .filter((o): o is Option => !!o)
        .map((o) => o.id);

      const wallAddOns: Record<string, Record<string, string>> = {};
      Object.entries(prev.wallAddOns).forEach(([wallId, opts]) => {
        const next = { ...opts };
        gableOptIds.forEach((id) => delete next[id]);
        wallAddOns[wallId] = next;
      });

      return {
        ...prev,
        includeGableWings: false,
        walls: prev.walls.map((w) => ({ ...w, gableGlass: null })),
        screenRoom: {
          ...prev.screenRoom,
          walls: prev.screenRoom.walls.map((w) => ({ ...w, gableGlass: null })),
        },
        wallAddOns,
      };
    });

  const setRoofOnlyWidthIn = (val: string) =>
    setState((prev) => ({ ...prev, roofOnlyWidthIn: val }));

  const setRoofOnlyDepthIn = (val: string) =>
    setState((prev) => ({ ...prev, roofOnlyDepthIn: val }));

  const setRoofOnlyWallHeightIn = (val: string) =>
    setState((prev) => ({ ...prev, roofOnlyWallHeightIn: val }));

  const setNumberOfWalls = (n: 1 | 2 | 3) => {
    setState((prev) => {
      // Changing the wall count must NOT discard the user's AB/BC pick — the
      // combo only selects which pair renders. 1 wall has no combo. For 2/3 walls
      // keep whatever was already chosen; only when nothing has been chosen yet
      // fall back to the historical per-count defaults (2 → AB, 3 → BC).
      const combo: "AB" | "BC" | null =
        n === 1 ? null : (prev.wallCombo ?? (n === 2 ? "AB" : "BC"));
      const ids: Array<"A" | "B" | "C"> =
        n === 1
          ? ["B"]
          : n === 3
            ? ["A", "B", "C"]
            : combo === "BC"
              ? ["B", "C"]
              : ["A", "B"];
      return {
        ...prev,
        numberOfWalls: n,
        walls: ids.map((id) => makeWall(id)),
        screenRoom: {
          ...prev.screenRoom,
          walls: ids.map((id) => makeScreenWall(id)),
        },
        wallCombo: combo,
        projectionDistance: "",
      };
    });
  };

  // The wall combo selects which TWO walls are rendered (AB → A+B, BC → B+C).
  // - 2-wall room: the combo also defines which two walls exist, so rebuild them.
  // - 3-wall room: all three stay designed/priced; the combo only changes the
  //   rendered pair, so DON'T rebuild the walls (that would drop the third).
  const setWallCombo = (combo: "AB" | "BC") =>
    setState((prev) => {
      if (prev.numberOfWalls === 3) {
        return { ...prev, wallCombo: combo };
      }
      const walls: WallSelection[] =
        combo === "AB"
          ? [makeWall("A"), makeWall("B")]
          : [makeWall("B"), makeWall("C")];
      const screenWalls: ScreenWallSelection[] =
        combo === "AB"
          ? [makeScreenWall("A"), makeScreenWall("B")]
          : [makeScreenWall("B"), makeScreenWall("C")];
      return {
        ...prev,
        wallCombo: combo,
        walls,
        screenRoom: { ...prev.screenRoom, walls: screenWalls },
      };
    });

  const setProjectionDistance = (val: string) =>
    setState((prev) => ({ ...prev, projectionDistance: val }));

  const setMountHeight = (val: string) =>
    setState((prev) => ({ ...prev, mountHeight: val }));

  const setWallColor = (color: ConfigureState["wallColor"]) =>
    setState((prev) => ({ ...prev, wallColor: color }));

  // ─── Screen room setters ───────────────────────────────────────────────────

  // Writes BOTH builders — see applyGlassDim/applyScreenDim above.
  const setWallDimension = (
    wallId: "A" | "B" | "C",
    field: "widthIn" | "heightIn",
    value: string,
  ) =>
    setState((prev) => ({
      ...prev,
      walls: prev.walls.map((w) =>
        w.id === wallId ? applyGlassDim(w, field, value) : w,
      ),
      screenRoom: {
        ...prev.screenRoom,
        walls: prev.screenRoom.walls.map((w) =>
          w.id === wallId ? applyScreenDim(w, field, value) : w,
        ),
      },
    }));
  const setScreenWallDimension = setWallDimension;

  const setScreenUnitWidth = (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    value: string,
  ) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        walls: prev.screenRoom.walls.map((w) => {
          if (w.id !== wallId) return w;
          const newWidths = [...w.unitWidths];
          const newLocked = [
            ...(w.unitLocked.length === w.unitWidths.length
              ? w.unitLocked
              : w.unitWidths.map(() => false)),
          ];
          // Lock the adjusted unit
          newWidths[unitIndex] = value;
          newLocked[unitIndex] = true;
          // Redistribute remaining width evenly across unlocked units
          const totalWidth = parseFloat(w.widthIn) || 0;
          const lockedTotal = newWidths.reduce(
            (s, ww, i) => (newLocked[i] ? s + (parseFloat(ww) || 0) : s),
            0,
          );
          const remaining = totalWidth - lockedTotal;
          const unlockedIdxs = newLocked
            .map((l, i) => (!l ? i : -1))
            .filter((i) => i >= 0);
          if (unlockedIdxs.length > 0 && remaining > 0) {
            const even = String(
              Math.round((remaining / unlockedIdxs.length) * 10) / 10,
            );
            unlockedIdxs.forEach((i) => {
              newWidths[i] = even;
            });
          }
          return { ...w, unitWidths: newWidths, unitLocked: newLocked };
        }),
      },
    }));

  const setScreenUnitType = (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    type: ScreenUnitType,
  ) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        walls: prev.screenRoom.walls.map((w) => {
          if (w.id !== wallId) return w;
          const newTypes = [...w.unitTypes];
          newTypes[unitIndex] = type;
          // Turning a unit into (or out of) a door changes its FIXED 36in width,
          // so the other units have to re-share what's left. Hand-locked widths
          // are respected — only unlocked units absorb the difference.
          const totalIn = parseFloat(w.widthIn) || 0;
          const anyLocked = (w.unitLocked || []).some(Boolean);
          const newWidths = anyLocked
            ? w.unitWidths.map((uw, i) =>
                newTypes[i] === "door" ? String(DOOR_UNIT_IN) : uw,
              )
            : distributeUnitWidths(
                totalIn,
                newTypes.map((t) => t === "door"),
              );
          return { ...w, unitTypes: newTypes, unitWidths: newWidths };
        }),
      },
    }));

  const setScreenKneewall = (update: {
    enabled?: boolean;
    heightIn?: string;
  }) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        kneewall: { ...prev.screenRoom.kneewall, ...update },
      },
    }));

  const setScreenChairrail = (update: {
    enabled?: boolean;
    heightIn?: string;
  }) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        chairrail: {
          ...prev.screenRoom.chairrail,
          ...update,
          walls:
            update.enabled === undefined
              ? prev.screenRoom.chairrail.walls
              : update.enabled
                ? prev.screenRoom.chairrail.walls.length
                  ? prev.screenRoom.chairrail.walls
                  : prev.screenRoom.walls.map((w) => w.id)
                : [],
        },
      },
    }));

  /** Toggle a rail on ONE wall. Rails are per-wall, never per-unit. */
  const setScreenRailWall = (
    rail: "handrail" | "chairrail",
    wallId: string,
    on: boolean,
  ) =>
    setState((prev) => {
      const cur = prev.screenRoom[rail].walls;
      const walls = on
        ? cur.includes(wallId)
          ? cur
          : [...cur, wallId]
        : cur.filter((id) => id !== wallId);
      return {
        ...prev,
        screenRoom: {
          ...prev.screenRoom,
          [rail]: { ...prev.screenRoom[rail], walls },
        },
      };
    });

  const setScreenHandrail = (enabled: boolean) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        handrail: {
          enabled,
          walls: enabled
            ? prev.screenRoom.handrail.walls.length
              ? prev.screenRoom.handrail.walls
              : prev.screenRoom.walls.map((w) => w.id)
            : [],
        },
        // Handrail trumps chairrail — disable chairrail when handrail is turned on
        chairrail: enabled
          ? { ...prev.screenRoom.chairrail, enabled: false }
          : prev.screenRoom.chairrail,
      },
    }));

  // Transom is picked ONCE for the whole screen room (height included).
  const setScreenTransom = (enabled: boolean) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        transom: { ...prev.screenRoom.transom, enabled },
      },
    }));

  const setScreenTransomHeight = (value: string) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        transom: { ...prev.screenRoom.transom, heightIn: value },
      },
    }));

  // Screen-room wing/gable. Unlike the glass-room setter this one used to skip
  // wallAddOns entirely, so a SOLID wing on a screen room was configured, drawn
  // and quoted at $0 — it never reached pricing or the summary (user 2026-08-15).
  // The material is one choice for the whole room, so every wall's add-on is
  // re-synced, not just the edited one.
  const setScreenGableGlass = (
    wallId: "A" | "B" | "C",
    config: GableGlassConfig | null,
    allOptions: Option[],
  ) =>
    setState((prev) => {
      const walls = prev.screenRoom.walls.map((w) => {
        if (w.id === wallId) return { ...w, gableGlass: config };
        // The wing MATERIAL is one choice for the whole room — pick solid on
        // A and C follows. Pane count stays per-wall (it tracks that wall's
        // own unit count). Walls with no wing config are left alone, so
        // initialising one wall can never invent a wing on another.
        if (!w.gableGlass || !config) return w;
        return {
          ...w,
          gableGlass: {
            ...w.gableGlass,
            glassType: config.glassType,
            solidStyle: config.solidStyle,
          },
        };
      });

      const wallAddOns = { ...prev.wallAddOns };
      walls.forEach((w) => {
        // priceGlass=false: a screen room's non-solid wing is screen mesh, which
        // has no catalog line — only solid wing panels are charged.
        wallAddOns[w.id] = applyGableAddOn(
          w.id,
          w.gableGlass,
          wallAddOns[w.id] || {},
          allOptions,
          false,
        );
      });

      return {
        ...prev,
        screenRoom: { ...prev.screenRoom, walls },
        wallAddOns,
      };
    });

  // Structure-wide solid style, shared across every solid section of the feature.
  const setSolidStyle = (
    feature: "transom" | "kneewall" | "wing",
    style: SolidMaterial,
  ) =>
    setState((prev) => ({
      ...prev,
      solidStyles: { ...prev.solidStyles, [feature]: style },
    }));

  const setSolidPanelMaterial = (
    wallId: "A" | "B" | "C",
    material: SolidMaterial,
  ) =>
    setState((prev) => ({
      ...prev,
      walls: prev.walls.map((w) =>
        w.id === wallId ? { ...w, solidPanelMaterial: material } : w,
      ),
    }));

  const setScreenKneewallSolidStyle = (solidStyle: SolidMaterial) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        kneewall: { ...prev.screenRoom.kneewall, solidStyle },
      },
    }));

  // ─── Line items ────────────────────────────────────────────────────────────

  const toggleLineItem = (optionId: string) => {
    setState((prev) => {
      const next = { ...prev.lineItems };
      if (next[optionId] !== undefined) delete next[optionId];
      else next[optionId] = "";
      return { ...prev, lineItems: next };
    });
  };

  const setLineItemQuantity = (optionId: string, quantity: string) =>
    setState((prev) => ({
      ...prev,
      lineItems: { ...prev.lineItems, [optionId]: quantity },
    }));

  const isLineItemChecked = (optionId: string) =>
    state.lineItems[optionId] !== undefined;

  const getLineItemQuantity = (optionId: string) =>
    state.lineItems[optionId] || "";

  // ─── Wall setters ──────────────────────────────────────────────────────────

  const setWallType = (option: Option, allOptions: Option[] = []) =>
    setState((prev) => {
      // Gable/wing glass GRADE follows the base wall type, so switching the wall
      // type after configuring a gable has to re-grade it AND re-price it —
      // otherwise a G1 room keeps quoting the cheaper single-pane gable option.
      const grade = gableGlassTypeForWallType(option.name);
      const walls = prev.walls.map((w) =>
        w.gableGlass && w.gableGlass.glassType !== "solid"
          ? { ...w, gableGlass: { ...w.gableGlass, glassType: grade } }
          : w,
      );
      const wallAddOns = { ...prev.wallAddOns };
      if (allOptions.length) {
        walls.forEach((w) => {
          if (!w.gableGlass) return;
          wallAddOns[w.id] = applyGableAddOn(
            w.id,
            w.gableGlass,
            wallAddOns[w.id] || {},
            allOptions,
          );
        });
      }

      return {
        ...prev,
        wallType: option,
        walls,
        wallAddOns,
        // Remember this choice for the current product line so it's restored on
        // switching back to this line later.
        wallTypeByLine: prev.selectedProductLine
          ? { ...prev.wallTypeByLine, [prev.selectedProductLine.id]: option }
          : prev.wallTypeByLine,
        // Reset frame color when switching away from a tan/bronze wall type.
        // Default to "tan" when switching INTO a tan/bronze type so the canvas
        // immediately reflects the frame color instead of staying white.
        wallColor: /tan|bronze/i.test(option.name)
          ? (prev.wallColor ?? "tan")
          : null,
      };
    });

  // Global default transom height (inches) — applies to all units unless overridden
  const setDefaultTransomHeight = (value: string) =>
    setState((prev) => ({ ...prev, defaultTransomHeightIn: value }));

  // Global default kneewall height (inches) — applies to all units unless overridden
  const setDefaultKneewallHeight = (value: string) =>
    setState((prev) => ({ ...prev, defaultKneewallHeightIn: value }));

  // Per-unit transom height override ("" = use global default)
  const setUnitTransomHeight = (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    value: string,
  ) =>
    setState((prev) => ({
      ...prev,
      walls: prev.walls.map((w) => {
        if (w.id !== wallId) return w;
        const newHeights = [...w.unitTransomHeights];
        newHeights[unitIndex] = value;
        return { ...w, unitTransomHeights: newHeights };
      }),
    }));

  // Per-unit kneewall height override ("" = use global default)
  const setUnitKneewallHeight = (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    value: string,
  ) =>
    setState((prev) => ({
      ...prev,
      walls: prev.walls.map((w) => {
        if (w.id !== wallId) return w;
        const newHeights = [...w.unitKneewallHeights];
        newHeights[unitIndex] = value;
        return { ...w, unitKneewallHeights: newHeights };
      }),
    }));

  const setSplitTransom = (wallId: "A" | "B" | "C", value: boolean) =>
    setState((prev) => ({
      ...prev,
      walls: prev.walls.map((w) =>
        w.id === wallId ? { ...w, splitTransom: value } : w,
      ),
    }));

  const setSplitKneewall = (wallId: "A" | "B" | "C", value: boolean) =>
    setState((prev) => ({
      ...prev,
      walls: prev.walls.map((w) =>
        w.id === wallId ? { ...w, splitKneewall: value } : w,
      ),
    }));

  // Per-unit door style — also syncs storm/french door add-on quantities
  const setUnitDoorStyle = (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    style: DoorStyle,
    allOptions: Option[],
  ) =>
    setState((prev) => {
      const updatedWalls = prev.walls.map((w) => {
        if (w.id !== wallId) return w;
        const newStyles = [...w.unitDoorStyles];
        newStyles[unitIndex] = style;
        // entry/storm take the fixed 36in leaf; switching to or from one changes
        // this unit's width, so the rest of the wall re-shares what is left.
        const withStyle = { ...w, unitDoorStyles: newStyles };
        return { ...withStyle, unitWidths: relayoutGlassWidths(withStyle) };
      });

      const wallAddOns = { ...prev.wallAddOns };
      const updatedWall = updatedWalls.find((w) => w.id === wallId);
      if (updatedWall) {
        wallAddOns[wallId] = syncDoorStyleAddOns(
          updatedWall,
          { ...(wallAddOns[wallId] || {}) },
          allOptions,
        );
      }

      return { ...prev, walls: updatedWalls, wallAddOns };
    });

  // Set gable/wing glass config AND sync wallAddOns with the correct option quantity
  const setGableGlass = (
    wallId: "A" | "B" | "C",
    config: GableGlassConfig | null,
    allOptions: Option[],
  ) => {
    setState((prev) => {
      // Glass grade is not the caller's to choose — force it to whatever the
      // base wall type implies (callers pass a placeholder "uninsulated").
      const resolved: GableGlassConfig | null = config
        ? {
            ...config,
            glassType:
              config.glassType === "solid"
                ? "solid"
                : gableGlassTypeForWallType(prev.wallType?.name),
          }
        : null;

      const updatedWalls = prev.walls.map((w) =>
        w.id === wallId ? { ...w, gableGlass: resolved } : w,
      );

      const wallAddOns = { ...prev.wallAddOns };
      wallAddOns[wallId] = applyGableAddOn(
        wallId,
        resolved,
        wallAddOns[wallId] || {},
        allOptions,
      );
      return { ...prev, walls: updatedWalls, wallAddOns };
    });
  };

  const setWallUnits = (wallId: "A" | "B" | "C", units: number) =>
    setState((prev) => ({
      ...prev,
      walls: prev.walls.map((w) => {
        if (w.id !== wallId) return w;
        const clamped = Math.max(1, Math.min(12, units));
        const totalIn = parseFloat(w.widthIn) || 0;
        const evenWidth =
          totalIn > 0 ? String(Math.round((totalIn / clamped) * 10) / 10) : "";
        // Keep locked widths, redistribute remaining among unlocked
        const oldLocked =
          w.unitLocked.length === w.unitWidths.length
            ? w.unitLocked
            : Array(clamped).fill(false);
        const newWidths = Array.from({ length: clamped }, (_, i) => {
          if (i < w.unitWidths.length && oldLocked[i]) return w.unitWidths[i];
          return evenWidth;
        });
        const newLocked = Array.from({ length: clamped }, (_, i) =>
          i < oldLocked.length ? oldLocked[i] : false,
        );
        const newPanelTypes = Array.from(
          { length: clamped },
          (_, i) => w.panelTypes[i] ?? "fixed_glass",
        );
        const newMaterials = Array.from(
          { length: clamped },
          (_, i) =>
            w.unitMaterials[i] ?? {
              transom: "glass" as const,
              kneewall: "glass" as const,
            },
        );
        const newTransomHeights = Array.from(
          { length: clamped },
          (_, i) => w.unitTransomHeights[i] ?? "",
        );
        const newKneewallHeights = Array.from(
          { length: clamped },
          (_, i) => w.unitKneewallHeights[i] ?? "",
        );
        const newDoorStyles = Array.from(
          { length: clamped },
          (_, i) => w.unitDoorStyles[i] ?? "sliding",
        );
        const newGable = w.gableGlass
          ? { ...w.gableGlass, count: clamped }
          : null;
        const relaid = {
          ...w,
          units: clamped,
          unitWidths: newWidths,
          panelTypes: newPanelTypes,
          unitDoorStyles: newDoorStyles,
        };
        return {
          ...w,
          units: clamped,
          unitWidths: relayoutGlassWidths(relaid),
          unitLocked: newLocked,
          panelTypes: newPanelTypes,
          unitMaterials: newMaterials,
          unitTransomHeights: newTransomHeights,
          unitKneewallHeights: newKneewallHeights,
          unitDoorStyles: newDoorStyles,
          gableGlass: newGable,
        };
      }),
    }));

  const setWallUnitWidth = (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    value: string,
  ) =>
    setState((prev) => ({
      ...prev,
      walls: prev.walls.map((w) => {
        if (w.id !== wallId) return w;
        const newWidths = [...w.unitWidths];
        const newLocked = [
          ...(w.unitLocked.length === w.unitWidths.length
            ? w.unitLocked
            : Array(w.units).fill(false)),
        ];
        newWidths[unitIndex] = value;
        newLocked[unitIndex] = true;
        const totalIn = parseFloat(w.widthIn) || 0;
        const lockedTotal = newWidths.reduce(
          (s, uw, i) => (newLocked[i] ? s + (parseFloat(uw) || 0) : s),
          0,
        );
        const unlockedIdxs = newLocked
          .map((l, i) => (!l ? i : -1))
          .filter((i) => i >= 0);
        if (unlockedIdxs.length > 0 && totalIn - lockedTotal > 0) {
          const even = String(
            Math.round(((totalIn - lockedTotal) / unlockedIdxs.length) * 10) /
              10,
          );
          unlockedIdxs.forEach((i) => {
            newWidths[i] = even;
          });
        }
        return { ...w, unitWidths: newWidths, unitLocked: newLocked };
      }),
    }));

  const setWallPanelType = (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    panelTypeId: string,
    allOptions: Option[],
    featureOptionKeywords: Record<string, string>,
    panelTypeDefs: Array<{ id: string; addOnFeatures: string[] }>,
  ) => {
    setState((prev) => {
      const updatedWalls = prev.walls.map((w) => {
        if (w.id !== wallId) return w;
        const newPanelTypes = w.panelTypes.map((pt, i) =>
          i === unitIndex ? panelTypeId : pt,
        );
        const withType = { ...w, panelTypes: newPanelTypes };
        return { ...withType, unitWidths: relayoutGlassWidths(withType) };
      });

      const updatedWall = updatedWalls.find((w) => w.id === wallId);
      const activeFeatures = new Set<string>();
      updatedWall?.panelTypes.forEach((ptId) => {
        const def = panelTypeDefs.find((p) => p.id === ptId);
        def?.addOnFeatures.forEach((f) => activeFeatures.add(f));
      });

      const wallAddOns = { ...prev.wallAddOns };
      const wallOptions = { ...(wallAddOns[wallId] || {}) };
      const wFt = inToCeilFt(updatedWall?.widthIn || "");
      const hFt = inToCeilFt(updatedWall?.heightIn || "");
      const wallSqft = String(wFt * hFt);

      Object.entries(featureOptionKeywords).forEach(([feature, keyword]) => {
        const option = allOptions.find(
          (o) =>
            o.category === "wall_type" &&
            o.name.toLowerCase().includes(keyword.toLowerCase()),
        );
        if (!option) return;
        const isGlassFeature = feature === "transom" || feature === "kneewall";
        // Only apply the glass upcharge when a unit that has this feature is
        // actually set to glass. Gating on isGlassFeature alone re-added the
        // upcharge on every panel-type change, pricing a solid kneewall/transom
        // as glass (mirrors the anyGlass check in setUnitMaterial).
        const anyGlass =
          isGlassFeature &&
          !!updatedWall?.panelTypes.some((ptId, i) => {
            const def = PANEL_TYPE_FEATURE_MAP[ptId];
            if (!def?.includes(feature)) return false;
            return updatedWall.unitMaterials[i]?.[feature] === "glass";
          });
        const isActive = wallOptions[option.id] !== undefined;
        const shouldBeActive = activeFeatures.has(feature) && anyGlass;
        if (shouldBeActive && !isActive) wallOptions[option.id] = wallSqft;
        else if (!shouldBeActive && isActive) delete wallOptions[option.id];
      });

      // Sync storm/french door counts — panel type may have changed away from a door
      const syncedOptions = updatedWall
        ? syncDoorStyleAddOns(updatedWall, wallOptions, allOptions)
        : wallOptions;

      wallAddOns[wallId] = syncedOptions;
      return { ...prev, walls: updatedWalls, wallAddOns };
    });
  };

  const setUnitMaterial = (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    feature: "transom" | "kneewall",
    material: "glass" | "solid",
    allOptions: Option[],
  ) => {
    setState((prev) => {
      const updatedWalls = prev.walls.map((w) => {
        if (w.id !== wallId) return w;
        const newMaterials = w.unitMaterials.map((m, i) =>
          i === unitIndex ? { ...m, [feature]: material } : m,
        );
        return { ...w, unitMaterials: newMaterials };
      });

      const updatedWall = updatedWalls.find((w) => w.id === wallId);
      const wFt = inToCeilFt(updatedWall?.widthIn || "");
      const hFt = inToCeilFt(updatedWall?.heightIn || "");
      const wallSqft = String(wFt * hFt);

      const anyGlass = updatedWall?.panelTypes.some((ptId, i) => {
        const def = PANEL_TYPE_FEATURE_MAP[ptId];
        if (!def?.includes(feature)) return false;
        return updatedWall.unitMaterials[i]?.[feature] === "glass";
      });

      const keyword =
        feature === "transom" ? "Transom Glass" : "Kneewall Glass";
      const option = allOptions.find(
        (o) =>
          o.category === "wall_type" &&
          o.name.toLowerCase().includes(keyword.toLowerCase()),
      );

      const wallAddOns = { ...prev.wallAddOns };
      const wallOptions = { ...(wallAddOns[wallId] || {}) };
      if (option) {
        if (anyGlass) wallOptions[option.id] = wallSqft;
        else delete wallOptions[option.id];
      }

      wallAddOns[wallId] = wallOptions;
      return { ...prev, walls: updatedWalls, wallAddOns };
    });
  };

  const toggleWallAddOn = (wallId: string, optionId: string) => {
    setState((prev) => {
      const wallAddOns = { ...prev.wallAddOns };
      const wallOptions = { ...(wallAddOns[wallId] || {}) };
      if (wallOptions[optionId] !== undefined) delete wallOptions[optionId];
      else wallOptions[optionId] = "";
      wallAddOns[wallId] = wallOptions;
      return { ...prev, wallAddOns };
    });
  };

  const setWallAddOnQuantity = (
    wallId: string,
    optionId: string,
    quantity: string,
  ) => {
    setState((prev) => {
      const wallAddOns = { ...prev.wallAddOns };
      const wallOptions = { ...(wallAddOns[wallId] || {}) };
      wallOptions[optionId] = quantity;
      wallAddOns[wallId] = wallOptions;
      return { ...prev, wallAddOns };
    });
  };

  // ─── Roof ──────────────────────────────────────────────────────────────────

  const setRoofType = (option: Option) =>
    setState((prev) => ({ ...prev, roofType: option }));

  const setRoofColorNote = (note: string) =>
    setState((prev) => ({ ...prev, roofColorNote: note }));

  const toggleRoofAddOn = (optionId: string) => {
    setState((prev) => {
      const next = { ...prev.roofAddOns };
      if (next[optionId] !== undefined) delete next[optionId];
      else next[optionId] = "";
      return { ...prev, roofAddOns: next };
    });
  };

  const setRoofAddOnQuantity = (optionId: string, quantity: string) =>
    setState((prev) => ({
      ...prev,
      roofAddOns: { ...prev.roofAddOns, [optionId]: quantity },
    }));

  // ─── Customer ──────────────────────────────────────────────────────────────

  const setCustomerName = (name: string) =>
    setState((prev) => ({ ...prev, customerName: name }));
  const setCustomerEmail = (email: string) =>
    setState((prev) => ({ ...prev, customerEmail: email }));
  const setNotes = (notes: string) => setState((prev) => ({ ...prev, notes }));

  // ─── Pricing ───────────────────────────────────────────────────────────────

  // The roof-cost formula, as a single source of truth for the UI (Step 6's
  // live subtotal and Step 9's summary line both called their own inline copy
  // of this before). calculateTotal/buildPriceBreakdown keep their own
  // internal computation of the same formula, unchanged.
  const getRoofCost = (): number => {
    if (!state.roofType) return 0;
    if (state.roofStyle === "roof_only") {
      const w = inToCeilFt(state.roofOnlyWidthIn);
      const d = inToCeilFt(state.roofOnlyDepthIn);
      return state.roofType.unit_price * w * d;
    }
    const bWall = state.walls.find((w) => w.id === "B");
    const width = inToCeilFt(bWall?.widthIn || "");
    let depth = 0;
    if (state.numberOfWalls === 1) {
      depth = inToCeilFt(state.projectionDistance);
    } else {
      const sideWall = state.walls.find((w) => w.id === "A" || w.id === "C");
      depth = inToCeilFt(sideWall?.widthIn || "");
    }
    return state.roofType.unit_price * (width + 2) * (depth + 1);
  };

  // The walls the CURRENT room type actually uses. Screen rooms keep their own
  // wall array; everything else uses state.walls. Anything that prices or lists
  // per-wall data must go through this or screen rooms silently price nothing.
  const activeWalls = (): { id: string; widthIn: string; heightIn: string }[] =>
    state.selectedProductLine?.wall_system === "2_inch"
      ? state.screenRoom.walls
      : state.walls;

  /**
   * Underbuild wall up-charge — AUTOMATIC for under-existing 4"/6" rooms (it used
   * to be a hand-checked line in Wall → Additional Options, which meant it was
   * routinely missed). Quantity is wall AREA: the sum over every designed wall of
   * width x height in feet, each dimension rounded up the usual way (a 7'2" wall
   * counts as 8). Returns null when it doesn't apply so callers can skip the line.
   */
  const getUnderbuildCharge = (
    allOptions: Option[],
  ): { option: Option; qty: number; amount: number } | null => {
    if (state.roofStyle !== "under_existing") return null;
    const ws = state.selectedProductLine?.wall_system;
    if (ws !== "4_inch" && ws !== "6_inch") return null;
    const option = allOptions.find((o) =>
      o.name.includes("Underbuild Wall Up Charge"),
    );
    if (!option) return null;
    const qty = activeWalls().reduce(
      (s, w) => s + inToCeilFt(w.widthIn) * inToCeilFt(w.heightIn),
      0,
    );
    if (qty <= 0) return null;
    return { option, qty, amount: option.unit_price * qty };
  };

  const calculateTotal = (allOptions: Option[]): number => {
    let total = 0;
    const getOption = (id: string) => allOptions.find((o) => o.id === id);

    if (state.wallType) {
      const isScreenRoom = state.selectedProductLine?.wall_system === "2_inch";
      if (isScreenRoom) {
        // Screen room — use screenRoom.walls
        state.screenRoom.walls.forEach((wall) => {
          const wFt = inToCeilFt(wall.widthIn);
          const hFt = inToCeilFt(wall.heightIn);
          total += state.wallType!.unit_price * wFt * hFt;
        });
        // Handrail — priced by total lin ft of all walls
        if (state.screenRoom.handrail.enabled) {
          const handrailOpt = allOptions.find((o) =>
            o.name.toLowerCase().includes("screen room aluminum handrails"),
          );
          if (handrailOpt) {
            const totalLinFt = handrailLinFt(state.screenRoom);
            total += handrailOpt.unit_price * totalLinFt;
          }
        }
        // Extra doors — first is free, each additional priced
        const totalDoors = state.screenRoom.walls.reduce(
          (s, w) => s + w.unitTypes.filter((t) => t === "door").length,
          0,
        );
        if (totalDoors > 1) {
          const doorOpt = allOptions.find((o) =>
            o.name.toLowerCase().includes("additional screen door"),
          );
          if (doorOpt) total += doorOpt.unit_price * (totalDoors - 1);
        }
      } else {
        // Sunroom
        state.walls.forEach((wall) => {
          const wFt = inToCeilFt(wall.widthIn);
          const hFt = inToCeilFt(wall.heightIn);
          total += state.wallType!.unit_price * wFt * hFt;
        });
      }
    }

    if (state.roofType) {
      if (state.roofStyle === "roof_only") {
        // Inputs in inches, ceiling-rounded to feet. No overhang added.
        const w = inToCeilFt(state.roofOnlyWidthIn);
        const d = inToCeilFt(state.roofOnlyDepthIn);
        if (w > 0 && d > 0) total += state.roofType.unit_price * w * d;
      } else {
        const bWall = state.walls.find((w) => w.id === "B");
        const width = inToCeilFt(bWall?.widthIn || "");
        let depth = 0;
        if (state.numberOfWalls === 1) {
          depth = inToCeilFt(state.projectionDistance);
        } else {
          const sideWall = state.walls.find(
            (w) => w.id === "A" || w.id === "C",
          );
          depth = inToCeilFt(sideWall?.widthIn || "");
        }
        // +2 ft width overhang, +1 ft span overhang
        if (width > 0 && depth > 0)
          total += state.roofType.unit_price * (width + 2) * (depth + 1);
      }
    }

    Object.entries(state.lineItems).forEach(([optionId, qty]) => {
      const option = getOption(optionId);
      if (!option) return;
      total += option.unit_price * (parseFloat(qty) || 0);
    });

    activeWalls().forEach((wall) => {
      const wFt = inToCeilFt(wall.widthIn);
      const hFt = inToCeilFt(wall.heightIn);
      const wallSqft = wFt * hFt;
      const wallOptions = state.wallAddOns[wall.id] || {};

      Object.entries(wallOptions).forEach(([optionId, qty]) => {
        const option = getOption(optionId);
        if (!option) return;
        const isTransomOrKneewall =
          option.name.toLowerCase().includes("transom glass") ||
          option.name.toLowerCase().includes("kneewall glass");
        const quantity = isTransomOrKneewall ? wallSqft : parseFloat(qty) || 0;
        total += option.unit_price * quantity;
      });
    });

    Object.entries(state.roofAddOns).forEach(([optionId, qty]) => {
      const option = getOption(optionId);
      if (!option) return;
      total += option.unit_price * (parseFloat(qty) || 0);
    });

    const underbuild = getUnderbuildCharge(allOptions);
    if (underbuild) total += underbuild.amount;

    return total;
  };

  const buildPriceBreakdown = (
    allOptions: Option[],
  ): Array<{ name: string; amount: number; detail: string }> => {
    const items: Array<{ name: string; amount: number; detail: string }> = [];
    const getOption = (id: string) => allOptions.find((o) => o.id === id);

    if (state.wallType) {
      const isScreenRoom = state.selectedProductLine?.wall_system === "2_inch";
      if (isScreenRoom) {
        state.screenRoom.walls.forEach((wall) => {
          const wFt = inToCeilFt(wall.widthIn);
          const hFt = inToCeilFt(wall.heightIn);
          const cost = state.wallType!.unit_price * wFt * hFt;
          if (cost > 0)
            items.push({
              name: `Wall ${wall.id} — ${state.wallType!.name}`,
              amount: cost,
              detail: `${wall.widthIn}″ × ${wall.heightIn}″ → ${wFt} × ${hFt} ft (${wFt * hFt} sq ft)`,
            });
        });
        if (state.screenRoom.handrail.enabled) {
          const handrailOpt = allOptions.find((o) =>
            o.name.toLowerCase().includes("screen room aluminum handrails"),
          );
          if (handrailOpt) {
            const totalLinFt = handrailLinFt(state.screenRoom);
            const cost = handrailOpt.unit_price * totalLinFt;
            if (cost > 0)
              items.push({
                name: handrailOpt.name,
                amount: cost,
                detail: `${totalLinFt} lin ft`,
              });
          }
        }
        const totalDoors = state.screenRoom.walls.reduce(
          (s, w) => s + w.unitTypes.filter((t) => t === "door").length,
          0,
        );
        if (totalDoors > 1) {
          const doorOpt = allOptions.find((o) =>
            o.name.toLowerCase().includes("additional screen door"),
          );
          if (doorOpt) {
            const extra = totalDoors - 1;
            items.push({
              name: doorOpt.name,
              amount: doorOpt.unit_price * extra,
              detail: `${extra} additional door${extra > 1 ? "s" : ""}`,
            });
          }
        }
      } else {
        state.walls.forEach((wall) => {
          const wFt = inToCeilFt(wall.widthIn);
          const hFt = inToCeilFt(wall.heightIn);
          const cost = state.wallType!.unit_price * wFt * hFt;
          if (cost > 0)
            items.push({
              name: `Wall ${wall.id} — ${state.wallType!.name}`,
              amount: cost,
              detail: `${wall.widthIn}″ × ${wall.heightIn}″ → ${wFt} × ${hFt} ft (${wFt * hFt} sq ft)`,
            });
        });
      }
    }

    if (state.roofType) {
      if (state.roofStyle === "roof_only") {
        const w = inToCeilFt(state.roofOnlyWidthIn);
        const d = inToCeilFt(state.roofOnlyDepthIn);
        const cost = state.roofType.unit_price * w * d;
        if (cost > 0)
          items.push({
            name: `Roof — ${state.roofType.name}`,
            amount: cost,
            detail: `${state.roofOnlyWidthIn}″ × ${state.roofOnlyDepthIn}″ → ${w} × ${d} ft (${w * d} sq ft)`,
          });
      } else {
        const bWall = state.walls.find((w) => w.id === "B");
        const width = inToCeilFt(bWall?.widthIn || "");
        let depth = 0;
        if (state.numberOfWalls === 1) {
          depth = inToCeilFt(state.projectionDistance);
        } else {
          const sideWall = state.walls.find(
            (w) => w.id === "A" || w.id === "C",
          );
          depth = inToCeilFt(sideWall?.widthIn || "");
        }
        const effectiveW = width + 2;
        const effectiveD = depth + 1;
        const cost = state.roofType.unit_price * effectiveW * effectiveD;
        if (cost > 0)
          items.push({
            name: `Roof — ${state.roofType.name}`,
            amount: cost,
            detail: `(${width}+2) × (${depth}+1) ft = ${effectiveW} × ${effectiveD} ft (${effectiveW * effectiveD} sq ft incl. overhangs)`,
          });
      }
    }

    Object.entries(state.lineItems).forEach(([optionId, qty]) => {
      const option = getOption(optionId);
      if (!option) return;
      const quantity = parseFloat(qty) || 0;
      const cost = option.unit_price * quantity;
      if (cost > 0)
        items.push({
          name: option.name,
          amount: cost,
          detail: `${quantity} ${option.unit_type.replace(/_/g, " ")}`,
        });
    });

    activeWalls().forEach((wall) => {
      const wallOptions = state.wallAddOns[wall.id] || {};
      const wFt = inToCeilFt(wall.widthIn);
      const hFt = inToCeilFt(wall.heightIn);
      const wallSqft = wFt * hFt;
      Object.entries(wallOptions).forEach(([optionId, qty]) => {
        const option = getOption(optionId);
        if (!option) return;
        const isArea =
          option.name.toLowerCase().includes("transom glass") ||
          option.name.toLowerCase().includes("kneewall glass");
        const quantity = isArea ? wallSqft : parseFloat(qty) || 0;
        const cost = option.unit_price * quantity;
        if (cost > 0)
          items.push({
            name: `Wall ${wall.id} — ${option.name}`,
            amount: cost,
            detail: `${quantity} ${option.unit_type.replace(/_/g, " ")}`,
          });
      });
    });

    Object.entries(state.roofAddOns).forEach(([optionId, qty]) => {
      const option = getOption(optionId);
      if (!option) return;
      const quantity = parseFloat(qty) || 0;
      const cost = option.unit_price * quantity;
      if (cost > 0)
        items.push({
          name: option.name,
          amount: cost,
          detail: `${quantity} ${option.unit_type.replace(/_/g, " ")}`,
        });
    });

    const underbuild = getUnderbuildCharge(allOptions);
    if (underbuild)
      items.push({
        name: underbuild.option.name,
        amount: underbuild.amount,
        detail: `${underbuild.qty} sq ft (width x height of every wall, auto)`,
      });

    return items;
  };

  // ─── Validation ────────────────────────────────────────────────────────────

  const canGenerate = (): boolean => {
    if (!state.selectedProductLine) return false;
    if (!state.roofStyle) return false;

    // EVERY wall needs dimensions, not just B. Checking only B let a 3-wall room
    // generate with A/C blank (their tabs were never opened), and a blank height
    // silently zeroed that wall's gable/wing flat base — see screenGableFlatIn.
    const allDimensioned = (ws: { widthIn: string; heightIn: string }[]) =>
      ws.length > 0 && ws.every((w) => !!w.widthIn && !!w.heightIn);

    // Screen room (2_inch)
    if (state.selectedProductLine.wall_system === "2_inch") {
      if (!state.wallType) return false;
      return allDimensioned(state.screenRoom.walls);
    }

    // Roof-only: no wall config needed, just roof type
    if (state.roofStyle === "roof_only") {
      return !!state.roofType;
    }

    // Under-existing: no roof type needed, but needs walls
    if (state.roofStyle === "under_existing") {
      if (!state.wallType) return false;
      return allDimensioned(state.walls);
    }

    // Standard: needs roof type + wall type + walls
    if (!state.roofType) return false;
    if (!state.wallType) return false;
    return allDimensioned(state.walls);
  };

  // ─── Build generate params ─────────────────────────────────────────────────

  const buildGenerateParams = (
    photoUri: string,
    box_x1: string,
    box_y1: string,
    box_x2: string,
    box_y2: string,
  ) => {
    const selectedOptions: string[] = [];
    if (state.wallType) selectedOptions.push(state.wallType.id);
    if (state.roofType) selectedOptions.push(state.roofType.id);

    const wallOptionsByWall: Record<string, string[]> = {};
    Object.entries(state.wallAddOns).forEach(([wallId, options]) => {
      wallOptionsByWall[wallId] = Object.keys(options);
      Object.keys(options).forEach((optionId) =>
        selectedOptions.push(optionId),
      );
    });

    Object.keys(state.roofAddOns).forEach((id) => selectedOptions.push(id));
    const uniqueOptions = [...new Set(selectedOptions)];

    const isScreenRoom = state.selectedProductLine?.wall_system === "2_inch";

    // TWO sets of dimensions on purpose:
    //   widthIn/heightIn — EXACT entered inches. GEOMETRY (renderer + PnP camera
    //     solve) uses these. Ceiling them inflated the drawn box by up to 11" per
    //     dimension and manufactured the very "configured dims don't match the
    //     photo" mismatch the footprint auto-fit exists to correct.
    //   widthFt/heightFt — CEILED feet. Pricing rule + the human-readable prompt
    //     description ("10ft wide"); never used for geometry.
    // Also resolve per-unit heights with global defaults.
    const wallDataForBackend = state.walls.map((wall) => ({
      id: wall.id,
      widthIn: wall.widthIn,
      heightIn: wall.heightIn,
      widthFt: String(inToCeilFt(wall.widthIn)),
      heightFt: String(inToCeilFt(wall.heightIn)),
      units: wall.units,
      panelTypes: wall.panelTypes,
      // Stamp the structure-wide solid styles onto every unit so the renderer /
      // prompt (which read per-unit) get one consistent style per feature.
      unitMaterials: wall.unitMaterials.map((m) => ({
        ...m,
        transomSolidStyle: state.solidStyles.transom,
        kneewallSolidStyle: state.solidStyles.kneewall,
      })),
      unitDoorStyles: wall.unitDoorStyles,
      // Per-unit width overrides — absolute inches, normalized to sum to the exact
      // wall width so the renderer lays units out without a gap/overflow (mirrors
      // the screen-room path). Omitted before, so the 3D composite ignored every
      // width override the 2D visualizer showed.
      unitWidths: (() => {
        if (wall.unitWidths.length !== wall.units) return [];
        const target = parseFloat(wall.widthIn) || 0;
        const raw = wall.unitWidths.map((w) => parseFloat(w) || 0);
        const sum = raw.reduce((a, b) => a + b, 0);
        return sum > 0
          ? raw.map((w) => String(Math.round(((w * target) / sum) * 10) / 10))
          : [];
      })(),
      unitTransomHeights: wall.unitTransomHeights.map(
        (h) => h || state.defaultTransomHeightIn,
      ),
      unitKneewallHeights: wall.unitKneewallHeights.map(
        (h) => h || state.defaultKneewallHeightIn,
      ),
      splitTransom: wall.splitTransom,
      splitKneewall: wall.splitKneewall,
      gableGlass: wall.gableGlass
        ? { ...wall.gableGlass, solidStyle: state.solidStyles.wing }
        : null,
      // Only the wall that CARRIES the gable/wing (B on gable roofs, A/C on studio)
      // gets the pentagon flat base, and it grows DOWN to the TRANSOM LINE: the flat
      // height = the configured transom height, so the flat's base lands at the same
      // height as the transom sill on the straight walls → one continuous header
      // around the corner. Both the transom and this flat are scaled by the same PnP
      // fit factor in the renderer, so they stay locked together as it resizes.
      gableFlatIn: (() => {
        const carries =
          (wall.id === "B" && state.roofStyle === "gable") ||
          (wall.id !== "B" && state.roofStyle === "studio");
        if (!carries || !wall.gableGlass) return 0;
        // Match the transom line used on the STRAIGHT walls. The wing wall usually
        // has no transom of its own, so search the whole structure for the transom
        // actually rendered (per-unit override || global default) and take the
        // deepest one — that's the header the wing base must land on.
        const transoms = state.walls.flatMap((w) =>
          w.unitTransomHeights.map(
            (h) => parseFloat(h || state.defaultTransomHeightIn) || 0,
          ),
        );
        const transomIn = transoms.length ? Math.max(...transoms) : 0;
        return Math.round(transomIn);
      })(),
    }));

    // Screen rooms (2_inch) configure into state.screenRoom, NOT state.walls —
    // state.walls exists (setNumberOfWalls builds it) but stays dimensionless, so
    // sending it made the backend see widthFt "0" and silently substitute an
    // 18×10×8 default box of GLASS panels. Project the screen config onto the same
    // wallData shape instead, so parseConfig / getPnPDims / build_wall_description
    // all keep working and the renderer solves against the real footprint.
    // Screen doors are always 7ft — any extra wall height above that becomes an
    // automatic transom over the door, independent of the wall's manual transom
    // toggle (which only covers the non-door screen units).
    const screenTransom = state.screenRoom.transom;
    const screenWallDataForBackend = state.screenRoom.walls.map((wall) => {
      // On the gable/wing wall the transom is eaten out of the top of the wall
      // and drawn as the flat base of the gable/wing shape, so the units below
      // are shorter and carry NO transom band of their own.
      const gableFlatIn = screenGableFlatIn(wall, state.roofStyle, screenTransom);
      const bandIn = gableFlatIn > 0 || !screenTransom?.enabled
        ? 0
        : parseFloat(screenTransom.heightIn) || 0;
      const unitAreaIn = (parseFloat(wall.heightIn) || 0) - gableFlatIn;
      const doorTransomIn = Math.max(0, unitAreaIn - DOOR_MAX_IN);
      const panelTypes = wall.unitTypes.map((t) => {
        const door = t === "door";
        if (door) return doorTransomIn > 0 ? "screen_door_t" : "screen_door";
        return bandIn > 0 ? "screen_t" : "screen";
      });
      const units = panelTypes.length;

      // Unit widths are absolute inches and the renderer lays units out
      // left-to-right by their own widths, so they must sum to the wall width or
      // the last unit overhangs / leaves a gap. Target the EXACT wall width —
      // targeting the CEILED width stretched every unit to fill up to 11" of
      // width the wall doesn't actually have.
      const targetIn = parseFloat(wall.widthIn) || 0;
      const raw = wall.unitWidths.map((w) => parseFloat(w) || 0);
      const rawSum = raw.reduce((a, b) => a + b, 0);
      const unitWidths =
        rawSum > 0
          ? raw.map((w) => String(Math.round((w * targetIn) / rawSum * 10) / 10))
          : [];

      const kneewall = state.screenRoom.kneewall;
      return {
        id: wall.id,
        // Exact inches for geometry, ceiled feet for pricing/prompt — see the
        // note on wallDataForBackend above.
        widthIn: wall.widthIn,
        heightIn: wall.heightIn,
        widthFt: String(inToCeilFt(wall.widthIn)),
        heightFt: String(inToCeilFt(wall.heightIn)),
        units,
        panelTypes,
        unitWidths,
        // One transom for the whole room, fanned out per unit — except doors,
        // which always get their own auto transom above the fixed 7ft door.
        unitTransomHeights: Array.from({ length: units }, (_, i) => {
          if (wall.unitTypes[i] === "door") {
            return doorTransomIn > 0 ? String(doorTransomIn) : "";
          }
          return bandIn > 0 ? String(bandIn) : "";
        }),
        // Height of the gable/wing shape's flat base (0 = plain triangle).
        gableFlatIn,
        unitKneewallHeights: Array.from({ length: units }, () => ""),
        unitMaterials: Array.from({ length: units }, () => ({
          transom: "screen" as const,
          kneewall: "screen" as const,
        })),
        unitDoorStyles: Array.from({ length: units }, () => "screen" as const),
        splitTransom: false,
        splitKneewall: false,
        // Screen rooms store the wing solid style ON gableGlass.solidStyle (the
        // ScreenRoomBuilder solid picker writes it via onGableGlassChange), so pass
        // it through RAW. Do NOT override with state.solidStyles.wing like the glass
        // path — the screen UI never sets that, so it would clobber the user's real
        // vinyl/hardieboard pick back to "panel" (no lap courses in the composite).
        gableGlass: wall.gableGlass,
      };
    });

    // gableFlatIn has four independent ways to come out 0, and a 0 shows up in
    // the composite as a plain triangle instead of the right trapezoid — with no
    // clue which input was missing. Print the reason with the payload.
    if (isScreenRoom) {
      console.log(
        "[configure] wing flat base per wall:",
        state.screenRoom.walls
          .map((w) => {
            const flat = screenGableFlatIn(w, state.roofStyle, screenTransom);
            if (flat > 0) return `${w.id}=${flat}in`;
            const why = !screenTransom?.enabled
              ? "transom off"
              : !w.gableGlass
                ? "no wing config on this wall"
                : w.id === "B"
                  ? "wall B (gable wall — studio wings are A/C)"
                  : state.roofStyle !== "studio"
                    ? `roof is ${state.roofStyle}, not studio`
                    : "transom height blank";
            return `${w.id}=0 (${why})`;
          })
          .join("  "),
      );
    }

    // Structure-wide screen features. Kneewall / chairrail / handrail run across
    // every wall rather than per unit, so they can't ride in wallData.
    const screenOptions = {
      kneewall: state.screenRoom.kneewall,
      // chairrail/handrail carry `walls` (the ids they are on) so scene.html can
      // draw them per WALL. An older payload without it means "every wall", which
      // is how the renderer treats a missing list.
      chairrail: state.screenRoom.chairrail,
      handrail: state.screenRoom.handrail,
    };

    // For roof_only, use the sub-style for LoRA selection
    const effectiveRoofStyle =
      state.roofStyle === "roof_only" ? "roof_only" : state.roofStyle;

    return {
      photoUri,
      box_x1,
      box_y1,
      box_x2,
      box_y2,
      productLineId: state.selectedProductLine?.id,
      // wallSystem drives the backend's product-line behavior (screen vs glass,
      // LoRA). It was previously omitted, so generate.tsx always sent "" — fixed.
      wallSystem: state.selectedProductLine?.wall_system ?? "",
      selectedOptions: JSON.stringify(uniqueOptions),
      wallData: JSON.stringify(
        isScreenRoom ? screenWallDataForBackend : wallDataForBackend,
      ),
      // Empty string for non-screen lines so the backend can treat it as absent.
      screenOptions: isScreenRoom ? JSON.stringify(screenOptions) : "",
      lineItems: JSON.stringify(state.lineItems),
      wallAddOns: JSON.stringify(state.wallAddOns),
      wallOptionsByWall: JSON.stringify(wallOptionsByWall),
      roofAddOns: JSON.stringify(state.roofAddOns),
      roofStyle: effectiveRoofStyle,
      roofOnlySubStyle: state.roofOnlySubStyle,
      underExistingShape: state.underExistingShape,
      // Which two walls to render (AB → A+B, BC → B+C); all designed walls priced.
      wallCombo: state.wallCombo ?? "",
      // Stringified for the router; generate.tsx converts back to a bool.
      includeGableWings: String(state.includeGableWings),
      // Entered in INCHES; the API/renderer contract is FEET (server.js does
      // ×12). EXACT division — never ceil a geometry input.
      mountHeight: state.mountHeight
        ? String((parseFloat(state.mountHeight) || 0) / 12)
        : "",
      roofColorNote: state.roofColorNote,
      wallColor: state.wallColor,
      projectionDistance: state.projectionDistance,
      customerName: state.customerName,
      customerEmail: state.customerEmail,
      notes: state.notes,
    };
  };

  // ─── Draft support ─────────────────────────────────────────────────────────

  const serializeForDraft = (): Record<string, unknown> => {
    return JSON.parse(JSON.stringify(state));
  };

  const hydrateFromDraft = (savedState: Record<string, unknown>) => {
    try {
      const saved = savedState as Partial<ConfigureState>;
      setState((prev) => ({
        ...prev,
        ...saved,
        // Drafts saved before the transom moved to a single structure-wide
        // setting have no screenRoom.transom — keep the default rather than
        // hydrating it away as undefined.
        screenRoom: { ...prev.screenRoom, ...(saved.screenRoom ?? {}) },
        // Drafts saved before shared solid styles existed have none — keep the
        // default rather than hydrating the whole object away as undefined.
        solidStyles: { ...prev.solidStyles, ...(saved.solidStyles ?? {}) },
      }));
    } catch (e) {
      console.warn("hydrateFromDraft failed:", e);
    }
  };

  return {
    state,
    setProductLine,
    buildPriceBreakdown,
    getRoofCost,
    setRoofStyle,
    setRoofOnlySubStyle,
    setUnderExistingShape,
    setIncludeGableWings,
    setRoofOnlyWidthIn,
    setRoofOnlyDepthIn,
    setRoofOnlyWallHeightIn,
    setNumberOfWalls,
    setWallCombo,
    setProjectionDistance,
    setMountHeight,
    setWallColor,
    toggleLineItem,
    setLineItemQuantity,
    isLineItemChecked,
    getLineItemQuantity,
    setWallType,
    setWallDimension,
    setDefaultTransomHeight,
    setDefaultKneewallHeight,
    setUnitTransomHeight,
    setUnitKneewallHeight,
    setSplitTransom,
    setSplitKneewall,
    setGableGlass,
    setWallUnits,
    setWallPanelType,
    setUnitMaterial,
    setUnitDoorStyle,
    toggleWallAddOn,
    setWallAddOnQuantity,
    setRoofType,
    setRoofColorNote,
    toggleRoofAddOn,
    setRoofAddOnQuantity,
    setCustomerName,
    setCustomerEmail,
    setNotes,
    setScreenWallDimension,
    setScreenUnitWidth,
    setScreenUnitType,
    setScreenKneewall,
    setScreenChairrail,
    setScreenHandrail,
    setScreenRailWall,
    setScreenTransom,
    setScreenTransomHeight,
    setScreenGableGlass,
    setSolidPanelMaterial,
    setSolidStyle,
    setScreenKneewallSolidStyle,
    calculateTotal,
    canGenerate,
    buildGenerateParams,
    serializeForDraft,
    hydrateFromDraft,
    setWallUnitWidth,
  };
}

// ─── Exported constants ───────────────────────────────────────────────────────

export const PANEL_TYPE_FEATURE_MAP: Record<string, string[]> = {
  fixed_glass: [],
  fixed_transom: ["transom"],
  fixed_kneewall: ["kneewall"],
  fixed_tk: ["transom", "kneewall"],
  oper_kneewall: ["kneewall"],
  oper_tk: ["transom", "kneewall"],
  door: ["door_single"],
  door_t: ["door_single", "transom"],
  solid_panel: ["solid"],
};
