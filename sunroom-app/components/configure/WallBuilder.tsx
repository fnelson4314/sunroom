import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import type {
  DoorStyle,
  GableGlassConfig,
  Option,
  SolidMaterial,
  UnitMaterials,
  WallSelection,
} from "@/hooks/useConfigureState";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export type PanelSection =
  | "glass"
  | "glass-op"
  | "transom"
  | "kneewall"
  | "door"
  | "solid";
export type PanelTypeDef = {
  id: string;
  label: string;
  sections: PanelSection[];
  addOnFeatures: string[];
};

export const PANEL_TYPES: PanelTypeDef[] = [
  {
    id: "fixed_glass",
    label: "Fixed Glass Panel",
    sections: ["glass"],
    addOnFeatures: [],
  },
  {
    id: "fixed_transom",
    label: "Fixed Glass + Transom",
    sections: ["transom", "glass"],
    addOnFeatures: ["transom"],
  },
  {
    id: "fixed_kneewall",
    label: "Fixed Glass + Kneewall",
    sections: ["glass", "kneewall"],
    addOnFeatures: ["kneewall"],
  },
  {
    id: "fixed_tk",
    label: "Fixed Glass + Transom & Kneewall",
    sections: ["transom", "glass", "kneewall"],
    addOnFeatures: ["transom", "kneewall"],
  },
  {
    id: "oper_kneewall",
    label: "Operational Window + Kneewall",
    sections: ["glass-op", "kneewall"],
    addOnFeatures: ["kneewall"],
  },
  {
    id: "oper_tk",
    label: "Operational Window + T & K",
    sections: ["transom", "glass-op", "kneewall"],
    addOnFeatures: ["transom", "kneewall"],
  },
  {
    id: "door",
    label: "Door",
    sections: ["door"],
    addOnFeatures: ["door_single"],
  },
  {
    id: "door_t",
    label: "Door + Transom",
    sections: ["transom", "door"],
    addOnFeatures: ["door_single", "transom"],
  },
];

export const FEATURE_OPTION_KEYWORDS: Record<string, string> = {
  transom: "Transom Glass",
  kneewall: "Kneewall Glass",
  solid: "Solid Wing Panel",
  door_single: "Cambridge Door Single",
  door_double: "Cambridge Double Door",
};

const VISUALLY_HANDLED_KEYWORDS = [
  "Screen Wall",
  "Convertible Screen",
  "Single Pane",
  "G1 Insulated",
  "All-Season Vinyl",
  "Solid Wing Panel",
  "Transom Glass",
  "Kneewall Glass",
  "Gable or Wing Glass",
  "Cambridge Door",
  "Storm Door",
];

const FRAME_COLOR = "#2a2a2a";
const DOOR_HEIGHT_FT = 7;
const GLASS_BLUE = "#b8d9f0";
const OPER_BLUE = "#6aaed4";
const DOOR_BLUE = "#6aaed4";
const SOLID_COLOR = "#e8dfd0";
const VINYL_LINE = "rgba(0,0,0,0.14)";
const HARDI_LINE = "rgba(0,0,0,0.18)";

function SolidFill({
  width,
  height,
  material,
  wallHeightIn,
  baseColor,
}: {
  width: number;
  height: number;
  material: SolidMaterial;
  wallHeightIn: string;
  baseColor: string;
}) {
  if (material === "panel")
    return <View style={{ width, height, backgroundColor: baseColor }} />;
  const areaH = Math.max(1, parseFloat(wallHeightIn) || 30);
  const boardIn = material === "vinyl" ? 4 : 8;
  const seamCount = Math.ceil(areaH / boardIn);
  const lineColor = material === "vinyl" ? VINYL_LINE : HARDI_LINE;
  return (
    <View
      style={{ width, height, backgroundColor: baseColor, overflow: "hidden" }}
    >
      {Array.from({ length: seamCount }).map((_, i) => {
        const seamIn = (i + 1) * boardIn;
        if (seamIn >= areaH) return null;
        const seamPx = Math.round((seamIn / areaH) * height);
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              top: seamPx,
              left: 0,
              right: 0,
              height: 1.5,
              backgroundColor: lineColor,
            }}
          />
        );
      })}
    </View>
  );
}

