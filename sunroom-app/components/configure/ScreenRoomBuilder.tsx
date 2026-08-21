import { fitCanvasToBox } from "@/components/configure/wallCanvasMath";
import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import type {
  GableGlassConfig,
  Option,
  ScreenRoomConfig,
  ScreenUnitType,
  SolidMaterial,
} from "@/hooks/useConfigureState";
import {
  handrailLinFt,
  inToCeilFt,
  inToFtLabel,
  screenGableFlatIn,
} from "@/hooks/useConfigureState";
import React, { useEffect } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SolidFill, SolidStylePicker } from "./solids";

// ─── Visual constants ─────────────────────────────────────────────────────────

const SCREEN_COLOR = "#707070"; // dark grey mesh
const DOOR_COLOR = "#585858"; // slightly darker for door
const KNEEWALL_BG = "#e0e0e0"; // light solid panel
const SCREEN_FRAME = "#b0b0b0"; // aluminum frame
const CHAIRRAIL_COLOR = SCREEN_FRAME;

const FRAME_COLORS = {
  white: { frame: SCREEN_FRAME, swatch: "#e8e8e8", label: "White" },
  // Light cream, not the darker khaki-tan used before (user 2026-07-14) —
  // matches fcHex("tan") in scene.html, the actual composite render color.
  tan: { frame: "#e6d8b0", swatch: "#f2e9cc", label: "Tan" },
  bronze: { frame: "#3e2810", swatch: "#6b4228", label: "Bronze" },
} as const;

function getDynamicFrame(wallColor: "white" | "tan" | "bronze" | null): string {
  if (!wallColor || wallColor === "white") return SCREEN_FRAME;
  return FRAME_COLORS[wallColor].frame;
}
const HANDRAIL_BG = "#d8d8d8"; // handrail zone
const SOLID_WHITE = "#e8e8e8";
const DOOR_MAX_IN = 84; // 7 ft max door height
const CANVAS_MAX_W = 680;

// ─── Gable / wing screen shape ────────────────────────────────────────────────

const GABLE_DOOR_HEIGHT_FT = 7; // same threshold as WallBuilder

