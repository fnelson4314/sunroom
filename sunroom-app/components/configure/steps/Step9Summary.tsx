import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { inToCeilFt, type Option } from "@/hooks/useConfigureState";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { stepStyles } from "./stepStyles";
import type { ConfigureApi } from "./types";

type Props = {
  configure: ConfigureApi;
  allOptions: Option[];
};

export default function Step9Summary({ configure, allOptions }: Props) {
  const grandTotal = configure.calculateTotal(allOptions);
  const checkedLineItems = allOptions.filter(
    (o) => configure.state.lineItems[o.id] !== undefined,
  );
  const checkedRoofAddOns = allOptions.filter(
    (o) => configure.state.roofAddOns[o.id] !== undefined,
  );

  // Display-only breakdown of how the roof's dollar figure (from
  // configure.getRoofCost() — the single source of truth also used by Step 6)
  // was derived; this string never feeds back into the price itself.
  let roofDetail = "";
  if (configure.state.roofType) {
    if (configure.state.roofStyle === "roof_only") {
      const w = inToCeilFt(configure.state.roofOnlyWidthIn);
      const d = inToCeilFt(configure.state.roofOnlyDepthIn);
      roofDetail = `${configure.state.roofOnlyWidthIn}″ × ${configure.state.roofOnlyDepthIn}″ → ${w} × ${d} ft`;
    } else {
      const bWall = configure.state.walls.find((w) => w.id === "B");
      const width = inToCeilFt(bWall?.widthIn || "");
      let depth = 0;
      if (configure.state.numberOfWalls === 1) {
        depth = inToCeilFt(configure.state.projectionDistance);
      } else {
        const sideWall = configure.state.walls.find((w) => w.id === "A" || w.id === "C");
        depth = inToCeilFt(sideWall?.widthIn || "");
      }
      roofDetail = `(${width}+2) × (${depth}+1) ft incl. overhangs`;
    }
  }
  const roofCost = configure.getRoofCost();

  return (
    <View style={stepStyles.stepContent}>
      <Text style={stepStyles.stepTitle}>Customer & Summary</Text>

      <Text style={styles.fieldLabel}>Customer Name</Text>
      <TextInput
        style={stepStyles.textInput}
        value={configure.state.customerName}
        onChangeText={configure.setCustomerName}
        placeholder="Full name"
        placeholderTextColor={Colors.text.tertiary}
        autoCapitalize="words"
      />

      <Text style={styles.fieldLabel}>Email</Text>
      <TextInput
        style={stepStyles.textInput}
        value={configure.state.customerEmail}
        onChangeText={configure.setCustomerEmail}
        placeholder="email@example.com"
        placeholderTextColor={Colors.text.tertiary}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <Text style={styles.fieldLabel}>Notes</Text>
      <TextInput
        style={[stepStyles.textInput, stepStyles.notesInput]}
        value={configure.state.notes}
        onChangeText={configure.setNotes}
        placeholder="Any special requirements..."
        placeholderTextColor={Colors.text.tertiary}
        multiline
        numberOfLines={3}
      />

      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Price Breakdown</Text>

      {configure.state.wallType &&
        configure.state.walls.map((wall) => {
          const wFt = inToCeilFt(wall.widthIn);
          const hFt = inToCeilFt(wall.heightIn);
          const cost = configure.state.wallType!.unit_price * wFt * hFt;
          if (cost === 0) return null;
          return (
            <View key={wall.id} style={styles.summaryLine}>
              <Text style={styles.summaryLineName}>
                Wall {wall.id} — {configure.state.wallType!.name}
              </Text>
              <Text style={styles.summaryLineValue}>${cost.toLocaleString()}</Text>
            </View>
          );
        })}

      {Object.entries(configure.state.wallAddOns).map(([wallId, wallOptions]) =>
        Object.entries(wallOptions).map(([optionId, qty]) => {
          const option = allOptions.find((o) => o.id === optionId);
          if (!option) return null;
          const wall = configure.state.walls.find((w) => w.id === wallId);
          const isArea =
            option.name.toLowerCase().includes("transom glass") ||
            option.name.toLowerCase().includes("kneewall glass");
          const wFt = inToCeilFt(wall?.widthIn || "");
          const hFt = inToCeilFt(wall?.heightIn || "");
          const quantity = isArea ? wFt * hFt : parseFloat(qty) || 0;
          const cost = option.unit_price * quantity;
          if (cost === 0) return null;
          return (
            <View key={`${wallId}-${optionId}`} style={styles.summaryLine}>
              <Text style={styles.summaryLineName}>
                Wall {wallId} — {option.name} × {quantity}{" "}
                {option.unit_type.replace("_", " ")}
              </Text>
              <Text style={styles.summaryLineValue}>${cost.toLocaleString()}</Text>
            </View>
          );
        }),
      )}

      {configure.state.roofType && roofCost > 0 && (
        <View style={styles.summaryLine}>
          <Text style={styles.summaryLineName}>
            Roof — {configure.state.roofType.name}
            {"\n"}
            <Text style={{ fontSize: FontSize.body, color: Colors.text.tertiary }}>
              {roofDetail}
            </Text>
          </Text>
          <Text style={styles.summaryLineValue}>${roofCost.toLocaleString()}</Text>
        </View>
      )}

      {checkedLineItems.map((option) => {
        const qty = parseFloat(configure.getLineItemQuantity(option.id)) || 0;
        const cost = option.unit_price * qty;
        if (cost === 0) return null;
        return (
          <View key={option.id} style={styles.summaryLine}>
            <Text style={styles.summaryLineName}>
              {option.name} × {qty} {option.unit_type.replace("_", " ")}
            </Text>
            <Text style={styles.summaryLineValue}>${cost.toLocaleString()}</Text>
          </View>
        );
      })}

      {checkedRoofAddOns.map((option) => {
        const qty = parseFloat(configure.state.roofAddOns[option.id]) || 0;
        const cost = option.unit_price * qty;
        if (cost === 0) return null;
        return (
          <View key={option.id} style={styles.summaryLine}>
            <Text style={styles.summaryLineName}>
              {option.name} × {qty} {option.unit_type.replace("_", " ")}
            </Text>
            <Text style={styles.summaryLineValue}>${cost.toLocaleString()}</Text>
          </View>
        );
      })}

      <View style={styles.grandTotalRow}>
        <Text style={styles.grandTotalLabel}>Estimated Total</Text>
        <Text style={styles.grandTotalValue}>${grandTotal.toLocaleString()}</Text>
      </View>

      <View style={{ height: 100 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  fieldLabel: {
    fontSize: FontSize.body,
    fontWeight: "700",
    color: Colors.text.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 8,
  },
  summaryLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  summaryLineName: {
    flex: 1,
    fontSize: FontSize.body,
    color: Colors.text.secondary,
    paddingRight: 8,
  },
  summaryLineValue: {
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 16,
    marginTop: 8,
  },
  grandTotalLabel: {
    fontSize: FontSize.label,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  grandTotalValue: {
    fontSize: FontSize.sectionTitle,
    fontWeight: "700",
    color: Colors.status.complete,
  },
});