function SolidStylePicker({
  value,
  onChange,
}: {
  value: SolidMaterial;
  onChange: (m: SolidMaterial) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
      {[
        { v: "panel" as const, l: "Solid Panel" },
        { v: "vinyl" as const, l: 'Vinyl (4")' },
        { v: "hardieboard" as const, l: 'Hardieboard (8")' },
      ].map((opt) => (
        <TouchableOpacity
          key={opt.v}
          style={{
            flex: 1,
            paddingVertical: 7,
            borderRadius: 7,
            borderWidth: 1.5,
            borderColor: value === opt.v ? "#6b4228" : Colors.border,
            backgroundColor: value === opt.v ? "#fdf2ee" : Colors.surface,
            alignItems: "center",
          }}
          onPress={() => onChange(opt.v)}
        >
          <Text
            style={{
              fontSize: FontSize.caption,
              fontWeight: "600",
              color: value === opt.v ? "#6b4228" : Colors.text.secondary,
            }}
          >
            {opt.l}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const SECTION_BG: Record<PanelSection, string> = {
  glass: GLASS_BLUE,
  "glass-op": OPER_BLUE,
  transom: GLASS_BLUE,
  kneewall: GLASS_BLUE,
  door: DOOR_BLUE,
  solid: SOLID_COLOR,
};
const DIVIDER_WIDTH: Record<string, number> = {
  "2_inch": 4,
  "4_inch": 7,
  "6_inch": 11,
};
const DOOR_STYLES_WITH_SPLIT: DoorStyle[] = ["sliding", "french"];
const DOOR_STYLE_LABELS: Record<DoorStyle, string> = {
  sliding: "Sliding",
  entry: "Entry Door",
  storm: "Storm Door",
  french: "French Door",
};

function getGlassOptionName(n?: string): string {
  if (!n) return "Gable or Wing Glass Uninsulated Single Pane";
  const l = n.toLowerCase();
  if (
    l.includes("6") ||
    l.includes("all-season") ||
    l.includes("g1") ||
    l.includes("insulated")
  )
    return "Gable or Wing Glass Comfort G1";
  return "Gable or Wing Glass Uninsulated Single Pane";
}

const SECTION_FLEX: Record<PanelSection, number> = {
  glass: 1,
  "glass-op": 1,
  transom: 0.22,
  kneewall: 0.2,
  door: 1,
  solid: 1,
};
function getSectionFlexes(sections: PanelSection[]): number[] {
  const raw = sections.map((s) => SECTION_FLEX[s]);
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / sum);
}
function ceilFt(inches: string): number {
  const n = parseFloat(inches);
  if (!n || n <= 0) return 0;
  return Math.ceil(n / 12);
}

function GableGlassShape({
  wallId,
  roofStyle,
  wallHeightFt,
  mountHeightFt,
  transomHeightIn,
  wallHasTransom,
  config,
  innerWidth,
  frameWidth,
  frameColor,
  canvasInnerHeight,
  dividerXPositions,
}: {
  wallId: "A" | "B" | "C";
  roofStyle: string | null;
  wallHeightFt: string;
  mountHeightFt: string;
  transomHeightIn: string;
  wallHasTransom: boolean;
  config: GableGlassConfig;
  innerWidth: number;
  frameWidth: number;
  frameColor: string;
  canvasInnerHeight: number;
  dividerXPositions?: number[];
}) {
  const wallH = parseFloat(wallHeightFt) || 0;
  const mountH = parseFloat(mountHeightFt) || 0;
  const transomH = (parseFloat(transomHeightIn) || 0) / 12;
  const excessFt = Math.max(0, wallH - DOOR_HEIGHT_FT);
  const transomAbsorbs = wallHasTransom && transomH > 0 && excessFt > 0;
  const effectiveExcess = transomAbsorbs ? 0 : excessFt;
  const pxPerFt =
    wallH > 0 ? canvasInnerHeight / wallH : canvasInnerHeight / DOOR_HEIGHT_FT;
  const riseFromMount = mountH > wallH ? mountH - wallH : 0;
  const riseFt = riseFromMount > 0 ? riseFromMount : 2.5;
  const triangleHeightPx = Math.round(riseFt * pxPerFt);
  const flatSectionPx = Math.round(effectiveExcess * pxPerFt);
  const shapeHeight = triangleHeightPx + flatSectionPx;
  const E =
    shapeHeight > 0 ? ((triangleHeightPx / shapeHeight) * 100).toFixed(1) : "0";

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
  const glassColor = isSolid ? SOLID_COLOR : GLASS_BLUE;

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
        {/* Background — must come BEFORE dividers so dividers render on top */}
        {isSolid ? (
          <SolidFill
            width={innerWidth}
            height={shapeHeight}
            material={config.solidStyle ?? "panel"}
            wallHeightIn={String(Math.round(riseFt * 12))}
            baseColor={SOLID_COLOR}
          />
        ) : (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: glassColor,
            }}
          />
        )}
        {/* Dividers on top of background */}
        {Array.from({ length: config.count - 1 }).map((_, i) => {
          const xPx =
            dividerXPositions?.[i] ??
            Math.round(((i + 1) / config.count) * innerWidth);
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left: xPx,
                top: 0,
                bottom: 0,
                width: frameWidth,
                backgroundColor: frameColor,
                transform: [{ translateX: -frameWidth / 2 }],
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

function PanelUnit({
  panelTypeId,
  materials,
  isSelected,
  splitTransom,
  splitKneewall,
  doorStyle,
  frameWidth,
  frameColor,
  wallHeightFt,
  transomHeightIn,
  kneewallHeightIn,
  canvasInnerHeight,
  unitWidthPx,
  solidPanelMaterial = "panel",
  onPress,
}: {
  panelTypeId: string;
  materials: UnitMaterials;
  isSelected: boolean;
  splitTransom: boolean;
  splitKneewall: boolean;
  doorStyle: DoorStyle;
  frameWidth: number;
  frameColor: string;
  wallHeightFt: string;
  transomHeightIn: string;
  kneewallHeightIn: string;
  canvasInnerHeight: number;
  unitWidthPx?: number;
  solidPanelMaterial?: SolidMaterial;
  onPress: () => void;
}) {
  const def = PANEL_TYPES.find((p) => p.id === panelTypeId) ?? PANEL_TYPES[0];
  const unitHasTransom = def.sections.includes("transom");
  const unitHasKneewall = def.sections.includes("kneewall");
  const isOperational = panelTypeId.startsWith("oper");
  const isDoor = panelTypeId === "door" || panelTypeId === "door_t";
  const wallH = parseFloat(wallHeightFt) || 0;
  const transomH = (parseFloat(transomHeightIn) || 0) / 12;
  const kneewallH = (parseFloat(kneewallHeightIn) || 0) / 12;
  const transomPx =
    wallH > 0 && transomH > 0
      ? Math.round(canvasInnerHeight * (transomH / wallH))
      : Math.round(canvasInnerHeight * SECTION_FLEX.transom);
  const kneewallPx =
    wallH > 0 && kneewallH > 0
      ? Math.round(canvasInnerHeight * (kneewallH / wallH))
      : Math.round(canvasInnerHeight * SECTION_FLEX.kneewall);
  const DIVIDER_H = 5;
  const glassPx =
    canvasInnerHeight -
    (unitHasTransom ? transomPx + DIVIDER_H : 0) -
    (unitHasKneewall ? kneewallPx + DIVIDER_H : 0);
  const glassSec: PanelSection = def.sections.includes("glass-op")
    ? "glass-op"
    : def.sections.includes("door")
      ? "door"
      : "glass";
  const glassBg = SECTION_BG[glassSec];
  const showGlassDivider =
    isOperational || (isDoor && DOOR_STYLES_WITH_SPLIT.includes(doorStyle));
  const transomBg = materials.transom === "solid" ? SOLID_COLOR : GLASS_BLUE;
  const kneewallBg = materials.kneewall === "solid" ? SOLID_COLOR : GLASS_BLUE;

  return (
    <TouchableOpacity
      style={[
        styles.unit,
        isSelected && styles.unitSelected,
        unitWidthPx !== undefined
          ? { flex: undefined, width: unitWidthPx }
          : {},
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {unitHasTransom && (
        <>
          {splitTransom ? (
            <View
              style={[
                styles.sectionSplit,
                { height: transomPx, flexShrink: 0 },
              ]}
            >
              {materials.transom === "solid" ? (
                <SolidFill
                  width={(unitWidthPx ?? 80) / 2}
                  height={transomPx}
                  material={solidPanelMaterial}
                  wallHeightIn={transomHeightIn || "18"}
                  baseColor={SOLID_COLOR}
                />
              ) : (
                <View
                  style={[styles.sectionHalf, { backgroundColor: transomBg }]}
                />
              )}
              <View
                style={{ width: frameWidth, backgroundColor: frameColor }}
              />
              {materials.transom === "solid" ? (
                <SolidFill
                  width={(unitWidthPx ?? 80) / 2}
                  height={transomPx}
                  material={solidPanelMaterial}
                  wallHeightIn={transomHeightIn || "18"}
                  baseColor={SOLID_COLOR}
                />
              ) : (
                <View
                  style={[styles.sectionHalf, { backgroundColor: transomBg }]}
                />
              )}
            </View>
          ) : materials.transom === "solid" ? (
            <SolidFill
              width={unitWidthPx ?? 80}
              height={transomPx}
              material={solidPanelMaterial}
              wallHeightIn={transomHeightIn || "18"}
              baseColor={SOLID_COLOR}
            />
          ) : (
            <View
              style={{
                height: transomPx,
                flexShrink: 0,
                backgroundColor: transomBg,
              }}
            />
          )}
          <View
            style={[styles.sectionDivider, { backgroundColor: frameColor }]}
          />
        </>
      )}
      {showGlassDivider ? (
        <View style={[styles.sectionSplit, { height: glassPx, flexShrink: 0 }]}>
          <View style={[styles.sectionHalf, { backgroundColor: glassBg }]} />
          <View style={{ width: frameWidth, backgroundColor: frameColor }} />
          <View style={[styles.sectionHalf, { backgroundColor: glassBg }]} />
        </View>
      ) : (
        <View
          style={{ height: glassPx, flexShrink: 0, backgroundColor: glassBg }}
        />
      )}
      {unitHasKneewall && (
        <>
          <View
            style={[styles.sectionDivider, { backgroundColor: frameColor }]}
          />
          {splitKneewall ? (
            <View
              style={[
                styles.sectionSplit,
                { height: kneewallPx, flexShrink: 0 },
              ]}
            >
              {materials.kneewall === "solid" ? (
                <SolidFill
                  width={(unitWidthPx ?? 80) / 2}
                  height={kneewallPx}
                  material={solidPanelMaterial}
                  wallHeightIn={kneewallHeightIn || "24"}
                  baseColor={SOLID_COLOR}
                />
              ) : (
                <View
                  style={[styles.sectionHalf, { backgroundColor: kneewallBg }]}
                />
              )}
              <View
                style={{ width: frameWidth, backgroundColor: frameColor }}
              />
              {materials.kneewall === "solid" ? (
                <SolidFill
                  width={(unitWidthPx ?? 80) / 2}
                  height={kneewallPx}
                  material={solidPanelMaterial}
                  wallHeightIn={kneewallHeightIn || "24"}
                  baseColor={SOLID_COLOR}
                />
              ) : (
                <View
                  style={[styles.sectionHalf, { backgroundColor: kneewallBg }]}
                />
              )}
            </View>
          ) : materials.kneewall === "solid" ? (
            <SolidFill
              width={unitWidthPx ?? 80}
              height={kneewallPx}
              material={solidPanelMaterial}
              wallHeightIn={kneewallHeightIn || "24"}
              baseColor={SOLID_COLOR}
            />
          ) : (
            <View
              style={{
                height: kneewallPx,
                flexShrink: 0,
                backgroundColor: kneewallBg,
              }}
            />
          )}
        </>
      )}
    </TouchableOpacity>
  );
}

function HeightOverrideBlock({
  hasTransom,
  hasKneewall,
  defaultTransomHeightIn,
  defaultKneewallHeightIn,
  currentUnitTransomHeight,
  currentUnitKneewallHeight,
  onUnitTransomHeightChange,
  onUnitKneewallHeightChange,
}: {
  hasTransom: boolean;
  hasKneewall: boolean;
  defaultTransomHeightIn: string;
  defaultKneewallHeightIn: string;
  currentUnitTransomHeight: string;
  currentUnitKneewallHeight: string;
  onUnitTransomHeightChange: (v: string) => void;
  onUnitKneewallHeightChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasOverride = !!currentUnitTransomHeight || !!currentUnitKneewallHeight;
  return (
    <View style={styles.heightOverrideBlock}>
      <TouchableOpacity
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.7}
      >
        <View
          style={[
            styles.addOnCheck,
            (open || hasOverride) && styles.addOnCheckActive,
          ]}
        >
          {(open || hasOverride) && (
            <Text style={styles.addOnCheckMark}>✓</Text>
          )}
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={styles.materialsTitle}>
            Override heights for this unit
          </Text>
          <Text style={styles.materialsSub}>
            {hasOverride
              ? `Custom heights set — tap to ${open ? "collapse" : "edit"}`
              : `Defaults — transom: ${defaultTransomHeightIn || "not set"}, kneewall: ${defaultKneewallHeightIn || "not set"}`}
          </Text>
        </View>
      </TouchableOpacity>
      {open && (
        <View style={[styles.materialsRow, { marginTop: 10 }]}>
          {hasTransom && (
            <View style={styles.materialToggle}>
              <Text style={styles.materialToggleLabel}>Transom (in)</Text>
              <Text style={styles.overrideHint}>
                Default: {defaultTransomHeightIn || "not set"}
              </Text>
              <TextInput
                style={styles.overrideInput}
                value={currentUnitTransomHeight}
                onChangeText={onUnitTransomHeightChange}
                keyboardType="decimal-pad"
                placeholder={defaultTransomHeightIn || "e.g. 18"}
                placeholderTextColor={Colors.text.tertiary}
              />
            </View>
          )}
          {hasKneewall && (
            <View style={styles.materialToggle}>
              <Text style={styles.materialToggleLabel}>Kneewall (in)</Text>
              <Text style={styles.overrideHint}>
                Default: {defaultKneewallHeightIn || "not set"}
              </Text>
              <TextInput
                style={styles.overrideInput}
                value={currentUnitKneewallHeight}
                onChangeText={onUnitKneewallHeightChange}
                keyboardType="decimal-pad"
                placeholder={defaultKneewallHeightIn || "e.g. 24"}
                placeholderTextColor={Colors.text.tertiary}
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function PanelPickerModal({
  visible,
  wallId,
  unitIndex,
  unitCount,
  currentPanelTypeId,
  currentMaterials,
  currentDoorStyle,
  currentUnitTransomHeight,
  currentUnitKneewallHeight,
  defaultTransomHeightIn,
  defaultKneewallHeightIn,
  frameWidth,
  wallSystem,
  onSelectType,
  onMaterialChange,
  onSolidStyleChange,
  onDoorStyleChange,
  onUnitTransomHeightChange,
  onUnitKneewallHeightChange,
  onClose,
}: {
  visible: boolean;
  wallId: string;
  unitIndex: number;
  unitCount: number;
  currentPanelTypeId: string;
  currentMaterials: UnitMaterials;
  currentDoorStyle: DoorStyle;
  currentUnitTransomHeight: string;
  currentUnitKneewallHeight: string;
  defaultTransomHeightIn: string;
  defaultKneewallHeightIn: string;
  frameWidth: number;
  wallSystem: "2_inch" | "4_inch" | "6_inch" | null;
  onSelectType: (id: string) => void;
  onMaterialChange: (f: "transom" | "kneewall", m: "glass" | "solid") => void;
  onSolidStyleChange: (m: SolidMaterial) => void;
  onDoorStyleChange: (s: DoorStyle) => void;
  onUnitTransomHeightChange: (v: string) => void;
  onUnitKneewallHeightChange: (v: string) => void;
  onClose: () => void;
}) {
  const currentDef =
    PANEL_TYPES.find((p) => p.id === currentPanelTypeId) ?? PANEL_TYPES[0];
  const hasTransom = currentDef.sections.includes("transom");
  const hasKneewall = currentDef.sections.includes("kneewall");
  const isDoorType =
    currentPanelTypeId === "door" || currentPanelTypeId === "door_t";
  const availableDoorStyles: DoorStyle[] =
    wallSystem === "6_inch"
      ? ["sliding", "entry", "storm", "french"]
      : ["sliding", "entry", "storm"];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.sheetTitle}>
              Wall {wallId} — Unit {unitIndex + 1} of {unitCount}
            </Text>
            <Text style={styles.sheetSub}>Select panel type and materials</Text>
          </View>
          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          contentContainerStyle={styles.sheetBody}
          showsVerticalScrollIndicator={false}
        >
          {(hasTransom || hasKneewall) && (
            <View style={styles.materialsBlock}>
              <Text style={styles.materialsTitle}>Section Materials</Text>
              <Text style={styles.materialsSub}>
                Glass adds cost at full wall sq ft
              </Text>
              <View style={styles.materialsRow}>
                {hasTransom && (
                  <View style={styles.materialToggle}>
                    <Text style={styles.materialToggleLabel}>Transom</Text>
                    <View style={styles.toggleRow}>
                      {(["glass", "solid"] as const).map((mat) => (
                        <TouchableOpacity
                          key={mat}
                          style={[
                            styles.toggleBtn,
                            currentMaterials.transom === mat &&
                              styles.toggleBtnActive,
                          ]}
                          onPress={() => onMaterialChange("transom", mat)}
                        >
                          <Text
                            style={[
                              styles.toggleBtnText,
                              currentMaterials.transom === mat &&
                                styles.toggleBtnTextActive,
                            ]}
                          >
                            {mat.charAt(0).toUpperCase() + mat.slice(1)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
                {hasKneewall && (
                  <View style={styles.materialToggle}>
                    <Text style={styles.materialToggleLabel}>Kneewall</Text>
                    <View style={styles.toggleRow}>
                      {(["glass", "solid"] as const).map((mat) => (
                        <TouchableOpacity
                          key={mat}
                          style={[
                            styles.toggleBtn,
                            currentMaterials.kneewall === mat &&
                              styles.toggleBtnActive,
                          ]}
                          onPress={() => onMaterialChange("kneewall", mat)}
                        >
                          <Text
                            style={[
                              styles.toggleBtnText,
                              currentMaterials.kneewall === mat &&
                                styles.toggleBtnTextActive,
                            ]}
                          >
                            {mat.charAt(0).toUpperCase() + mat.slice(1)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}
          {(hasTransom || hasKneewall) &&
            (currentMaterials.transom === "solid" ||
              currentMaterials.kneewall === "solid") && (
              <View style={styles.heightOverrideBlock}>
                <Text style={styles.materialsTitle}>Solid Material</Text>
                <Text style={styles.materialsSub}>
                  Panel / vinyl / hardieboard — applied to all solid sections
                </Text>
                <SolidStylePicker
                  value={(currentMaterials as any).solidStyle ?? "panel"}
                  onChange={onSolidStyleChange}
                />
              </View>
            )}
          {(hasTransom || hasKneewall) && (
            <HeightOverrideBlock
              hasTransom={hasTransom}
              hasKneewall={hasKneewall}
              defaultTransomHeightIn={defaultTransomHeightIn}
              defaultKneewallHeightIn={defaultKneewallHeightIn}
              currentUnitTransomHeight={currentUnitTransomHeight}
              currentUnitKneewallHeight={currentUnitKneewallHeight}
              onUnitTransomHeightChange={onUnitTransomHeightChange}
              onUnitKneewallHeightChange={onUnitKneewallHeightChange}
            />
          )}
          {isDoorType && (
            <View style={styles.doorStyleBlock}>
              <Text style={styles.materialsTitle}>Door Style</Text>
              <Text style={styles.materialsSub}>
                Sliding and French doors have a center split
              </Text>
              <View style={styles.doorStyleRow}>
                {availableDoorStyles.map((style) => (
                  <TouchableOpacity
                    key={style}
                    style={[
                      styles.doorStyleBtn,
                      currentDoorStyle === style && styles.doorStyleBtnActive,
                    ]}
                    onPress={() => onDoorStyleChange(style)}
                  >
                    <Text
                      style={[
                        styles.doorStyleBtnText,
                        currentDoorStyle === style &&
                          styles.doorStyleBtnTextActive,
                      ]}
                    >
                      {DOOR_STYLE_LABELS[style]}
                    </Text>
                    {DOOR_STYLES_WITH_SPLIT.includes(style) && (
                      <Text style={styles.doorStyleSplitBadge}>split</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          <Text style={styles.gridTitle}>Panel Type</Text>
          <View style={styles.modalGrid}>
            {PANEL_TYPES.map((pt) => {
              const isSelected = pt.id === currentPanelTypeId;
              const flexes = getSectionFlexes(pt.sections);
              const isOper = pt.id.startsWith("oper");
              const isPtDoor = pt.id === "door" || pt.id === "door_t";
              return (
                <TouchableOpacity
                  key={pt.id}
                  style={[
                    styles.modalOption,
                    isSelected && styles.modalOptionSelected,
                  ]}
                  onPress={() => onSelectType(pt.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.modalPreview}>
                    {pt.sections.map((sec, si) => {
                      const showSplit =
                        (sec === "glass-op" && isOper) ||
                        (sec === "door" &&
                          isPtDoor &&
                          DOOR_STYLES_WITH_SPLIT.includes(
                            isSelected ? currentDoorStyle : "sliding",
                          ));
                      const pMat =
                        sec === "transom"
                          ? currentMaterials.transom
                          : sec === "kneewall"
                            ? currentMaterials.kneewall
                            : "glass";
                      const pBg =
                        (sec === "transom" || sec === "kneewall") &&
                        pMat === "solid"
                          ? SOLID_COLOR
                          : SECTION_BG[sec];
                      return (
                        <React.Fragment key={`${sec}-${si}`}>
                          {si > 0 && <View style={styles.previewDivider} />}
                          {showSplit ? (
                            <View
                              style={[
                                styles.sectionSplit,
                                { flex: flexes[si] },
                              ]}
                            >
                              <View
                                style={[
                                  styles.sectionHalf,
                                  { backgroundColor: pBg },
                                ]}
                              />
                              <View
                                style={{
                                  width: 2,
                                  backgroundColor: FRAME_COLOR,
                                }}
                              />
                              <View
                                style={[
                                  styles.sectionHalf,
                                  { backgroundColor: pBg },
                                ]}
                              />
                            </View>
                          ) : (
                            <View
                              style={[
                                styles.previewSection,
                                { backgroundColor: pBg, flex: flexes[si] },
                              ]}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </View>
                  <Text
                    style={[
                      styles.modalOptionLabel,
                      isSelected && styles.modalOptionLabelSel,
                    ]}
                    numberOfLines={3}
                  >
                    {pt.label}
                  </Text>
                  {isSelected && (
                    <View style={styles.checkBadge}>
                      <Text style={styles.checkBadgeText}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function WallAddOnRow({
  opt,
  isChecked,
  qty,
  onToggle,
  onQuantityChange,
}: {
  opt: Option;
  isChecked: boolean;
  qty: string;
  onToggle: () => void;
  onQuantityChange: (q: string) => void;
}) {
  const isSqFt = opt.unit_type === "sq_ft";
  const isLinFt = opt.unit_type === "lin_ft";
  const isEach = !isSqFt && !isLinFt;
  const [sqW, setSqW] = useState("");
  const [sqL, setSqL] = useState("");
  const [linA, setLinA] = useState("");
  const [linB, setLinB] = useState("");
  const [linC, setLinC] = useState("");
  const handleSq = (w: string, l: string) => {
    const wFt = Math.ceil((parseFloat(w) || 0) / 12);
    const lFt = Math.ceil((parseFloat(l) || 0) / 12);
    const r = wFt * lFt;
    onQuantityChange(r > 0 ? String(r) : "");
  };
  const handleLin = (a: string, b: string, c: string) => {
    const total =
      (parseFloat(a) || 0) + (parseFloat(b) || 0) + (parseFloat(c) || 0);
    const r = total > 0 ? Math.ceil(total / 12) : 0;
    onQuantityChange(r > 0 ? String(r) : "");
  };
  return (
    <View style={styles.addOnRow}>
      <TouchableOpacity
        style={[styles.addOnCheck, isChecked && styles.addOnCheckActive]}
        onPress={() => {
          onToggle();
          if (!isChecked && isEach) onQuantityChange("1");
        }}
      >
        {isChecked && <Text style={styles.addOnCheckMark}>✓</Text>}
      </TouchableOpacity>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.addOnRowInfo}>
          <Text style={styles.addOnRowName} numberOfLines={2}>
            {opt.name}
          </Text>
          <Text style={styles.addOnRowPrice}>
            ${opt.unit_price.toLocaleString()} /{" "}
            {opt.unit_type.replace(/_/g, " ")}
          </Text>
        </View>
        {isChecked && (
          <View style={styles.addOnInputRow}>
            {isSqFt && (
              <>
                <TextInput
                  style={styles.addOnQtyInput}
                  value={sqW}
                  onChangeText={(v) => {
                    setSqW(v);
                    handleSq(v, sqL);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="W in"
                  placeholderTextColor={Colors.text.tertiary}
                />
                <Text style={styles.addOnSep}>×</Text>
                <TextInput
                  style={styles.addOnQtyInput}
                  value={sqL}
                  onChangeText={(v) => {
                    setSqL(v);
                    handleSq(sqW, v);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="L in"
                  placeholderTextColor={Colors.text.tertiary}
                />
                {qty ? (
                  <Text style={styles.addOnCalc}>= {qty} sq ft</Text>
                ) : null}
              </>
            )}
            {isLinFt && (
              <>
                <TextInput
                  style={styles.addOnQtyInput}
                  value={linA}
                  onChangeText={(v) => {
                    setLinA(v);
                    handleLin(v, linB, linC);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="in"
                  placeholderTextColor={Colors.text.tertiary}
                />
                <Text style={styles.addOnSep}>+</Text>
                <TextInput
                  style={styles.addOnQtyInput}
                  value={linB}
                  onChangeText={(v) => {
                    setLinB(v);
                    handleLin(linA, v, linC);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="in"
                  placeholderTextColor={Colors.text.tertiary}
                />
                <Text style={styles.addOnSep}>+</Text>
                <TextInput
                  style={styles.addOnQtyInput}
                  value={linC}
                  onChangeText={(v) => {
                    setLinC(v);
                    handleLin(linA, linB, v);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="in"
                  placeholderTextColor={Colors.text.tertiary}
                />
                {qty ? (
                  <Text style={styles.addOnCalc}>= {qty} lin ft</Text>
                ) : null}
              </>
            )}
            {isEach && (
              <TextInput
                style={styles.addOnQtyInput}
                value={qty}
                onChangeText={onQuantityChange}
                keyboardType="decimal-pad"
                placeholder="Qty"
                placeholderTextColor={Colors.text.tertiary}
              />
            )}
            {qty ? (
              <Text style={styles.addOnRowTotal}>
                ${(opt.unit_price * (parseFloat(qty) || 0)).toLocaleString()}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

function WallAddOnsSection({
  wallId,
  allOptions,
  wallAddOns,
  onToggle,
  onQuantityChange,
}: {
  wallId: string;
  allOptions: Option[];
  wallAddOns: Record<string, string>;
  onToggle: (id: string) => void;
  onQuantityChange: (id: string, qty: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const addOnOptions = allOptions.filter((o) => {
    if (o.category !== "wall_type") return false;
    return !VISUALLY_HANDLED_KEYWORDS.some((kw) =>
      o.name.toLowerCase().includes(kw.toLowerCase()),
    );
  });
  if (addOnOptions.length === 0) return null;
  const activeCount = addOnOptions.filter(
    (o) => wallAddOns[o.id] !== undefined,
  ).length;
  return (
    <View style={styles.addOnSection}>
      <TouchableOpacity
        style={styles.addOnSectionHeader}
        onPress={() => setExpanded((e) => !e)}
        activeOpacity={0.7}
      >
        <View>
          <Text style={styles.addOnSectionTitle}>
            Wall {wallId} — Additional Options
          </Text>
          <Text style={styles.addOnSectionSub}>
            {activeCount > 0
              ? `${activeCount} selected`
              : "Doors, handrails, underbuilds, etc."}
          </Text>
        </View>
        <Text style={styles.addOnChevron}>{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={styles.addOnList}>
          {addOnOptions.map((opt) => (
            <WallAddOnRow
              key={opt.id}
              opt={opt}
              isChecked={wallAddOns[opt.id] !== undefined}
              qty={wallAddOns[opt.id] || ""}
              onToggle={() => onToggle(opt.id)}
              onQuantityChange={(q) => onQuantityChange(opt.id, q)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

interface WallBuilderProps {
  walls: WallSelection[];
  wallSystem: "2_inch" | "4_inch" | "6_inch" | null;
  roofStyle: string | null;
  mountHeight: string;
  allOptions: Option[];
  selectedWallType: Option | null;
  wallAddOns: Record<string, Record<string, string>>;
  defaultTransomHeightIn: string;
  defaultKneewallHeightIn: string;
  onWallTypeSelect: (o: Option) => void;
  onDimensionChange: (
    wallId: "A" | "B" | "C",
    field: "widthIn" | "heightIn",
    value: string,
  ) => void;
  onDefaultTransomHeightChange: (v: string) => void;
  onDefaultKneewallHeightChange: (v: string) => void;
  onUnitTransomHeightChange: (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    v: string,
  ) => void;
  onUnitKneewallHeightChange: (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    v: string,
  ) => void;
  onWallUnitsChange: (wallId: "A" | "B" | "C", units: number) => void;
  onWallPanelTypeChange: (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    panelTypeId: string,
  ) => void;
  onUnitMaterialChange: (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    feature: "transom" | "kneewall",
    material: "glass" | "solid",
  ) => void;
  onUnitDoorStyleChange: (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    style: DoorStyle,
  ) => void;
  onSplitTransomChange: (wallId: "A" | "B" | "C", value: boolean) => void;
  onSplitKneewallChange: (wallId: "A" | "B" | "C", value: boolean) => void;
  onGableGlassChange: (
    wallId: "A" | "B" | "C",
    config: GableGlassConfig | null,
  ) => void;
  onWallAddOnToggle: (wallId: string, optionId: string) => void;
  onWallAddOnQuantityChange: (
    wallId: string,
    optionId: string,
    qty: string,
  ) => void;
  wallColor: "white" | "tan" | "bronze" | null;
  onWallColorChange: (color: "white" | "tan" | "bronze") => void;
  activeWallId: "A" | "B" | "C";
  onActiveWallChange: (wallId: "A" | "B" | "C") => void;
  onSolidMaterialChange: (
    wallId: "A" | "B" | "C",
    material: SolidMaterial,
  ) => void;
  onWallUnitWidthChange: (
    wallId: "A" | "B" | "C",
    unitIndex: number,
    value: string,
  ) => void;
}

const FRAME_COLORS = {
  white: { frame: "#d0d0d0", swatch: "#e8e8e8", label: "White" },
  tan: { frame: "#b89a6a", swatch: "#cdb88a", label: "Tan" },
  bronze: { frame: "#3e2810", swatch: "#6b4228", label: "Bronze" },
} as const;

function getFrameColor(wallColor: "white" | "tan" | "bronze" | null): string {
  if (!wallColor) return FRAME_COLORS.white.frame;
  return FRAME_COLORS[wallColor].frame;
}

export default function WallBuilder({
  walls,
  wallSystem,
  roofStyle,
  mountHeight,
  allOptions,
  selectedWallType,
  wallAddOns,
  defaultTransomHeightIn,
  defaultKneewallHeightIn,
  wallColor,
  onWallColorChange,
  activeWallId,
  onActiveWallChange,
  onSolidMaterialChange,
  onWallUnitWidthChange,
  onWallTypeSelect,
  onDimensionChange,
  onDefaultTransomHeightChange,
  onDefaultKneewallHeightChange,
  onUnitTransomHeightChange,
  onUnitKneewallHeightChange,
  onWallUnitsChange,
  onWallPanelTypeChange,
  onUnitMaterialChange,
  onUnitDoorStyleChange,
  onSplitTransomChange,
  onSplitKneewallChange,
  onGableGlassChange,
  onWallAddOnToggle,
  onWallAddOnQuantityChange,
}: WallBuilderProps) {
  const [modalUnitIndex, setModalUnitIndex] = useState<number | null>(null);
  const [panelDetailsOpen, setPanelDetailsOpen] = useState(true);

  const activeWall = walls.find((w) => w.id === activeWallId) ?? walls[0];
  const frameWidth = DIVIDER_WIDTH[wallSystem ?? "4_inch"] ?? 7;
  const dynamicFrameColor = getFrameColor(wallColor);

  const baseWallTypeOptions = allOptions.filter((o) => {
    if (o.category !== "wall_type" || o.sort_order > 10) return false;
    if (!wallSystem) return true;
    if (wallSystem === "2_inch") return o.sort_order <= 2;
    if (wallSystem === "4_inch") return o.sort_order >= 3 && o.sort_order <= 8;
    if (wallSystem === "6_inch") return o.sort_order >= 9 && o.sort_order <= 10;
    return true;
  });

  const anyWallHasTransom = walls.some((w) =>
    w.panelTypes.some((ptId) =>
      PANEL_TYPES.find((p) => p.id === ptId)?.sections.includes("transom"),
    ),
  );
  const anyWallHasKneewall = walls.some((w) =>
    w.panelTypes.some((ptId) =>
      PANEL_TYPES.find((p) => p.id === ptId)?.sections.includes("kneewall"),
    ),
  );
  const wallHasTransom =
    activeWall?.panelTypes.some((ptId) =>
      PANEL_TYPES.find((p) => p.id === ptId)?.sections.includes("transom"),
    ) ?? false;
  const wallHasKneewall =
    activeWall?.panelTypes.some((ptId) =>
      PANEL_TYPES.find((p) => p.id === ptId)?.sections.includes("kneewall"),
    ) ?? false;

  const canHaveGableGlass =
    (activeWallId === "B" && roofStyle === "gable") ||
    ((activeWallId === "A" || activeWallId === "C") && roofStyle === "studio");
  const glassLabel = activeWallId === "B" ? "Gable Glass" : "Wing Glass";
  const isTanBronzeWallType = selectedWallType
    ? /tan|bronze/i.test(selectedWallType.name)
    : false;

  const effectiveGableConfig: GableGlassConfig = activeWall?.gableGlass ?? {
    glassType: "uninsulated",
    solidStyle: "panel",
    count: activeWall?.units ?? 1,
  };

  useEffect(() => {
    if (canHaveGableGlass && activeWall && activeWall.gableGlass === null) {
      onGableGlassChange(activeWall.id, {
        glassType: "uninsulated",
        solidStyle: "panel",
        count: activeWall.units,
      });
    }
  }, [canHaveGableGlass, activeWallId]);

  useEffect(() => {
    if (
      activeWall?.gableGlass &&
      activeWall.gableGlass.count > 1 &&
      activeWall.gableGlass.count !== activeWall.units
    ) {
      onGableGlassChange(activeWall.id, {
        ...activeWall.gableGlass,
        count: activeWall.units,
      });
    }
  }, [activeWall?.units]);

  const modalVisible = modalUnitIndex !== null;
  const currentModalPanelTypeId =
    modalUnitIndex !== null
      ? (activeWall?.panelTypes[modalUnitIndex] ?? "fixed_glass")
      : "fixed_glass";
  const currentModalMaterials =
    modalUnitIndex !== null
      ? (activeWall?.unitMaterials[modalUnitIndex] ?? {
          transom: "glass" as const,
          kneewall: "glass" as const,
        })
      : { transom: "glass" as const, kneewall: "glass" as const };
  const currentModalDoorStyle: DoorStyle =
    modalUnitIndex !== null
      ? (activeWall?.unitDoorStyles[modalUnitIndex] ?? "sliding")
      : "sliding";
  const currentModalTransomHeight =
    modalUnitIndex !== null
      ? (activeWall?.unitTransomHeights[modalUnitIndex] ?? "")
      : "";
  const currentModalKneewallHeight =
    modalUnitIndex !== null
      ? (activeWall?.unitKneewallHeights[modalUnitIndex] ?? "")
      : "";

  const CANVAS_MAX_WIDTH = 680;
  const wallWIn = parseFloat(activeWall?.widthIn || "0") || 0;
  const wallHIn = parseFloat(activeWall?.heightIn || "0") || 0;
  const wallWFt = wallWIn / 12;
  const wallHFt = wallHIn / 12;
  const aspectRatio = wallWFt > 0 && wallHFt > 0 ? wallWFt / wallHFt : 2;
  const clampedAspect = Math.min(Math.max(aspectRatio, 0.8), 4);
  const canvasHeight = Math.min(
    Math.max(Math.round(CANVAS_MAX_WIDTH / clampedAspect), 200),
    480,
  );
  const canvasInnerHeight = canvasHeight - 24;
  const pricingWFt = ceilFt(activeWall?.widthIn || "");
  const pricingHFt = ceilFt(activeWall?.heightIn || "");
  const pricingSqFt = pricingWFt * pricingHFt;
  const wallHeightFtStr = wallHFt > 0 ? String(wallHFt) : "";
  const unitWidthLabel =
    wallWIn > 0 && activeWall
      ? `${Math.round(wallWIn / activeWall.units)}" per unit`
      : "— per unit";

  // Proportional unit pixel widths — mirrors ScreenRoomBuilder logic exactly
  const CANVAS_PADDING = 12;
  const availableForUnits =
    CANVAS_MAX_WIDTH - 2 * CANVAS_PADDING - (activeWall.units - 1) * frameWidth;
  const rawWidths =
    activeWall.unitWidths.length === activeWall.units
      ? activeWall.unitWidths
      : Array(activeWall.units).fill(
          wallWIn > 0 ? String(wallWIn / activeWall.units) : "1",
        );
  const totalUnitIn =
    rawWidths.reduce(
      (s, w) => s + (parseFloat(w) || wallWIn / activeWall.units || 1),
      0,
    ) || 1;
  const unitPixelWidths = Array.from({ length: activeWall.units }, (_, i) => {
    const uw = parseFloat(rawWidths[i]) || wallWIn / activeWall.units || 1;
    return Math.max(10, Math.round((uw / totalUnitIn) * availableForUnits));
  });

  // Gable divider x-positions aligned exactly with canvas unit dividers
  const gableDivXPositions: number[] = [];
  {
    let cumX = CANVAS_PADDING;
    for (let i = 0; i < unitPixelWidths.length - 1; i++) {
      cumX += unitPixelWidths[i];
      gableDivXPositions.push(Math.round(cumX + frameWidth / 2));
      cumX += frameWidth;
    }
  }

  const autoAddedKeys = Object.keys(wallAddOns[activeWall?.id ?? ""] ?? {});

  if (!activeWall) return null;

  // Progressive disclosure gates: reveal each part of the builder as the prior
  // step is filled in, so the screen isn't overwhelming with everything at once.
  // (If there are no wall-type options to pick, don't block on it.) Once the wall
  // already has dimensions — e.g. an existing config after switching product
  // lines (which resets wallType) — show everything instead of re-gating behind
  // re-picking the wall type.
  const hasDims = wallWIn > 0 && wallHIn > 0;
  const hasWallType =
    !!selectedWallType || baseWallTypeOptions.length === 0 || hasDims;

  return (
    <View style={styles.container}>
      <View style={styles.sectionCard}>
        {baseWallTypeOptions.length > 0 && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionLabel}>Base Wall Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {baseWallTypeOptions.map((opt) => {
                  const isSelected = selectedWallType?.id === opt.id;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={[
                        styles.wallTypeChip,
                        isSelected && styles.wallTypeChipSelected,
                      ]}
                      onPress={() => onWallTypeSelect(opt)}
                    >
                      <Text
                        style={[
                          styles.wallTypeChipText,
                          isSelected && styles.wallTypeChipTextSel,
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
        )}
        {isTanBronzeWallType && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionLabel}>Frame Color</Text>
            <View style={styles.colorPickerRow}>
              {(["tan", "bronze"] as const).map((key) => {
                const val = FRAME_COLORS[key];
                const isSelected = (wallColor ?? "tan") === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.colorSwatch,
                      isSelected && styles.colorSwatchSelected,
                    ]}
                    onPress={() => onWallColorChange(key)}
                  >
                    <View
                      style={[
                        styles.colorDot,
                        { backgroundColor: val.swatch, borderColor: val.frame },
                      ]}
                    />
                    <Text
                      style={[
                        styles.colorSwatchLabel,
                        isSelected && styles.colorSwatchLabelSel,
                      ]}
                    >
                      {val.label}
                    </Text>
                    {isSelected && (
                      <Text style={styles.colorSwatchCheck}>✓</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </View>

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
      {walls.length > 1 && (
        <View style={styles.tabsRow}>
          {walls.map((w) => (
            <TouchableOpacity
              key={w.id}
              style={[styles.tab, activeWallId === w.id && styles.tabActive]}
              onPress={() => {
                onActiveWallChange(w.id);
                setModalUnitIndex(null);
              }}
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

      <View style={styles.sectionCard}>
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionLabel}>
            Dimensions — Wall {activeWall.id}
          </Text>
          <View style={styles.dimsRow}>
            <View style={styles.dimField}>
              <Text style={styles.dimLabel}>Width (in)</Text>
              <TextInput
                style={styles.dimInput}
                value={activeWall.widthIn}
                onChangeText={(v) =>
                  onDimensionChange(activeWall.id, "widthIn", v)
                }
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={Colors.text.tertiary}
              />
              {pricingWFt > 0 && (
                <Text style={styles.dimConvert}>= {pricingWFt} ft</Text>
              )}
            </View>
            <View style={styles.dimField}>
              <Text style={styles.dimLabel}>Height (in)</Text>
              <TextInput
                style={styles.dimInput}
                value={activeWall.heightIn}
                onChangeText={(v) =>
                  onDimensionChange(activeWall.id, "heightIn", v)
                }
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={Colors.text.tertiary}
              />
              {pricingHFt > 0 && (
                <Text style={styles.dimConvert}>= {pricingHFt} ft</Text>
              )}
            </View>
            <View style={styles.dimField}>
              <Text style={styles.dimLabel}>Units</Text>
              <View style={styles.unitsRow}>
                <TouchableOpacity
                  style={styles.unitsBtn}
                  onPress={() =>
                    onWallUnitsChange(activeWall.id, activeWall.units - 1)
                  }
                >
                  <Text style={styles.unitsBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.unitsCount}>{activeWall.units}</Text>
                <TouchableOpacity
                  style={styles.unitsBtn}
                  onPress={() =>
                    onWallUnitsChange(activeWall.id, activeWall.units + 1)
                  }
                >
                  <Text style={styles.unitsBtnText}>+</Text>
                </TouchableOpacity>
              </View>
              {pricingSqFt > 0 && (
                <Text style={styles.dimConvert}>{pricingSqFt} sq ft</Text>
              )}
            </View>
          </View>
        </View>

        {!hasDims && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionHint}>
              Enter width and height above to design the wall, choose panels, and
              set glass.
            </Text>
          </View>
        )}

        {hasDims && canHaveGableGlass && (
          <View
            style={[
              styles.sectionBlock,
              { borderBottomWidth: 0.5, borderBottomColor: Colors.border },
            ]}
          >
            <Text style={styles.sectionLabel}>{glassLabel}</Text>
            <Text style={styles.sectionHint}>
              {activeWallId === "B"
                ? "Glass in the gable peak above panels"
                : "Glass at the wing wall roofline"}
            </Text>
            <View style={styles.gableRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dimLabel}>Material</Text>
                <View style={styles.toggleRow}>
                  {(
                    [
                      { value: "uninsulated", label: "Glass" },
                      { value: "solid", label: "Solid" },
                    ] as const
                  ).map((opt) => {
                    const isActive =
                      opt.value === "solid"
                        ? effectiveGableConfig.glassType === "solid"
                        : effectiveGableConfig.glassType !== "solid";
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.toggleBtn,
                          isActive && styles.toggleBtnActive,
                        ]}
                        onPress={() =>
                          onGableGlassChange(activeWall.id, {
                            ...effectiveGableConfig,
                            glassType: opt.value,
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.toggleBtnText,
                            isActive && styles.toggleBtnTextActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dimLabel}>
                  Panes{" "}
                  <Text
                    style={{
                      fontWeight: "400",
                      textTransform: "none",
                      color: Colors.text.tertiary,
                    }}
                  >
                    (auto: {activeWall.units})
                  </Text>
                </Text>
                <View style={styles.unitsRow}>
                  <TouchableOpacity
                    style={styles.unitsBtn}
                    onPress={() =>
                      onGableGlassChange(activeWall.id, {
                        ...effectiveGableConfig,
                        count: Math.max(1, effectiveGableConfig.count - 1),
                      })
                    }
                  >
                    <Text style={styles.unitsBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.unitsCount}>
                    {effectiveGableConfig.count}
                  </Text>
                  <TouchableOpacity
                    style={styles.unitsBtn}
                    onPress={() =>
                      onGableGlassChange(activeWall.id, {
                        ...effectiveGableConfig,
                        count: Math.min(6, effectiveGableConfig.count + 1),
                      })
                    }
                  >
                    <Text style={styles.unitsBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            {(() => {
              const count = effectiveGableConfig.count;
              if (effectiveGableConfig.glassType === "solid") {
                const opt = allOptions.find((o) =>
                  o.name.includes("Solid Wing Panel"),
                );
                if (!opt) return null;
                const solidQty = activeWallId === "B" ? 2 : 1;
                return (
                  <View style={{ gap: 8 }}>
                    <SolidStylePicker
                      value={effectiveGableConfig.solidStyle ?? "panel"}
                      onChange={(m) =>
                        onGableGlassChange(activeWall.id, {
                          ...effectiveGableConfig,
                          solidStyle: m,
                        })
                      }
                    />
                    <View style={styles.priceNote}>
                      <Text style={styles.priceNoteText}>
                        Solid: ${opt.unit_price.toLocaleString()} × {solidQty} =
                        ${(opt.unit_price * solidQty).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                );
              }
              const glassOptName = getGlassOptionName(selectedWallType?.name);
              const opt = allOptions.find((o) =>
                o.name.includes(
                  glassOptName.includes("Comfort")
                    ? "Comfort G1"
                    : "Uninsulated Single Pane",
                ),
              );
              if (!opt) return null;
              return (
                <View style={styles.priceNote}>
                  <Text style={styles.priceNoteText}>
                    {opt.name.includes("Comfort")
                      ? "G1 Comfort"
                      : "Single Pane"}
                    : ${opt.unit_price.toLocaleString()} × {count} = $
                    {(opt.unit_price * count).toLocaleString()}
                  </Text>
                </View>
              );
            })()}
          </View>
        )}

        {hasDims && (
        <View style={styles.canvasBlock}>
          <View style={{ alignItems: "center" }}>
            {activeWall.gableGlass && (
              <GableGlassShape
                wallId={activeWall.id}
                roofStyle={roofStyle}
                wallHeightFt={wallHeightFtStr}
                mountHeightFt={mountHeight}
                transomHeightIn={
                  activeWall.unitTransomHeights[0] || defaultTransomHeightIn
                }
                wallHasTransom={wallHasTransom}
                config={activeWall.gableGlass}
                innerWidth={CANVAS_MAX_WIDTH}
                frameWidth={frameWidth}
                frameColor={dynamicFrameColor}
                canvasInnerHeight={canvasInnerHeight}
                dividerXPositions={gableDivXPositions}
              />
            )}
            <View
              style={{
                width: CANVAS_MAX_WIDTH,
                height: canvasHeight,
                backgroundColor: dynamicFrameColor,
                borderTopLeftRadius: activeWall.gableGlass ? 0 : 8,
                borderTopRightRadius: activeWall.gableGlass ? 0 : 8,
                borderBottomLeftRadius: 8,
                borderBottomRightRadius: 8,
                overflow: "hidden",
              }}
            >
              <View style={styles.canvasInner}>
                {activeWall.panelTypes.map((ptId, i) => {
                  const effectiveTransomH =
                    activeWall.unitTransomHeights[i] || defaultTransomHeightIn;
                  const effectiveKneewallH =
                    activeWall.unitKneewallHeights[i] ||
                    defaultKneewallHeightIn;
                  const doorStyle: DoorStyle =
                    activeWall.unitDoorStyles[i] ?? "sliding";
                  return (
                    <React.Fragment key={i}>
                      {i > 0 && (
                        <View
                          style={[
                            styles.unitDivider,
                            {
                              width: frameWidth,
                              backgroundColor: dynamicFrameColor,
                            },
                          ]}
                        />
                      )}
                      <PanelUnit
                        panelTypeId={ptId}
                        materials={
                          activeWall.unitMaterials[i] ?? {
                            transom: "glass",
                            kneewall: "glass",
                          }
                        }
                        isSelected={modalUnitIndex === i}
                        splitTransom={activeWall.splitTransom}
                        splitKneewall={activeWall.splitKneewall}
                        doorStyle={doorStyle}
                        frameWidth={frameWidth}
                        frameColor={dynamicFrameColor}
                        wallHeightFt={wallHeightFtStr}
                        transomHeightIn={effectiveTransomH}
                        kneewallHeightIn={effectiveKneewallH}
                        canvasInnerHeight={canvasInnerHeight}
                        unitWidthPx={unitPixelWidths[i]}
                        solidPanelMaterial={
                          activeWall.unitMaterials[i]?.solidStyle ??
                          activeWall.solidPanelMaterial ??
                          "panel"
                        }
                        onPress={() => setModalUnitIndex(i)}
                      />
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
            <View style={styles.canvasFooter} />
            <Text style={styles.unitWidthLbl}>{unitWidthLabel}</Text>
            <Text style={styles.tapHint}>
              Tap a unit to change type, materials, or door style
            </Text>
            {activeWall.units > 1 && (
              <View style={{ width: "100%", gap: 4, marginTop: 4 }}>
                <Text style={styles.dimLabel}>
                  Adjust individual unit widths (in)
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View
                    style={{ flexDirection: "row", gap: 6, paddingVertical: 4 }}
                  >
                    {Array.from({ length: activeWall.units }).map((_, i) => {
                      const uw =
                        activeWall.unitWidths[i] ??
                        (wallWIn > 0
                          ? String(
                              Math.round((wallWIn / activeWall.units) * 10) /
                                10,
                            )
                          : "");
                      const isLocked = activeWall.unitLocked?.[i] ?? false;
                      return (
                        <View key={i} style={{ alignItems: "center", gap: 2 }}>
                          <Text
                            style={{
                              fontSize: FontSize.small,
                              color: Colors.text.tertiary,
                            }}
                          >
                            U{i + 1}
                            {isLocked ? " 🔒" : ""}
                          </Text>
                          <TextInput
                            style={[
                              styles.unitWidthInput,
                              isLocked && styles.unitWidthInputLocked,
                            ]}
                            value={uw}
                            onChangeText={(v) =>
                              onWallUnitWidthChange(activeWall.id, i, v)
                            }
                            keyboardType="decimal-pad"
                          />
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            )}
          </View>
        </View>
        )}

        {hasDims && autoAddedKeys.length > 0 && (
          <View style={styles.autoChipsBlock}>
            <Text style={styles.autoChipsLabel}>Auto-added</Text>
            <View style={styles.autoChipsRow}>
              {autoAddedKeys.map((optId) => {
                const opt = allOptions.find((o) => o.id === optId);
                if (!opt) return null;
                return (
                  <View key={optId} style={styles.autoChip}>
                    <Text style={styles.autoChipText}>✓ {opt.name}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </View>

      {hasDims && (anyWallHasTransom || anyWallHasKneewall) && (
        <View style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.collapsibleHeader}
            onPress={() => setPanelDetailsOpen((o) => !o)}
            activeOpacity={0.7}
          >
            <View>
              <Text style={styles.sectionLabel}>
                Panel Details — Wall {activeWall.id}
              </Text>
              <Text style={styles.sectionHint}>Heights, framing & splits</Text>
            </View>
            <Text style={styles.chevron}>{panelDetailsOpen ? "▲" : "▼"}</Text>
          </TouchableOpacity>
          {panelDetailsOpen && (
            <View style={styles.collapsibleBody}>
              {(anyWallHasTransom || anyWallHasKneewall) && (
                <View style={styles.sectionBlock}>
                  <Text style={styles.subLabel}>
                    Default Heights (all units)
                  </Text>
                  <Text style={styles.sectionHint}>
                    Override per-unit in the panel picker
                  </Text>
                  <View style={styles.dimsRow}>
                    {anyWallHasTransom && (
                      <View style={styles.dimField}>
                        <Text style={styles.dimLabel}>
                          Transom (in)
                          {!defaultTransomHeightIn && (
                            <Text style={{ color: "#e03030" }}> *</Text>
                          )}
                        </Text>
                        <TextInput
                          style={[
                            styles.dimInput,
                            styles.dimInputAccent,
                            !defaultTransomHeightIn && styles.dimInputRequired,
                          ]}
                          value={defaultTransomHeightIn}
                          onChangeText={onDefaultTransomHeightChange}
                          keyboardType="decimal-pad"
                          placeholder="Required"
                          placeholderTextColor="#e03030"
                        />
                      </View>
                    )}
                    {anyWallHasKneewall && (
                      <View style={styles.dimField}>
                        <Text style={styles.dimLabel}>
                          Kneewall (in)
                          {!defaultKneewallHeightIn && (
                            <Text style={{ color: "#e03030" }}> *</Text>
                          )}
                        </Text>
                        <TextInput
                          style={[
                            styles.dimInput,
                            styles.dimInputAccentKnee,
                            !defaultKneewallHeightIn && styles.dimInputRequired,
                          ]}
                          value={defaultKneewallHeightIn}
                          onChangeText={onDefaultKneewallHeightChange}
                          keyboardType="decimal-pad"
                          placeholder="Required"
                          placeholderTextColor="#e03030"
                        />
                      </View>
                    )}
                  </View>
                </View>
              )}

              {(wallHasTransom || wallHasKneewall) && (
                <View style={styles.sectionBlock}>
                  <Text style={styles.subLabel}>
                    Frame Dividers — Wall {activeWall.id}
                  </Text>
                  <View style={styles.splitRow}>
                    {wallHasTransom && (
                      <TouchableOpacity
                        style={[
                          styles.splitToggle,
                          activeWall.splitTransom && styles.splitToggleActive,
                        ]}
                        onPress={() =>
                          onSplitTransomChange(
                            activeWall.id,
                            !activeWall.splitTransom,
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.splitToggleText,
                            activeWall.splitTransom &&
                              styles.splitToggleTextActive,
                          ]}
                        >
                          {activeWall.splitTransom
                            ? "⊟ Transom Split On"
                            : "⊞ Transom Split Off"}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {wallHasKneewall && (
                      <TouchableOpacity
                        style={[
                          styles.splitToggle,
                          activeWall.splitKneewall &&
                            styles.splitToggleActiveKnee,
                        ]}
                        onPress={() =>
                          onSplitKneewallChange(
                            activeWall.id,
                            !activeWall.splitKneewall,
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.splitToggleText,
                            activeWall.splitKneewall &&
                              styles.splitToggleTextActive,
                          ]}
                        >
                          {activeWall.splitKneewall
                            ? "⊟ Kneewall Split On"
                            : "⊞ Kneewall Split Off"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {hasDims && (
        <WallAddOnsSection
          wallId={activeWall.id}
          allOptions={allOptions}
          wallAddOns={wallAddOns[activeWall.id] ?? {}}
          onToggle={(optId) => onWallAddOnToggle(activeWall.id, optId)}
          onQuantityChange={(optId, qty) =>
            onWallAddOnQuantityChange(activeWall.id, optId, qty)
          }
        />
      )}
        </>
      )}

      {modalUnitIndex !== null && (
        <PanelPickerModal
          visible={modalVisible}
          wallId={activeWall.id}
          unitIndex={modalUnitIndex}
          unitCount={activeWall.units}
          currentPanelTypeId={currentModalPanelTypeId}
          currentMaterials={currentModalMaterials}
          currentDoorStyle={currentModalDoorStyle}
          currentUnitTransomHeight={currentModalTransomHeight}
          currentUnitKneewallHeight={currentModalKneewallHeight}
          defaultTransomHeightIn={defaultTransomHeightIn}
          defaultKneewallHeightIn={defaultKneewallHeightIn}
          frameWidth={frameWidth}
          wallSystem={wallSystem}
          onSelectType={(ptId) =>
            onWallPanelTypeChange(activeWall.id, modalUnitIndex, ptId)
          }
          onMaterialChange={(feature, material) =>
            onUnitMaterialChange(
              activeWall.id,
              modalUnitIndex,
              feature,
              material,
            )
          }
          onSolidStyleChange={(m) =>
            onUnitMaterialChange(
              activeWall.id,
              modalUnitIndex,
              "solidStyle" as any,
              m as any,
            )
          }
          onDoorStyleChange={(style) =>
            onUnitDoorStyleChange(activeWall.id, modalUnitIndex, style)
          }
          onUnitTransomHeightChange={(v) =>
            onUnitTransomHeightChange(activeWall.id, modalUnitIndex, v)
          }
          onUnitKneewallHeightChange={(v) =>
            onUnitKneewallHeightChange(activeWall.id, modalUnitIndex, v)
          }
          onClose={() => setModalUnitIndex(null)}
        />
      )}
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
  subLabel: {
    fontSize: FontSize.caption,
    fontWeight: "700",
    color: Colors.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  chipRow: { flexDirection: "row", gap: 8, paddingBottom: 2 },
  wallTypeChip: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    minWidth: 130,
    gap: 2,
  },
  wallTypeChipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryTint,
  },
  wallTypeChipText: {
    fontSize: FontSize.small,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  wallTypeChipTextSel: { color: Colors.primary },
  wallTypeChipPrice: { fontSize: FontSize.small, color: Colors.text.tertiary },
  colorPickerRow: { flexDirection: "row", gap: 10 },
  colorSwatch: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  colorSwatchSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryTint,
  },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  colorSwatchLabel: {
    flex: 1,
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  colorSwatchLabelSel: { color: Colors.primary },
  colorSwatchCheck: { fontSize: FontSize.body, fontWeight: "700", color: Colors.primary },
  tabsRow: { flexDirection: "row", gap: 8 },
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
  tabText: { fontSize: FontSize.callout, fontWeight: "600", color: Colors.text.secondary },
  tabTextActive: { color: "#fff" },
  dimsRow: { flexDirection: "row", gap: 10 },
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
  dimInputAccent: { borderColor: "#d4a800", borderWidth: 2 },
  dimInputAccentKnee: { borderColor: "#b06040", borderWidth: 2 },
  dimInputRequired: { borderColor: "#e03030", borderWidth: 2 },
  dimConvert: {
    fontSize: FontSize.small,
    color: Colors.text.tertiary,
    textAlign: "center",
    fontStyle: "italic",
  },
  canvasBlock: { padding: 14, gap: 8, alignItems: "center" },
  canvasInner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    padding: 12,
  },
  canvasFooter: { gap: 3, alignItems: "center" },
  unitDivider: { flexShrink: 0 },
  unit: {
    borderRadius: 3,
    overflow: "hidden",
    flexDirection: "column",
    borderWidth: 3,
    borderColor: "transparent",
  },
  unitSelected: { borderColor: "#e8621a" },
  sectionDivider: { height: 5, flexShrink: 0 },
  sectionSplit: { flexDirection: "row", overflow: "hidden" },
  sectionHalf: { flex: 1 },
  unitWidthLbl: { fontSize: FontSize.caption, color: Colors.text.tertiary },
  tapHint: { fontSize: FontSize.small, color: Colors.text.tertiary, fontStyle: "italic" },
  autoChipsBlock: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 6,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
    paddingTop: 10,
  },
  autoChipsLabel: {
    fontSize: FontSize.small,
    fontWeight: "700",
    color: Colors.primary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  autoChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  autoChip: {
    backgroundColor: Colors.primaryTint,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  autoChipText: { fontSize: FontSize.caption, fontWeight: "600", color: Colors.primary },
  collapsibleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
  },
  collapsibleBody: { borderTopWidth: 0.5, borderTopColor: Colors.border },
  chevron: { fontSize: FontSize.caption, color: Colors.text.tertiary },
  splitRow: { flexDirection: "row", gap: 8 },
  splitToggle: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: "center",
  },
  splitToggleActive: { borderColor: "#d4a800", backgroundColor: "#fffbe6" },
  splitToggleActiveKnee: { borderColor: "#b06040", backgroundColor: "#fdf2ee" },
  splitToggleText: {
    fontSize: FontSize.caption,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  splitToggleTextActive: { color: "#7a5800" },
  gableBlockHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
  },
  gableToggle: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  gableToggleActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryTint,
  },
  gableToggleText: {
    fontSize: FontSize.small,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  gableToggleTextActive: { color: Colors.primary },
  gableControls: {
    padding: 14,
    paddingTop: 0,
    gap: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
  },
  gableRow: { flexDirection: "row", gap: 14 },
  priceNote: {
    backgroundColor: Colors.primaryTint,
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  priceNoteText: { fontSize: FontSize.small, fontWeight: "600", color: Colors.primary },
  toggleRow: { flexDirection: "row", gap: 6 },
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
    width: 38,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
  },
  unitsBtnText: {
    fontSize: FontSize.sectionTitle,
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
  addOnSection: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    overflow: "hidden",
  },
  addOnSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
  },
  addOnSectionTitle: {
    fontSize: FontSize.body,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  addOnSectionSub: { fontSize: FontSize.caption, color: Colors.text.tertiary, marginTop: 2 },
  addOnChevron: { fontSize: FontSize.caption, color: Colors.text.tertiary },
  addOnList: { borderTopWidth: 1, borderTopColor: Colors.border },
  addOnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  addOnCheck: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  addOnCheckActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  addOnCheckMark: { fontSize: FontSize.small, fontWeight: "700", color: "#fff" },
  addOnRowInfo: { flex: 1, gap: 1 },
  addOnRowName: { fontSize: FontSize.small, fontWeight: "500", color: Colors.text.primary },
  addOnRowPrice: { fontSize: FontSize.small, color: Colors.text.tertiary },
  addOnQtyInput: {
    width: 60,
    backgroundColor: Colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 6,
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.text.primary,
    textAlign: "center",
  },
  addOnRowTotal: { fontSize: FontSize.small, fontWeight: "700", color: Colors.primary },
  addOnInputRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  addOnSep: { fontSize: FontSize.body, fontWeight: "600", color: Colors.text.secondary },
  addOnCalc: { fontSize: FontSize.caption, color: Colors.text.tertiary, fontStyle: "italic" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetTitle: { fontSize: FontSize.label, fontWeight: "700", color: Colors.text.primary },
  sheetSub: { fontSize: FontSize.small, color: Colors.text.tertiary, marginTop: 2 },
  doneBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
  },
  doneBtnText: { fontSize: FontSize.callout, fontWeight: "600", color: "#fff" },
  sheetBody: { padding: 14, paddingBottom: 36, gap: 16 },
  materialsBlock: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 8,
  },
  materialsTitle: {
    fontSize: FontSize.body,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  materialsSub: { fontSize: FontSize.caption, color: Colors.text.tertiary, marginTop: -4 },
  materialsRow: { flexDirection: "row", gap: 16 },
  materialToggle: { flex: 1, gap: 6 },
  materialToggleLabel: {
    fontSize: FontSize.small,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  heightOverrideBlock: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 8,
  },
  overrideHint: { fontSize: FontSize.small, color: Colors.text.tertiary, marginTop: -4 },
  overrideInput: {
    backgroundColor: Colors.surface,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#d4a800",
    padding: 8,
    fontSize: FontSize.callout,
    fontWeight: "600",
    color: Colors.text.primary,
    textAlign: "center",
  },
  doorStyleBlock: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 8,
  },
  doorStyleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  doorStyleBtn: {
    flex: 1,
    minWidth: "45%",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
    gap: 3,
  },
  doorStyleBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryTint,
  },
  doorStyleBtnText: {
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  doorStyleBtnTextActive: { color: Colors.primary },
  doorStyleSplitBadge: {
    fontSize: FontSize.micro,
    fontWeight: "700",
    color: Colors.text.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  gridTitle: { fontSize: FontSize.body, fontWeight: "700", color: Colors.text.primary },
  modalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  modalOption: {
    width: "30%",
    flexGrow: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    padding: 12,
    alignItems: "center",
    gap: 10,
    position: "relative",
  },
  modalOptionSelected: { borderColor: "#e8621a", backgroundColor: "#FFF4EE" },
  modalPreview: {
    width: 52,
    height: 110,
    backgroundColor: FRAME_COLOR,
    borderRadius: 4,
    overflow: "hidden",
    flexDirection: "column",
  },
  previewSection: { alignItems: "center", justifyContent: "center" },
  previewDivider: { height: 4, backgroundColor: FRAME_COLOR, flexShrink: 0 },
  modalOptionLabel: {
    fontSize: FontSize.caption,
    fontWeight: "500",
    color: Colors.text.secondary,
    textAlign: "center",
    lineHeight: 17,
  },
  modalOptionLabelSel: { color: "#e8621a", fontWeight: "700" },
  checkBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#e8621a",
    alignItems: "center",
    justifyContent: "center",
  },
  checkBadgeText: { fontSize: FontSize.caption, fontWeight: "700", color: "#fff" },
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
    backgroundColor: Colors.primaryTint,
  },
});