function ScreenGableShape({
  wallId,
  roofStyle,
  wallHeightFt,
  mountHeightFt,
  config,
  innerWidth,
  canvasInnerHeight,
  wallHeightIn,
  frameColor,
  paneWidth,
  dividerXPositions = [],
  kingDivIdx = -1,
  transomEnabled = false,
  transomHeightIn = "",
}: {
  wallId: "A" | "B" | "C";
  roofStyle: string | null;
  wallHeightFt: number;
  mountHeightFt: number;
  config: GableGlassConfig;
  innerWidth: number;
  canvasInnerHeight: number;
  wallHeightIn: string;
  frameColor: string;
  paneWidth: number;
  dividerXPositions?: number[];
  kingDivIdx?: number;
  transomEnabled?: boolean;
  transomHeightIn?: string;
}) {
  const pxPerFt =
    wallHeightFt > 0
      ? canvasInnerHeight / wallHeightFt
      : canvasInnerHeight / GABLE_DOOR_HEIGHT_FT;

  const riseFt =
    mountHeightFt > wallHeightFt ? mountHeightFt - wallHeightFt : 2.5;
  const triangleH = Math.round(riseFt * pxPerFt);

  // UNLIKE sunrooms (WallBuilder), extra wall height does NOT create the
  // pentagon flat base — screen units run full height (7ft+ is fine), so the
  // shape stays a pure triangle no matter how tall the wall is. The flat
  // vertical sides exist ONLY when this wall's transom is enabled: the transom
  // band lives in the gable/wing shape (sides = transom height), not as a band
  // inside the unit cells (suppressed at the cell call site).
  const transomFt = transomEnabled
    ? (parseFloat(transomHeightIn) || 0) / 12
    : 0;
  const flatSectionPx = Math.round(transomFt * pxPerFt);
  const shapeHeight = triangleH + flatSectionPx;

  // E = where the sloped sides begin as a % from the top of the shape
  const E =
    shapeHeight > 0 ? ((triangleH / shapeHeight) * 100).toFixed(1) : "0";

  let clipPath: string;
  if (wallId === "B") {
    clipPath =
      flatSectionPx === 0
        ? "polygon(50% 0%, 100% 100%, 0% 100%)"
        : `polygon(50% 0%, 100% ${E}%, 100% 100%, 0% 100%, 0% ${E}%)`;
  } else if (wallId === "A") {
    if (roofStyle === "studio") {
      clipPath =
        flatSectionPx === 0
          ? "polygon(0% 0%, 100% 100%, 0% 100%)"
          : `polygon(100% ${E}%, 100% 100%, 0% 100%, 0% 0%)`;
    } else {
      clipPath =
        flatSectionPx === 0
          ? "polygon(100% 0%, 100% 100%, 0% 100%)"
          : `polygon(100% 0%, 100% 100%, 0% 100%, 0% ${E}%)`;
    }
  } else {
    if (roofStyle === "studio") {
      clipPath =
        flatSectionPx === 0
          ? "polygon(100% 0%, 100% 100%, 0% 100%)"
          : `polygon(100% 0%, 100% 100%, 0% 100%, 0% ${E}%)`;
    } else {
      clipPath =
        flatSectionPx === 0
          ? "polygon(0% 0%, 100% 100%, 0% 100%)"
          : `polygon(100% ${E}%, 100% 100%, 0% 100%, 0% 0%)`;
    }
  }

  const isSolid = config.glassType === "solid";

  return (
    <View
      style={{
        width: innerWidth,
        height: shapeHeight,
        backgroundColor: "transparent",
      }}
    >
      <View
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: "hidden",
          },
          { clipPath } as any,
        ]}
      >
        {isSolid ? (
          <View style={{ width: innerWidth, height: shapeHeight }}>
            <SolidFill
              width={innerWidth}
              height={shapeHeight}
              material={config.solidStyle ?? "panel"}
              areaHeightIn={String(Math.round(riseFt * 12))}
              baseColor={KNEEWALL_BG}
            />
            {/* Pane dividers for solid — same positions as screen dividers */}
            {Array.from({ length: config.count - 1 }).map((_, i) => {
              const xPx =
                dividerXPositions[i] ??
                Math.round(((i + 1) / config.count) * innerWidth);
              const w = i === kingDivIdx ? Math.round(paneWidth * 1.7) : paneWidth;
              return (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    left: xPx,
                    top: 0,
                    bottom: 0,
                    width: w,
                    backgroundColor: frameColor,
                    transform: [{ translateX: -(w / 2) }],
                  }}
                />
              );
            })}
          </View>
        ) : (
          <View style={{ flex: 1, backgroundColor: SCREEN_COLOR }}>
            {Array.from({ length: config.count - 1 }).map((_, i) => {
              const xPx =
                dividerXPositions[i] ??
                Math.round(((i + 1) / config.count) * innerWidth);
              const w = i === kingDivIdx ? Math.round(paneWidth * 1.7) : paneWidth;
              return (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    left: xPx,
                    top: 0,
                    bottom: 0,
                    width: w,
                    backgroundColor: frameColor,
                    transform: [{ translateX: -(w / 2) }],
                  }}
                />
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Single unit canvas cell ──────────────────────────────────────────────────

function ScreenUnitCell({
  type,
  unitWidthPx,
  canvasHeight,
  wallHeightIn,
  kneewallEnabled,
  kneewallHeightIn,
  kneewallSolidStyle,
  chairrailEnabled,
  chairrailHeightIn,
  handrailEnabled,
  transomEnabled,
  transomHeightIn,
  frameColor,
  onPress,
}: {
  type: ScreenUnitType;
  unitWidthPx: number;
  canvasHeight: number;
  wallHeightIn: string;
  kneewallEnabled: boolean;
  kneewallHeightIn: string;
  kneewallSolidStyle: SolidMaterial;
  chairrailEnabled: boolean;
  chairrailHeightIn: string;
  handrailEnabled: boolean;
  transomEnabled: boolean;
  transomHeightIn: string;
  frameColor?: string;
  onPress: () => void;
}) {
  const wallH = parseFloat(wallHeightIn) || 96;
  const pxPerIn = canvasHeight / wallH;
  const isDoor = type === "door";
  const nonDoorTransomPx =
    transomEnabled && parseFloat(transomHeightIn) > 0
      ? Math.round(parseFloat(transomHeightIn) * pxPerIn)
      : 0;
  const resolvedFrameColor = frameColor ?? SCREEN_FRAME;

  // Doors are always DOOR_MAX_IN (7ft) — any extra wall height becomes an
  // automatic transom above the door, independent of the wall's transom toggle.
  const overDoorIn = Math.max(0, wallH - DOOR_MAX_IN);
  const doorHeightIn = wallH - overDoorIn;
  const doorHeightPx = Math.round(doorHeightIn * pxPerIn);
  const overDoorPx = Math.round(overDoorIn * pxPerIn);
  const transomPx = isDoor ? overDoorPx : nonDoorTransomPx;

  // Non-door zones
  const kneewallPx =
    !isDoor && kneewallEnabled
      ? Math.round((parseFloat(kneewallHeightIn) || 0) * pxPerIn)
      : 0;
  const handrailPx = !isDoor && handrailEnabled ? Math.round(36 * pxPerIn) : 0;
  const chairrailFromBottom =
    !isDoor && !handrailEnabled && chairrailEnabled
      ? Math.round((parseFloat(chairrailHeightIn) || 0) * pxPerIn)
      : 0;

  // Balusters inside handrail zone
  const barSpacingPx = Math.max(3, Math.round(4 * pxPerIn));
  const barCount =
    handrailEnabled && !isDoor
      ? Math.max(0, Math.floor(unitWidthPx / barSpacingPx) - 1)
      : 0;

  const screenBottom = kneewallPx + handrailPx;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{ width: unitWidthPx, height: canvasHeight, overflow: "hidden" }}
    >
      {isDoor ? (
        <>
          {/* Screen mesh above transom on door units */}
          {transomPx > 0 && (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: transomPx,
                backgroundColor: SCREEN_COLOR,
              }}
            />
          )}
          {/* Door panel — starts at transom line if transom exists, otherwise top */}
          <View
            style={{
              position: "absolute",
              top: transomPx > 0 ? transomPx : 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: DOOR_COLOR,
            }}
          >
            {/* Door frame rails + stiles use resolvedFrameColor (the wall's
                chosen white/tan/bronze), NOT the fixed SCREEN_FRAME grey — the
                door frame is the same extrusion as the wall frame, so a tan or
                bronze room left the door outlined in grey. The handle below
                keeps its own colour. */}
            {/* Top rail */}
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                backgroundColor: resolvedFrameColor,
              }}
            />
            {/* Bottom rail */}
            <View
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: 3,
                backgroundColor: resolvedFrameColor,
              }}
            />
            {/* Vertical door frame lines */}
            <View
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 3,
                backgroundColor: resolvedFrameColor,
              }}
            />
            <View
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 3,
                backgroundColor: resolvedFrameColor,
              }}
            />
            {/* Door handle — right side, vertically centered */}
            <View
              style={{
                position: "absolute",
                right: 6,
                top: Math.round(doorHeightPx * 0.42),
                width: 4,
                height: Math.max(6, Math.round(doorHeightPx * 0.14)),
                backgroundColor: "#999",
                borderRadius: 2,
              }}
            />
          </View>
        </>
      ) : (
        <>
          {/* Screen area above handrail+kneewall */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: screenBottom,
              backgroundColor: SCREEN_COLOR,
            }}
          />

          {/* Handrail zone */}
          {handrailPx > 0 && (
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: kneewallPx,
                height: handrailPx,
                backgroundColor: HANDRAIL_BG,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  backgroundColor: SCREEN_FRAME,
                }}
              />
              <View
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  backgroundColor: SCREEN_FRAME,
                }}
              />
              {Array.from({ length: barCount }).map((_, i) => (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    left: Math.round((i + 1) * barSpacingPx),
                    top: 3,
                    bottom: 3,
                    width: 2,
                    backgroundColor: SCREEN_FRAME,
                  }}
                />
              ))}
            </View>
          )}

          {/* Chairrail line */}
          {!handrailEnabled && chairrailFromBottom > 0 && (
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: Math.max(chairrailFromBottom, kneewallPx),
                height: 3,
                backgroundColor: CHAIRRAIL_COLOR,
                opacity: 0.7,
              }}
            />
          )}

          {/* Kneewall */}
          {kneewallPx > 0 && (
            <View
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: kneewallPx,
                overflow: "hidden",
              }}
            >
              <SolidFill
                width={unitWidthPx}
                height={kneewallPx}
                material={kneewallSolidStyle}
                areaHeightIn={kneewallHeightIn || "12"}
                baseColor={KNEEWALL_BG}
              />
            </View>
          )}
        </>
      )}
      {/* Transom bar — overlays both screen and door units, matches the wall's
          chosen frame color (same extrusion as the rest of the frame), not the
          fixed SCREEN_FRAME grey. */}
      {transomPx > 0 && (
        <View
          style={{
            position: "absolute",
            top: transomPx - 2,
            left: 0,
            right: 0,
            height: 4,
            backgroundColor: resolvedFrameColor,
          }}
        />
      )}
    </TouchableOpacity>
  );
}

