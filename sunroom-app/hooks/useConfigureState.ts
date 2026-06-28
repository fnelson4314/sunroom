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
  solidStyle?: SolidMaterial;
};

export type SolidMaterial = "panel" | "vinyl" | "hardieboard";

export type GableGlassConfig = {
  glassType: "uninsulated" | "g1" | "solid";
  solidStyle: SolidMaterial; // only relevant when glassType === "solid"
  count: number;
};

export type DoorStyle = "sliding" | "entry" | "storm" | "french";

// ─── Screen room types ────────────────────────────────────────────────────────

export type ScreenUnitType = "screen" | "door";

export type ScreenWallSelection = {
  id: "A" | "B" | "C";
  widthIn: string;
  heightIn: string;
  unitWidths: string[]; // auto-calculated from widthIn, individually adjustable
  unitTypes: ScreenUnitType[];
  unitLocked: boolean[]; // true = user manually set, preserved during redistribution
  transomEnabled: boolean;
  transomHeightIn: string;
  gableGlass: GableGlassConfig | null;
};

export type ScreenRoomConfig = {
  walls: ScreenWallSelection[];
  kneewall: { enabled: boolean; heightIn: string; solidStyle: SolidMaterial };
  chairrail: { enabled: boolean; heightIn: string };
  handrail: { enabled: boolean };
};

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
  roofOnlyWidthIn: string; // width in inches — ceil to ft for pricing, no overhang
  roofOnlyDepthIn: string; // depth in inches — ceil to ft for pricing, no overhang
  roofOnlyWallHeightIn: string; // wall height in inches for roof_only
  numberOfWalls: 1 | 2 | 3 | null;
  wallCombo: "AB" | "BC" | null;
  projectionDistance: string;
  mountHeight: string; // gable/studio only: total height from ground to peak (in ft)
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
    transomEnabled: false,
    transomHeightIn: "",
    gableGlass: null,
  };
}

/** Auto-divide wall width into max equal units where each unit ≤ 48". All units same width. */
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
  const count = Math.max(1, Math.ceil(w / 48));
  const evenWidth = String(Math.round((w / count) * 10) / 10);
  const unitWidths = Array.from({ length: count }, () => evenWidth);
  const unitTypes: ScreenUnitType[] = Array.from(
    { length: count },
    (_, i) => existingTypes?.[i] ?? "screen",
  );
  const unitLocked: boolean[] = Array.from({ length: count }, () => false);
  return { unitWidths, unitTypes, unitLocked };
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
  roofType: null,
  roofColorNote: "",
  roofAddOns: {},
  customerName: "",
  customerEmail: "",
  notes: "",
  screenRoom: {
    walls: [],
    kneewall: { enabled: false, heightIn: "", solidStyle: "panel" },
    chairrail: { enabled: false, heightIn: "" },
    handrail: { enabled: false },
  },
};

