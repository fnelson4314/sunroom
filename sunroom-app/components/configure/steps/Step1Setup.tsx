import FieldLabel from "@/components/ui/FieldLabel";
import OptionChip from "@/components/ui/OptionChip";
import OptionGrid from "@/components/ui/OptionGrid";
import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { inToCeilFt, inToFtLabel } from "@/hooks/useConfigureState";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { stepStyles } from "./stepStyles";
import type { ConfigureApi } from "./types";

type Props = {
  configure: ConfigureApi;
  productLines: any[];
};

export default function Step1Setup({ configure, productLines }: Props) {
  const roofStyle = configure.state.roofStyle;
  const showMountHeight =
    roofStyle === "gable" ||
    roofStyle === "studio" ||
    (roofStyle === "roof_only" && configure.state.roofOnlySubStyle !== null);
  const isRoofOnly = roofStyle === "roof_only";

  return (
    <View style={stepStyles.stepContent}>
      <Text style={stepStyles.stepTitle}>Project Setup</Text>

      <FieldLabel
        label="Product Line"
        hint="Determines the wall system for this project"
      />
      <OptionGrid>
        {productLines.map((pl) => (
          <OptionChip
            key={pl.id}
            label={pl.product_name}
            description={pl.description}
            selected={configure.state.selectedProductLine?.id === pl.id}
            onPress={() =>
              configure.setProductLine({
                id: pl.id,
                product_name: pl.product_name,
                description: pl.description,
                wall_system: pl.wall_system,
              })
            }
          />
        ))}
      </OptionGrid>

      <FieldLabel label="Roof Style" />
      <OptionGrid>
        {(
          [
            { value: "studio", label: "Studio / Single" },
            { value: "gable", label: "Gable" },
            { value: "under_existing", label: "Under Existing" },
            { value: "roof_only", label: "Roof Only" },
          ] as const
        ).map((roof) => (
          <OptionChip
            key={roof.value}
            label={roof.label}
            selected={configure.state.roofStyle === roof.value}
            onPress={() => configure.setRoofStyle(roof.value)}
          />
        ))}
      </OptionGrid>

      {/* Roof-only sub-style: gable or studio/single */}
      {isRoofOnly && (
        <View style={stepStyles.fieldBlock}>
          <FieldLabel
            label="Roof Shape"
            hint="Choose the shape of the roof being installed"
          />
          <OptionGrid>
            {(
              [
                { value: "studio", label: "Studio / Single" },
                { value: "gable", label: "Gable" },
              ] as const
            ).map((sub) => (
              <OptionChip
                key={sub.value}
                label={sub.label}
                selected={configure.state.roofOnlySubStyle === sub.value}
                onPress={() => configure.setRoofOnlySubStyle(sub.value)}
              />
            ))}
          </OptionGrid>

          {/* Roof dimensions — inputs in inches, priced as ceil-ft, no overhang */}
          <FieldLabel
            label="Roof Dimensions"
            hint="Enter in inches — converted to ceiling feet for pricing, no overhang added"
          />
          <View style={styles.roofDimsRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.roofDimLabel}>Width (in)</Text>
              <TextInput
                style={stepStyles.textInput}
                value={configure.state.roofOnlyWidthIn}
                onChangeText={configure.setRoofOnlyWidthIn}
                placeholder="e.g. 240"
                placeholderTextColor={Colors.text.tertiary}
                keyboardType="decimal-pad"
              />
              {!!configure.state.roofOnlyWidthIn && (
                <Text style={styles.roofDimConvert}>
                  = {inToFtLabel(configure.state.roofOnlyWidthIn)} ft
                </Text>
              )}
            </View>
            <Text style={styles.roofDimSep}>×</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.roofDimLabel}>Depth (in)</Text>
              <TextInput
                style={stepStyles.textInput}
                value={configure.state.roofOnlyDepthIn}
                onChangeText={configure.setRoofOnlyDepthIn}
                placeholder="e.g. 144"
                placeholderTextColor={Colors.text.tertiary}
                keyboardType="decimal-pad"
              />
              {!!configure.state.roofOnlyDepthIn && (
                <Text style={styles.roofDimConvert}>
                  = {inToFtLabel(configure.state.roofOnlyDepthIn)} ft
                </Text>
              )}
            </View>
            {configure.state.roofOnlyWidthIn && configure.state.roofOnlyDepthIn && (
              <View style={styles.roofDimResult}>
                <Text style={styles.roofDimResultText}>
                  {inToCeilFt(configure.state.roofOnlyWidthIn) *
                    inToCeilFt(configure.state.roofOnlyDepthIn)}{" "}
                  sq ft
                </Text>
              </View>
            )}
          </View>

          {/* Wall height + mount height side by side */}
          <View style={[styles.roofDimsRow, { marginTop: 4 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.roofDimLabel}>Wall Height (in)</Text>
              <TextInput
                style={stepStyles.textInput}
                value={configure.state.roofOnlyWallHeightIn}
                onChangeText={configure.setRoofOnlyWallHeightIn}
                placeholder="e.g. 96"
                placeholderTextColor={Colors.text.tertiary}
                keyboardType="decimal-pad"
              />
              {!!configure.state.roofOnlyWallHeightIn && (
                <Text style={styles.roofDimConvert}>
                  = {inToFtLabel(configure.state.roofOnlyWallHeightIn)} ft
                </Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.roofDimLabel}>Mount Height (in)</Text>
              <TextInput
                style={stepStyles.textInput}
                value={configure.state.mountHeight}
                onChangeText={configure.setMountHeight}
                placeholder="e.g. 132"
                placeholderTextColor={Colors.text.tertiary}
                keyboardType="decimal-pad"
              />
              {!!configure.state.mountHeight && (
                <Text style={styles.roofDimConvert}>
                  = {inToFtLabel(configure.state.mountHeight)} ft
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Mount height — gable and studio only (roof_only has its own inline input above) */}
      {showMountHeight && configure.state.roofStyle !== "roof_only" && (
        <View style={stepStyles.fieldBlock}>
          <FieldLabel
            label="Mount Height (in)"
            hint={
              roofStyle === "gable" || configure.state.roofOnlySubStyle === "gable"
                ? "Total height from ground to the peak of the gable"
                : "Total height from ground to the top edge of the wing glass"
            }
          />
          <TextInput
            style={stepStyles.textInput}
            value={configure.state.mountHeight}
            onChangeText={configure.setMountHeight}
            placeholder="e.g. 132"
            placeholderTextColor={Colors.text.tertiary}
            keyboardType="decimal-pad"
          />
          {!!configure.state.mountHeight && (
            <Text style={styles.roofDimConvert}>
              = {inToFtLabel(configure.state.mountHeight)} ft
            </Text>
          )}
        </View>
      )}

      {/* Number of walls — hidden for roof_only */}
      {!isRoofOnly && (
        <View>
          <FieldLabel label="Number of Walls" />
          <View style={styles.wallCountRow}>
            {([1, 2, 3] as const).map((n) => (
              <Pressable
                key={n}
                style={[
                  styles.wallCountCard,
                  configure.state.numberOfWalls === n && styles.wallCountCardSelected,
                ]}
                onPress={() => configure.setNumberOfWalls(n)}
              >
                <Text
                  style={[
                    styles.wallCountNumber,
                    configure.state.numberOfWalls === n && styles.wallCountNumberSelected,
                  ]}
                >
                  {n}
                </Text>
                <Text style={styles.wallCountLabel}>{n === 1 ? "wall" : "walls"}</Text>
              </Pressable>
            ))}
          </View>

          {(configure.state.numberOfWalls === 2 || configure.state.numberOfWalls === 3) && (
            <View style={[stepStyles.fieldBlock, { marginTop: 12 }]}>
              <FieldLabel
                label="Walls to Render"
                hint={
                  configure.state.numberOfWalls === 3
                    ? "All 3 walls are priced; choose which 2 the camera sees"
                    : "Which two walls of the sunroom"
                }
              />
              <OptionGrid>
                {(["AB", "BC"] as const).map((combo) => (
                  <OptionChip
                    key={combo}
                    label={combo === "AB" ? "A + B" : "B + C"}
                    description={combo === "AB" ? "Left side + Front" : "Front + Right side"}
                    selected={configure.state.wallCombo === combo}
                    onPress={() => configure.setWallCombo(combo)}
                  />
                ))}
              </OptionGrid>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wallCountRow: { flexDirection: "row", gap: 10 },
  wallCountCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 4,
  },
  wallCountCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryTint,
  },
  wallCountNumber: {
    fontSize: FontSize.displayLarge,
    fontWeight: "700",
    color: Colors.text.secondary,
  },
  wallCountNumberSelected: { color: Colors.primary },
  wallCountLabel: { fontSize: FontSize.small, color: Colors.text.tertiary },
  roofDimsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  roofDimLabel: {
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.text.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  roofDimSep: {
    fontSize: FontSize.title,
    fontWeight: "300",
    color: Colors.text.tertiary,
    marginTop: 20,
  },
  roofDimConvert: {
    fontSize: FontSize.small,
    color: Colors.text.tertiary,
    textAlign: "center",
    fontStyle: "italic",
    marginTop: 2,
  },
  roofDimResult: {
    backgroundColor: Colors.primaryTint,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 20,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  roofDimResultText: {
    fontSize: FontSize.body,
    fontWeight: "700",
    color: Colors.primary,
  },
});