// ─── Checkbox row ─────────────────────────────────────────────────────────────

function CheckboxRow({
  label,
  checked,
  onToggle,
  disabled,
  children,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.checkRow, disabled && { opacity: 0.35 }]}>
      <TouchableOpacity
        style={styles.checkRowTop}
        onPress={disabled ? undefined : onToggle}
        activeOpacity={disabled ? 1 : 0.7}
      >
        <View style={[styles.checkbox, checked && styles.checkboxActive]}>
          {checked && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.checkLabel}>{label}</Text>
      </TouchableOpacity>
      {checked && children && (
        <View style={styles.checkRowBody}>{children}</View>
      )}
    </View>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScreenRoomBuilderProps {
  screenRoom: ScreenRoomConfig;
  roofStyle: string | null;
  mountHeight: string;
  allOptions: Option[];
  selectedWallType: Option | null;
  activeWallId: "A" | "B" | "C";
  onActiveWallChange: (id: "A" | "B" | "C") => void;
  onWallTypeSelect: (option: Option) => void;
  onWallDimensionChange: (
    wallId: "A" | "B" | "C",
    field: "widthIn" | "heightIn",
    value: string,
  ) => void;
  onUnitWidthChange: (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    value: string,
  ) => void;
  onUnitTypeChange: (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    type: ScreenUnitType,
  ) => void;
  onKneewallChange: (update: { enabled?: boolean; heightIn?: string }) => void;
  onKneewallSolidStyle: (style: SolidMaterial) => void;
  onChairrailChange: (update: { enabled?: boolean; heightIn?: string }) => void;
  onHandrailChange: (enabled: boolean) => void;
  /** Toggle a rail on ONE wall — rails are chosen per wall, never per unit. */
  onRailWallChange: (
    rail: "handrail" | "chairrail",
    wallId: string,
    on: boolean,
  ) => void;
  onTransomChange: (enabled: boolean) => void;
  onTransomHeightChange: (value: string) => void;
  onGableGlassChange: (
    wallId: "A" | "B" | "C",
    config: GableGlassConfig | null,
  ) => void;
  wallColor: "white" | "tan" | "bronze" | null;
  onWallColorChange: (color: "white" | "tan" | "bronze") => void;
  handrailOption: Option | null;
  extraDoorOption: Option | null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ScreenRoomBuilder({
  screenRoom,
  roofStyle,
  mountHeight,
  allOptions,
  selectedWallType,
  activeWallId,
  onActiveWallChange,
  onWallTypeSelect,
  onWallDimensionChange,
  onUnitWidthChange,
  onUnitTypeChange,
  onKneewallChange,
  onKneewallSolidStyle,
  onChairrailChange,
  onHandrailChange,
  onRailWallChange,
  onTransomChange,
  onTransomHeightChange,
  onGableGlassChange,
  wallColor,
  onWallColorChange,
  handrailOption,
  extraDoorOption,
}: ScreenRoomBuilderProps) {
  const walls = screenRoom.walls;
  const activeWall = walls.find((w) => w.id === activeWallId) ?? walls[0];
  const isTanBronzeWallType = selectedWallType
    ? /tan|bronze/i.test(selectedWallType.name)
    : false;
  const dynamicFrame = getDynamicFrame(wallColor);

  const baseWallTypeOptions = allOptions.filter(
    (o) => o.category === "wall_type" && o.sort_order <= 2,
  );

  const canHaveGableScreen =
    (activeWallId === "B" && roofStyle === "gable") ||
    ((activeWallId === "A" || activeWallId === "C") && roofStyle === "studio");
  const glassLabel = activeWallId === "B" ? "Gable Screen" : "Wing Screen";

  // ONE transom for the whole room (`??` covers drafts saved before it moved off
  // the walls). On the gable/wing wall it is eaten out of the TOP of the wall and
  // drawn as the flat base of the ScreenGableShape pentagon; on every other wall
  // it stays the in-cell band.
  const transom = screenRoom.transom ?? { enabled: false, heightIn: "" };

  // Auto-init gable/wing config for EVERY eligible wall, not just the tab being
  // viewed. Keyed to activeWall this left any wall you never opened with
  // gableGlass=null, and screenGableFlatIn returns 0 without it — so on a 3-wall
  // studio the 2D showed the trapezoid on the wall you'd opened while the 3D
  // drew a plain triangle on the one you hadn't (user report 2026-07-27).
  useEffect(() => {
    // Seed from a wall that already has one so the room's material choice wins:
    // the setter propagates material across walls, so hardcoding "uninsulated"
    // here would clobber an existing "solid" pick the moment a second wall
    // initialised.
    const seed = walls.find((w) => w.gableGlass)?.gableGlass;
    for (const w of walls) {
      const eligible =
        (w.id === "B" && roofStyle === "gable") ||
        (w.id !== "B" && roofStyle === "studio");
      if (eligible && !w.gableGlass) {
        onGableGlassChange(w.id, {
          glassType: seed?.glassType ?? "uninsulated",
          solidStyle: seed?.solidStyle ?? "panel",
          count: w.unitWidths.length || 1,
        });
      }
    }
  }, [roofStyle, walls.length]);

  // Keep gable pane count in sync with unit count — only when panes are enabled
  useEffect(() => {
    if (
      activeWall?.gableGlass &&
      activeWall.gableGlass.count > 1 &&
      activeWall.unitWidths.length > 0 &&
      activeWall.gableGlass.count !== activeWall.unitWidths.length
    ) {
      onGableGlassChange(activeWall.id, {
        ...activeWall.gableGlass,
        count: activeWall.unitWidths.length,
      });
    }
  }, [activeWall?.unitWidths.length]);

  const effectiveGable: GableGlassConfig = activeWall?.gableGlass ?? {
    glassType: "uninsulated",
    solidStyle: "panel",
    count: activeWall?.unitWidths.length || 1,
  };

  // Canvas sizing — fit the wall's TRUE aspect inside a max box.
  // Previously the width was pinned at CANVAS_MAX_W and only the height flexed,
  // capped at 420px: a tall wall (84w × 102h) wanted 825px of height, got 420,
  // and rendered at 680/420 ≈ 1.6:1 instead of its real 0.82:1 — i.e. drawn
  // wider than tall when it is actually taller than wide. Scale WIDTH down when
  // the height hits the cap so the proportions stay honest either way.
  const wIn = parseFloat(activeWall?.widthIn || "0") || 0;
  const hIn = parseFloat(activeWall?.heightIn || "0") || 0;
  const wFt = wIn / 12;
  const hFt = hIn / 12;
  const aspectRatio = wFt > 0 && hFt > 0 ? wFt / hFt : 2.5;
  const CANVAS_MAX_H = 420;
  const CANVAS_MIN_W = 220; // keeps units tappable on extremely narrow walls
  const { width: canvasWidth, height: canvasHeight } = fitCanvasToBox(
    aspectRatio,
    CANVAS_MAX_W,
    CANVAS_MAX_H,
    CANVAS_MIN_W,
  );
  const canvasInner = canvasHeight - 16;

  // Gable/wing flat base: those inches come OUT of the wall canvas and are drawn
  // by ScreenGableShape above it, so the total drawn height is unchanged. The
  // units keep their scale because the canvas and the wall height they're given
  // shrink by the same amount.
  const gableFlatIn = activeWall
    ? screenGableFlatIn(activeWall, roofStyle, transom)
    : 0;
  const gableFlatPx =
    hIn > 0 ? Math.round((gableFlatIn / hIn) * canvasInner) : 0;
  const wallCanvasHeight = canvasHeight - gableFlatPx;
  const wallCanvasInner = canvasInner - gableFlatPx;
  const unitWallHeightIn = String(Math.max(1, hIn - gableFlatIn));

  // Unit pixel widths — proportional to their inch widths, accounting for dividers
  const DIVIDER_PX = 7;
  const PADDING_PX = 8;
  const unitWidths = activeWall?.unitWidths ?? [];
  const totalUnitIn =
    unitWidths.reduce((s, w) => s + (parseFloat(w) || 48), 0) || 1;
  const dividerTotal = Math.max(0, unitWidths.length - 1) * DIVIDER_PX;
  const availableForUnits = canvasWidth - 2 * PADDING_PX - dividerTotal;
  const unitPixelWidths = unitWidths.map((uw) =>
    Math.max(
      12,
      Math.round(((parseFloat(uw) || 48) / totalUnitIn) * availableForUnits),
    ),
  );

  // Compute gable divider positions aligned with canvas unit dividers
  const gableDivXPositions: number[] = [];
  {
    let cumX = PADDING_PX;
    for (let i = 0; i < unitPixelWidths.length - 1; i++) {
      cumX += unitPixelWidths[i];
      gableDivXPositions.push(Math.round(cumX + DIVIDER_PX / 2));
      cumX += DIVIDER_PX;
    }
  }

  // The frame running up to the gable peak is a beefier king post. Pick the
  // divider nearest the wall centre; only wall B has a centred gable peak.
  const kingDivIdx =
    activeWall?.id === "B" && roofStyle === "gable" && gableDivXPositions.length
      ? gableDivXPositions.reduce(
          (best, x, i) =>
            Math.abs(x - canvasWidth / 2) <
            Math.abs(gableDivXPositions[best] - canvasWidth / 2)
              ? i
              : best,
          0,
        )
      : -1;

  // Pricing
  // Mirrors handrailLinFt in useConfigureState: only the walls the rail is on,
  // and a 36in door leaf comes off each door (no handrail across a doorway).
  const totalLinFt = handrailLinFt(screenRoom);
  const totalDoors = walls.reduce(
    (s, w) => s + w.unitTypes.filter((t) => t === "door").length,
    0,
  );
  const handrailCost =
    screenRoom.handrail.enabled && handrailOption
      ? handrailOption.unit_price * totalLinFt
      : 0;
  const extraDoorCost =
    totalDoors > 1 && extraDoorOption
      ? extraDoorOption.unit_price * (totalDoors - 1)
      : 0;

  const pricingWFt = inToCeilFt(activeWall?.widthIn || "");
  const pricingHFt = inToCeilFt(activeWall?.heightIn || "");

  // Progressive disclosure gate — mirrors WallBuilder: reveal the rest of the
  // builder only once a base wall type is picked, so the screen isn't a wall of
  // controls on arrival. Don't block when there's nothing to pick, or when the
  // wall already has dimensions (e.g. a draft, or a product-line switch that
  // cleared wallType) — re-gating a configured wall would look like data loss.
  const hasDims = wIn > 0 && hIn > 0;
  const hasWallType =
    !!selectedWallType || baseWallTypeOptions.length === 0 || hasDims;

  if (!activeWall) return null;

  return (
    <View style={styles.container}>
      {/* Wall type */}
      {baseWallTypeOptions.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionLabel}>Base Wall Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8, paddingBottom: 2 }}>
                {baseWallTypeOptions.map((opt) => {
                  const sel = selectedWallType?.id === opt.id;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={[
                        styles.wallTypeChip,
                        sel && styles.wallTypeChipSel,
                      ]}
                      onPress={() => onWallTypeSelect(opt)}
                    >
                      <Text
                        style={[
                          styles.wallTypeChipText,
                          sel && styles.wallTypeChipTextSel,
                        ]}
                      >
                        {opt.name}
                      </Text>
                      <Text style={styles.wallTypeChipPrice}>
                        ${opt.unit_price}/sq ft
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {!hasWallType && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionHint}>
              Pick a wall type above to start configuring this wall.
            </Text>
          </View>
        </View>
      )}

      {hasWallType && (
        <>
          {/* Wall tabs */}
          {/* Frame color picker — only for tan/bronze wall types */}
          {isTanBronzeWallType && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>Frame Color</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {(["tan", "bronze"] as const).map((key) => {
                    const val = FRAME_COLORS[key];
                    const isSelected = (wallColor ?? "tan") === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[
                          styles.wallTypeChip,
                          isSelected && styles.wallTypeChipSel,
                          {
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                          },
                        ]}
                        onPress={() => onWallColorChange(key)}
                      >
                        <View
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            backgroundColor: val.swatch,
                            borderWidth: 2,
                            borderColor: val.frame,
                          }}
                        />
                        <Text
                          style={[
                            styles.wallTypeChipText,
                            isSelected && styles.wallTypeChipTextSel,
                          ]}
                        >
                          {val.label}
                        </Text>
                        {isSelected && (
                          <Text
                            style={{ color: Colors.primary, fontWeight: "700" }}
                          >
                            ✓
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>
          )}

          {/* Wall tabs */}
          {walls.length > 1 && (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {walls.map((w) => (
                <TouchableOpacity
                  key={w.id}
                  style={[
                    styles.tab,
                    activeWallId === w.id && styles.tabActive,
                  ]}
                  onPress={() => onActiveWallChange(w.id)}
                >
                  <Text
                    style={[
                      styles.tabText,
                      activeWallId === w.id && styles.tabTextActive,
                    ]}
                  >
                    Wall {w.id}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Active wall card */}
          <View style={styles.sectionCard}>
            {/* Dimensions */}
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionLabel}>
                Dimensions — Wall {activeWall.id}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <View style={styles.dimField}>
                  <Text style={styles.dimLabel}>Width (in)</Text>
                  <TextInput
                    style={styles.dimInput}
                    value={activeWall.widthIn}
                    onChangeText={(v) =>
                      onWallDimensionChange(activeWall.id, "widthIn", v)
                    }
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.text.tertiary}
                  />
                  {pricingWFt > 0 && (
                    <Text style={styles.dimConvert}>
                      = {inToFtLabel(activeWall.widthIn)} ft ·{" "}
                      {unitWidths.length} units
                    </Text>
                  )}
                </View>
                <View style={styles.dimField}>
                  <Text style={styles.dimLabel}>Height (in)</Text>
                  <TextInput
                    style={styles.dimInput}
                    value={activeWall.heightIn}
                    onChangeText={(v) =>
                      onWallDimensionChange(activeWall.id, "heightIn", v)
                    }
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.text.tertiary}
                  />
                  {pricingHFt > 0 && (
                    <Text style={styles.dimConvert}>
                      = {inToFtLabel(activeWall.heightIn)} ft
                    </Text>
                  )}
                </View>
                {pricingWFt > 0 && pricingHFt > 0 && (
                  <View style={styles.dimSqFt}>
                    <Text style={styles.dimSqFtText}>
                      {pricingWFt * pricingHFt}
                    </Text>
                    <Text style={styles.dimSqFtLabel}>sq ft</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Gable/wing screen inline */}
            {canHaveGableScreen && (
              <View
                style={[
                  styles.sectionBlock,
                  { borderBottomWidth: 0.5, borderBottomColor: Colors.border },
                ]}
              >
                <Text style={styles.sectionLabel}>{glassLabel}</Text>
                <Text style={styles.sectionHint}>
                  {activeWallId === "B"
                    ? "Screen or solid fill in gable peak"
                    : "Screen or solid fill at wing roofline"}
                </Text>
                <View style={{ flexDirection: "row", gap: 14 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dimLabel}>Material</Text>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      {[
                        { v: "uninsulated" as const, l: "Screen" },
                        { v: "solid" as const, l: "Solid" },
                      ].map((opt) => {
                        const active =
                          opt.v === "solid"
                            ? effectiveGable.glassType === "solid"
                            : effectiveGable.glassType !== "solid";
                        return (
                          <TouchableOpacity
                            key={opt.v}
                            style={[
                              styles.toggleBtn,
                              active && styles.toggleBtnActive,
                            ]}
                            onPress={() =>
                              onGableGlassChange(activeWall.id, {
                                ...effectiveGable,
                                glassType: opt.v,
                                solidStyle:
                                  effectiveGable.solidStyle ?? "panel",
                              })
                            }
                          >
                            <Text
                              style={[
                                styles.toggleBtnText,
                                active && styles.toggleBtnTextActive,
                              ]}
                            >
                              {opt.l}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <TouchableOpacity
                      onPress={() => {
                        const enabling = effectiveGable.count <= 1;
                        onGableGlassChange(activeWall.id, {
                          ...effectiveGable,
                          count: enabling ? unitWidths.length || 1 : 1,
                        });
                      }}
                      activeOpacity={0.75}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 9,
                        borderWidth: 1.5,
                        borderColor:
                          effectiveGable.count > 1
                            ? Colors.primary
                            : Colors.border,
                        backgroundColor:
                          effectiveGable.count > 1
                            ? "#EEF2FF"
                            : Colors.background,
                      }}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          effectiveGable.count > 1 && styles.checkboxActive,
                          { flexShrink: 0 },
                        ]}
                      >
                        {effectiveGable.count > 1 && (
                          <Text style={styles.checkmark}>✓</Text>
                        )}
                      </View>
                      <View>
                        <Text
                          style={{
                            fontSize: FontSize.body,
                            fontWeight: "600",
                            color:
                              effectiveGable.count > 1
                                ? Colors.primary
                                : Colors.text.primary,
                          }}
                        >
                          Pane dividers
                        </Text>
                        <Text
                          style={{
                            fontSize: FontSize.caption,
                            color: Colors.text.tertiary,
                            marginTop: 1,
                          }}
                        >
                          {effectiveGable.count > 1
                            ? `${effectiveGable.count} panes — matches unit count`
                            : "Tap to add dividers matching units"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
                {/* Solid material picker for gable */}
                {effectiveGable.glassType === "solid" && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.dimLabel}>Solid Material</Text>
                    <SolidStylePicker
                      value={effectiveGable.solidStyle ?? "panel"}
                      onChange={(m) =>
                        onGableGlassChange(activeWall.id, {
                          ...effectiveGable,
                          solidStyle: m,
                        })
                      }
                    />
                  </View>
                )}
              </View>
            )}

            {/* Canvas */}
            <View style={{ padding: 14, gap: 8, alignItems: "center" }}>
              <View style={{ alignItems: "center" }}>
                {/* Gable shape + canvas are flush — no gap between them */}
                <View style={{ alignItems: "center" }}>
                  {canHaveGableScreen && activeWall.gableGlass && (
                    <ScreenGableShape
                      wallId={activeWall.id}
                      roofStyle={roofStyle}
                      wallHeightFt={hFt || 8}
                      // mountHeight state is INCHES; this prop is feet
                      mountHeightFt={(parseFloat(mountHeight) || 132) / 12}
                      config={activeWall.gableGlass}
                      innerWidth={canvasWidth}
                      canvasInnerHeight={canvasInner}
                      wallHeightIn={activeWall.heightIn}
                      frameColor={dynamicFrame}
                      paneWidth={DIVIDER_PX}
                      dividerXPositions={gableDivXPositions}
                      kingDivIdx={kingDivIdx}
                      transomEnabled={gableFlatIn > 0}
                      transomHeightIn={String(gableFlatIn)}
                    />
                  )}

                  <View
                    style={{
                      width: canvasWidth,
                      height: wallCanvasHeight,
                      backgroundColor: dynamicFrame,
                      borderTopLeftRadius:
                        canHaveGableScreen && activeWall.gableGlass ? 0 : 8,
                      borderTopRightRadius:
                        canHaveGableScreen && activeWall.gableGlass ? 0 : 8,
                      borderBottomLeftRadius: 8,
                      borderBottomRightRadius: 8,
                      marginTop:
                        canHaveGableScreen && activeWall.gableGlass ? -1 : 0,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        flexDirection: "row",
                        padding: PADDING_PX,
                      }}
                    >
                      {unitWidths.length > 0 ? (
                        unitWidths.map((uw, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && (
                              <View
                                style={{
                                  width:
                                    i - 1 === kingDivIdx
                                      ? Math.round(DIVIDER_PX * 1.7)
                                      : DIVIDER_PX,
                                  height: wallCanvasInner,
                                  backgroundColor: dynamicFrame,
                                }}
                              />
                            )}
                            <ScreenUnitCell
                              type={activeWall.unitTypes[i] ?? "screen"}
                              unitWidthPx={unitPixelWidths[i] ?? 80}
                              canvasHeight={wallCanvasInner}
                              wallHeightIn={unitWallHeightIn}
                              kneewallEnabled={screenRoom.kneewall.enabled}
                              kneewallHeightIn={screenRoom.kneewall.heightIn}
                              kneewallSolidStyle={
                                screenRoom.kneewall.solidStyle ?? "panel"
                              }
                              chairrailEnabled={screenRoom.chairrail.enabled}
                              chairrailHeightIn={screenRoom.chairrail.heightIn}
                              handrailEnabled={screenRoom.handrail.enabled}
                              transomEnabled={
                                // On the gable/wing wall the transom lives in the
                                // gable shape's flat base — not as an in-cell band.
                                transom.enabled && gableFlatIn === 0
                              }
                              transomHeightIn={transom.heightIn}
                              frameColor={dynamicFrame}
                              onPress={() => {
                                const cur = activeWall.unitTypes[i] ?? "screen";
                                onUnitTypeChange(
                                  activeWall.id,
                                  i,
                                  cur === "screen" ? "door" : "screen",
                                );
                              }}
                            />
                          </React.Fragment>
                        ))
                      ) : (
                        // Empty state
                        <View
                          style={{
                            flex: 1,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text
                            style={{
                              color: SCREEN_FRAME,
                              fontSize: FontSize.small,
                            }}
                          >
                            Enter wall width to generate units
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              </View>
              {/* end gable+canvas flush wrapper */}

              {unitWidths.length > 0 && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={[
                      styles.legendSwatch,
                      { backgroundColor: SCREEN_COLOR },
                    ]}
                  />
                  <Text style={styles.legendText}>Screen</Text>
                  <View
                    style={[
                      styles.legendSwatch,
                      { backgroundColor: DOOR_COLOR, marginLeft: 8 },
                    ]}
                  />
                  <Text style={styles.legendText}>
                    Screen Door ← tap to toggle
                  </Text>
                </View>
              )}

              {/* Per-unit width adjustments */}
              {unitWidths.length > 1 && (
                <View style={{ width: "100%", gap: 4 }}>
                  <Text style={styles.dimLabel}>
                    Adjust individual unit widths (in)
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 6,
                        paddingVertical: 4,
                      }}
                    >
                      {unitWidths.map((uw, i) => (
                        <View key={i} style={{ alignItems: "center", gap: 2 }}>
                          <Text
                            style={{
                              fontSize: FontSize.tiny,
                              color: Colors.text.tertiary,
                            }}
                          >
                            U{i + 1}
                            {activeWall.unitLocked?.[i] ? " 🔒" : ""}
                          </Text>
                          <TextInput
                            style={[
                              styles.unitWidthInput,
                              activeWall.unitLocked?.[i] &&
                                styles.unitWidthInputLocked,
                            ]}
                            value={uw}
                            onChangeText={(v) =>
                              onUnitWidthChange(activeWall.id, i, v)
                            }
                            keyboardType="decimal-pad"
                          />
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}
            </View>
          </View>

          {/* Wall options */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionLabel}>Wall Options — all walls</Text>
              <Text style={styles.sectionHint}>
                Applied across every wall. Handrail overrides chairrail.
              </Text>
            </View>
            <View style={{ paddingVertical: 4 }}>
              {/* Kneewall */}
              <CheckboxRow
                label="Kneewall (solid, all walls)"
                checked={screenRoom.kneewall.enabled}
                onToggle={() =>
                  onKneewallChange({ enabled: !screenRoom.kneewall.enabled })
                }
              >
                <View style={styles.heightInputRow}>
                  <Text style={styles.dimLabel}>Height (in)</Text>
                  <TextInput
                    style={styles.heightInput}
                    value={screenRoom.kneewall.heightIn}
                    onChangeText={(v) => onKneewallChange({ heightIn: v })}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 36"
                    placeholderTextColor={Colors.text.tertiary}
                  />
                  {!!screenRoom.kneewall.heightIn && (
                    <Text style={styles.heightConvert}>
                      = {inToFtLabel(screenRoom.kneewall.heightIn)} ft
                    </Text>
                  )}
                </View>
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.dimLabel}>Kneewall Material</Text>
                  <SolidStylePicker
                    value={screenRoom.kneewall.solidStyle ?? "panel"}
                    onChange={onKneewallSolidStyle}
                  />
                </View>
              </CheckboxRow>

              {/* Chairrail — disabled when handrail is on */}
              <CheckboxRow
                label={
                  screenRoom.handrail.enabled
                    ? "Chairrail (disabled — handrail active)"
                    : "Chairrail"
                }
                checked={
                  !screenRoom.handrail.enabled && screenRoom.chairrail.enabled
                }
                disabled={screenRoom.handrail.enabled}
                onToggle={() =>
                  onChairrailChange({ enabled: !screenRoom.chairrail.enabled })
                }
              >
                <View style={styles.heightInputRow}>
                  <Text style={styles.dimLabel}>Height from floor (in)</Text>
                  <TextInput
                    style={styles.heightInput}
                    value={screenRoom.chairrail.heightIn}
                    onChangeText={(v) => onChairrailChange({ heightIn: v })}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 42"
                    placeholderTextColor={Colors.text.tertiary}
                  />
                  {!!screenRoom.chairrail.heightIn && (
                    <Text style={styles.heightConvert}>
                      = {inToFtLabel(screenRoom.chairrail.heightIn)} ft
                    </Text>
                  )}
                </View>
                <RailWallPicker
                  walls={walls}
                  selected={screenRoom.chairrail.walls}
                  onToggle={(id, on) => onRailWallChange("chairrail", id, on)}
                />
              </CheckboxRow>

              {/* Handrail */}
              <CheckboxRow
                label="Handrail (36″)"
                checked={screenRoom.handrail.enabled}
                onToggle={() => onHandrailChange(!screenRoom.handrail.enabled)}
              >
                <RailWallPicker
                  walls={walls}
                  selected={screenRoom.handrail.walls}
                  onToggle={(id, on) => onRailWallChange("handrail", id, on)}
                />
                {handrailOption && totalLinFt > 0 && (
                  <View style={styles.priceNote}>
                    <Text style={styles.priceNoteText}>
                      ${handrailOption.unit_price.toLocaleString()}/lin ft ×{" "}
                      {totalLinFt} ft = ${handrailCost.toLocaleString()}
                    </Text>
                    <Text style={styles.priceNoteText}>
                      selected walls, less 36″ per door
                    </Text>
                  </View>
                )}
              </CheckboxRow>

              {/* Transom screen — one height for the whole room */}
              <CheckboxRow
                label="Transom Screen (all walls)"
                checked={transom.enabled}
                onToggle={() => onTransomChange(!transom.enabled)}
              >
                <View style={styles.heightInputRow}>
                  <Text style={styles.dimLabel}>Height (in)</Text>
                  <TextInput
                    style={styles.heightInput}
                    value={transom.heightIn}
                    onChangeText={onTransomHeightChange}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 18"
                    placeholderTextColor={Colors.text.tertiary}
                  />
                  {!!transom.heightIn && (
                    <Text style={styles.heightConvert}>
                      = {inToFtLabel(transom.heightIn)} ft
                    </Text>
                  )}
                </View>
              </CheckboxRow>
            </View>
          </View>

          {/* Door pricing */}
          {totalDoors > 0 && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>Screen Doors</Text>
                <Text style={styles.sectionHint}>
                  1 door included ·{" "}
                  {totalDoors > 1
                    ? `${totalDoors - 1} additional`
                    : "no additional"}{" "}
                  doors
                </Text>
                {extraDoorCost > 0 && extraDoorOption && (
                  <View style={[styles.priceNote, { marginTop: 8 }]}>
                    <Text style={styles.priceNoteText}>
                      Additional doors: $
                      {extraDoorOption.unit_price.toLocaleString()} ×{" "}
                      {totalDoors - 1} = ${extraDoorCost.toLocaleString()}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Per-wall rail selector. Rails are chosen per WALL (never per unit), so a
 * chairrail or handrail can run on the front wall only, both sides, etc.
 */
function RailWallPicker({
  walls,
  selected,
  onToggle,
}: {
  walls: { id: string }[];
  selected: string[];
  onToggle: (wallId: string, on: boolean) => void;
}) {
  return (
    <View style={styles.railWallRow}>
      <Text style={styles.dimLabel}>On walls</Text>
      <View style={styles.railWallChips}>
        {walls.map((w) => {
          const on = selected.includes(w.id);
          return (
            <Pressable
              key={w.id}
              onPress={() => onToggle(w.id, !on)}
              style={[styles.railChip, on && styles.railChipOn]}
            >
              <Text style={[styles.railChipText, on && styles.railChipTextOn]}>
                Wall {w.id}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  sectionBlock: {
    padding: 14,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  sectionLabel: {
    fontSize: FontSize.small,
    fontWeight: "700",
    color: Colors.text.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionHint: { fontSize: FontSize.caption, color: Colors.text.tertiary },

  wallTypeChip: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    minWidth: 120,
    gap: 2,
  },
  wallTypeChipSel: { borderColor: Colors.primary, backgroundColor: "#EEF2FF" },
  wallTypeChipText: {
    fontSize: FontSize.small,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  wallTypeChipTextSel: { color: Colors.primary },
  wallTypeChipPrice: { fontSize: FontSize.tiny, color: Colors.text.tertiary },

  tab: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: {
    fontSize: FontSize.callout,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  tabTextActive: { color: "#fff" },

  dimField: { flex: 1, gap: 4 },
  dimLabel: {
    fontSize: FontSize.caption,
    fontWeight: "600",
    color: Colors.text.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  dimInput: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    fontSize: FontSize.label,
    fontWeight: "600",
    color: Colors.text.primary,
    textAlign: "center",
  },
  dimConvert: {
    fontSize: FontSize.tiny,
    color: Colors.text.tertiary,
    textAlign: "center",
    fontStyle: "italic",
  },
  dimSqFt: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF2FF",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 18,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  dimSqFtText: {
    fontSize: FontSize.label,
    fontWeight: "700",
    color: Colors.primary,
  },
  dimSqFtLabel: { fontSize: FontSize.tiny, color: Colors.primary },

  legendSwatch: { width: 14, height: 14, borderRadius: 3 },
  legendText: { fontSize: FontSize.caption, color: Colors.text.tertiary },

  unitWidthInput: {
    width: 52,
    textAlign: "center",
    backgroundColor: Colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 6,
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  unitWidthInputLocked: {
    borderColor: Colors.primary,
    backgroundColor: "#EEF2FF",
  },

  // Checkbox rows
  checkRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  checkRowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkRowBody: { paddingTop: 10, paddingLeft: 32 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkmark: { fontSize: FontSize.body, fontWeight: "700", color: "#fff" },
  checkLabel: {
    fontSize: FontSize.callout,
    fontWeight: "500",
    color: Colors.text.primary,
    flex: 1,
  },

  railWallRow: { marginTop: 10, gap: 6 },
  railWallChips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  railChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  railChipOn: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  railChipText: { fontSize: FontSize.body, color: Colors.text.secondary },
  railChipTextOn: { color: Colors.white, fontWeight: "600" },
  heightInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  heightInput: {
    width: 80,
    backgroundColor: Colors.background,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#d4a800",
    padding: 8,
    fontSize: FontSize.callout,
    fontWeight: "600",
    color: Colors.text.primary,
    textAlign: "center",
  },
  heightConvert: {
    fontSize: FontSize.caption,
    color: Colors.text.tertiary,
    fontStyle: "italic",
  },

  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
  },
  toggleBtnActive: { borderColor: "#e8621a", backgroundColor: "#FFF4EE" },
  toggleBtnText: {
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  toggleBtnTextActive: { color: "#e8621a" },

  unitsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  unitsBtn: {
    width: 36,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
  },
  unitsBtnText: {
    fontSize: FontSize.title,
    fontWeight: "400",
    color: Colors.text.secondary,
  },
  unitsCount: {
    flex: 1,
    textAlign: "center",
    fontSize: FontSize.label,
    fontWeight: "700",
    color: Colors.text.primary,
  },

  priceNote: {
    backgroundColor: "#EEF2FF",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  priceNoteText: {
    fontSize: FontSize.small,
    fontWeight: "600",
    color: Colors.primary,
  },
});
