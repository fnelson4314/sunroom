import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import type { SolidMaterial } from "@/hooks/useConfigureState";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";

// Shared solid-panel primitives used by both WallBuilder and ScreenRoomBuilder.
// Previously each file carried its own copy; the two had drifted only in
// imperceptible cosmetics (seam opacity, 1px padding). This is the canonical one.

const VINYL_LINE = "rgba(0,0,0,0.14)";
const HARDI_LINE = "rgba(0,0,0,0.18)";

// Solid material fill: flat panel, or vinyl (4") / hardieboard (8") with
// proportional horizontal seam lines. `areaHeightIn` is the real-world height of
// the filled area in inches (drives seam spacing); `defaultIn` is only used if it
// parses to nothing.
export function SolidFill({
  width,
  height,
  material,
  areaHeightIn,
  baseColor,
  defaultIn = 30,
}: {
  width: number;
  height: number;
  material: SolidMaterial;
  areaHeightIn: string;
  baseColor: string;
  defaultIn?: number;
}) {
  if (material === "panel")
    return <View style={{ width, height, backgroundColor: baseColor }} />;
  const areaH = Math.max(1, parseFloat(areaHeightIn) || defaultIn);
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

// Solid-panel material picker: Solid Panel / Vinyl (4") / Hardieboard (8").
export function SolidStylePicker({
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