// ─── Hook ────────────────────────────────────────────────────────────────────

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

  const setRoofOnlyWidthIn = (val: string) =>
    setState((prev) => ({ ...prev, roofOnlyWidthIn: val }));

  const setRoofOnlyDepthIn = (val: string) =>
    setState((prev) => ({ ...prev, roofOnlyDepthIn: val }));

  const setRoofOnlyWallHeightIn = (val: string) =>
    setState((prev) => ({ ...prev, roofOnlyWallHeightIn: val }));

  const setNumberOfWalls = (n: 1 | 2 | 3) => {
    let walls: WallSelection[] = [];
    let screenWalls: ScreenWallSelection[] = [];
    if (n === 1) {
      walls = [makeWall("B")];
      screenWalls = [makeScreenWall("B")];
    } else if (n === 2) {
      walls = [makeWall("A"), makeWall("B")];
      screenWalls = [makeScreenWall("A"), makeScreenWall("B")];
    } else {
      walls = [makeWall("A"), makeWall("B"), makeWall("C")];
      screenWalls = [
        makeScreenWall("A"),
        makeScreenWall("B"),
        makeScreenWall("C"),
      ];
    }
    setState((prev) => ({
      ...prev,
      numberOfWalls: n,
      walls,
      screenRoom: { ...prev.screenRoom, walls: screenWalls },
      wallCombo: n === 2 ? "AB" : null,
      projectionDistance: "",
    }));
  };

  const setWallCombo = (combo: "AB" | "BC") => {
    const walls: WallSelection[] =
      combo === "AB"
        ? [makeWall("A"), makeWall("B")]
        : [makeWall("B"), makeWall("C")];
    const screenWalls: ScreenWallSelection[] =
      combo === "AB"
        ? [makeScreenWall("A"), makeScreenWall("B")]
        : [makeScreenWall("B"), makeScreenWall("C")];
    setState((prev) => ({
      ...prev,
      wallCombo: combo,
      walls,
      screenRoom: { ...prev.screenRoom, walls: screenWalls },
    }));
  };

  const setProjectionDistance = (val: string) =>
    setState((prev) => ({ ...prev, projectionDistance: val }));

  const setMountHeight = (val: string) =>
    setState((prev) => ({ ...prev, mountHeight: val }));

  const setWallColor = (color: ConfigureState["wallColor"]) =>
    setState((prev) => ({ ...prev, wallColor: color }));

  // ─── Screen room setters ───────────────────────────────────────────────────

  const setScreenWallDimension = (
    wallId: "A" | "B" | "C",
    field: "widthIn" | "heightIn",
    value: string,
  ) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        walls: prev.screenRoom.walls.map((w) => {
          if (w.id !== wallId) return w;
          if (field === "widthIn") {
            const { unitWidths, unitTypes, unitLocked } = recalcScreenUnits(
              value,
              w.unitTypes,
            );
            // Keep gable glass pane count in sync with unit count
            const newGable = w.gableGlass
              ? { ...w.gableGlass, count: unitWidths.length }
              : null;
            return {
              ...w,
              widthIn: value,
              unitWidths,
              unitTypes,
              unitLocked,
              gableGlass: newGable,
            };
          }
          return { ...w, heightIn: value };
        }),
      },
    }));

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
          return { ...w, unitTypes: newTypes };
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
        chairrail: { ...prev.screenRoom.chairrail, ...update },
      },
    }));

  const setScreenHandrail = (enabled: boolean) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        handrail: { enabled },
        // Handrail trumps chairrail — disable chairrail when handrail is turned on
        chairrail: enabled
          ? { ...prev.screenRoom.chairrail, enabled: false }
          : prev.screenRoom.chairrail,
      },
    }));

  const setScreenTransom = (wallId: "A" | "B" | "C", enabled: boolean) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        walls: prev.screenRoom.walls.map((w) =>
          w.id === wallId ? { ...w, transomEnabled: enabled } : w,
        ),
      },
    }));

  const setScreenTransomHeight = (wallId: "A" | "B" | "C", value: string) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        walls: prev.screenRoom.walls.map((w) =>
          w.id === wallId ? { ...w, transomHeightIn: value } : w,
        ),
      },
    }));

  const setScreenGableGlass = (
    wallId: "A" | "B" | "C",
    config: GableGlassConfig | null,
  ) =>
    setState((prev) => ({
      ...prev,
      screenRoom: {
        ...prev.screenRoom,
        walls: prev.screenRoom.walls.map((w) =>
          w.id === wallId ? { ...w, gableGlass: config } : w,
        ),
      },
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

  const setWallType = (option: Option) =>
    setState((prev) => ({
      ...prev,
      wallType: option,
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
    }));

  const setWallDimension = (
    wallId: "A" | "B" | "C",
    field: "widthIn" | "heightIn",
    value: string,
  ) => {
    setState((prev) => ({
      ...prev,
      walls: prev.walls.map((w) => {
        if (w.id !== wallId) return w;
        if (field === "widthIn") {
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
          return { ...w, widthIn: value, unitWidths: newWidths };
        }
        return { ...w, [field]: value };
      }),
    }));
  };

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
        return { ...w, unitDoorStyles: newStyles };
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
      const updatedWalls = prev.walls.map((w) =>
        w.id === wallId ? { ...w, gableGlass: config } : w,
      );

      const wallAddOns = { ...prev.wallAddOns };
      const wallOptions = { ...(wallAddOns[wallId] || {}) };

      const uninsulatedOpt = allOptions.find((o) =>
        o.name.includes("Gable or Wing Glass Uninsulated"),
      );
      const g1Opt = allOptions.find((o) =>
        o.name.includes("Gable or Wing Glass Comfort"),
      );
      const solidOpt = allOptions.find((o) =>
        o.name.includes("Solid Wing Panel"),
      );

      if (uninsulatedOpt) delete wallOptions[uninsulatedOpt.id];
      if (g1Opt) delete wallOptions[g1Opt.id];
      if (solidOpt) delete wallOptions[solidOpt.id];

      if (config) {
        const targetOpt =
          config.glassType === "uninsulated"
            ? uninsulatedOpt
            : config.glassType === "g1"
              ? g1Opt
              : solidOpt;
        if (targetOpt) {
          if (config.glassType === "solid") {
            // Solid panel: fixed price regardless of pane count.
            // B wall (gable): 2 pieces. Wing walls (A/C): 1 piece.
            wallOptions[targetOpt.id] = wallId === "B" ? "2" : "1";
          } else {
            // Glass: priced per pane
            wallOptions[targetOpt.id] = String(config.count);
          }
        }
      }

      wallAddOns[wallId] = wallOptions;
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
        return {
          ...w,
          units: clamped,
          unitWidths: newWidths,
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
        return { ...w, panelTypes: newPanelTypes };
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
        const isActive = wallOptions[option.id] !== undefined;
        const shouldBeActive = activeFeatures.has(feature) && isGlassFeature;
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
    feature: "transom" | "kneewall" | "solidStyle",
    material: "glass" | "solid" | SolidMaterial,
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
            const totalLinFt = state.screenRoom.walls.reduce(
              (s, w) => s + inToCeilFt(w.widthIn),
              0,
            );
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

    state.walls.forEach((wall) => {
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
            const totalLinFt = state.screenRoom.walls.reduce(
              (s, w) => s + inToCeilFt(w.widthIn),
              0,
            );
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

    state.walls.forEach((wall) => {
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

    return items;
  };

  // ─── Validation ────────────────────────────────────────────────────────────

  const canGenerate = (): boolean => {
    if (!state.selectedProductLine) return false;
    if (!state.roofStyle) return false;

    // Screen room (2_inch)
    if (state.selectedProductLine.wall_system === "2_inch") {
      if (!state.wallType) return false;
      if (state.screenRoom.walls.length === 0) return false;
      const wallB = state.screenRoom.walls.find((w) => w.id === "B");
      if (!wallB || !wallB.widthIn || !wallB.heightIn) return false;
      return true;
    }

    // Roof-only: no wall config needed, just roof type
    if (state.roofStyle === "roof_only") {
      return !!state.roofType;
    }

    // Under-existing: no roof type needed, but needs walls
    if (state.roofStyle === "under_existing") {
      if (!state.wallType) return false;
      if (state.walls.length === 0) return false;
      const wallB = state.walls.find((w) => w.id === "B");
      if (!wallB || !wallB.widthIn || !wallB.heightIn) return false;
      return true;
    }

    // Standard: needs roof type + wall type + walls
    if (!state.roofType) return false;
    if (!state.wallType) return false;
    if (state.walls.length === 0) return false;
    const wallB = state.walls.find((w) => w.id === "B");
    if (!wallB || !wallB.widthIn || !wallB.heightIn) return false;
    return true;
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

    // Convert wall dimensions to ft (ceiling) for backend prompt generation.
    // Also resolve per-unit heights with global defaults.
    const wallDataForBackend = state.walls.map((wall) => ({
      id: wall.id,
      widthFt: String(inToCeilFt(wall.widthIn)),
      heightFt: String(inToCeilFt(wall.heightIn)),
      units: wall.units,
      panelTypes: wall.panelTypes,
      unitMaterials: wall.unitMaterials,
      unitDoorStyles: wall.unitDoorStyles,
      unitTransomHeights: wall.unitTransomHeights.map(
        (h) => h || state.defaultTransomHeightIn,
      ),
      unitKneewallHeights: wall.unitKneewallHeights.map(
        (h) => h || state.defaultKneewallHeightIn,
      ),
      splitTransom: wall.splitTransom,
      splitKneewall: wall.splitKneewall,
      gableGlass: wall.gableGlass,
    }));

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
      wallData: JSON.stringify(wallDataForBackend),
      lineItems: JSON.stringify(state.lineItems),
      wallAddOns: JSON.stringify(state.wallAddOns),
      wallOptionsByWall: JSON.stringify(wallOptionsByWall),
      roofAddOns: JSON.stringify(state.roofAddOns),
      roofStyle: effectiveRoofStyle,
      roofOnlySubStyle: state.roofOnlySubStyle,
      mountHeight: state.mountHeight,
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
      setState((prev) => ({
        ...prev,
        ...(savedState as Partial<ConfigureState>),
      }));
    } catch (e) {
      console.warn("hydrateFromDraft failed:", e);
    }
  };

  return {
    state,
    setProductLine,
    buildPriceBreakdown,
    setRoofStyle,
    setRoofOnlySubStyle,
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
    setScreenTransom,
    setScreenTransomHeight,
    setScreenGableGlass,
    setSolidPanelMaterial,
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
