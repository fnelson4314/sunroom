import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type Props = {
  name: string;
  unitPrice: number;
  unitType: string;
  isChecked: boolean;
  quantity: string;
  onToggle: () => void;
  onQuantityChange: (value: string) => void;
};

const formatUnitType = (unitType: string): string => {
  const labels: Record<string, string> = {
    sq_ft: "sq ft",
    lin_ft: "lin ft",
    each: "each",
    per_step: "per step",
    per_job: "per job",
    per_room: "per room",
    per_ft: "per ft",
    hour: "hour",
  };
  return labels[unitType] || unitType;
};

export default function LineItemRow({
  name,
  unitPrice,
  unitType,
  isChecked,
  quantity,
  onToggle,
  onQuantityChange,
}: Props) {
  const isSqFt = unitType === "sq_ft";
  const isLinFt = unitType === "lin_ft";

  // sq_ft sub-inputs (in inches)
  const [sqW, setSqW] = useState("");
  const [sqL, setSqL] = useState("");

  // lin_ft sub-inputs (in inches)
  const [linA, setLinA] = useState("");
  const [linB, setLinB] = useState("");
  const [linC, setLinC] = useState("");

  // Inputs are in inches. Convert to ceiling feet for pricing.
  // sq ft: ceil(W_in / 12) × ceil(L_in / 12)
  const handleSqChange = (w: string, l: string) => {
    const wFt = Math.ceil((parseFloat(w) || 0) / 12);
    const lFt = Math.ceil((parseFloat(l) || 0) / 12);
    const result = wFt * lFt;
    onQuantityChange(result > 0 ? String(result) : "");
  };

  // lin ft: ceil(sum of all inches / 12)
  const handleLinChange = (a: string, b: string, c: string) => {
    const totalIn =
      (parseFloat(a) || 0) + (parseFloat(b) || 0) + (parseFloat(c) || 0);
    const result = totalIn > 0 ? Math.ceil(totalIn / 12) : 0;
    onQuantityChange(result > 0 ? String(result) : "");
  };

  const lineTotal = isChecked ? unitPrice * (parseFloat(quantity) || 0) : 0;

  return (
    <View style={[styles.container, isChecked && styles.containerChecked]}>
      {/* Top row */}
      <Pressable style={styles.topRow} onPress={onToggle}>
        <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
          {isChecked && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <View style={styles.nameBlock}>
          <Text style={[styles.name, isChecked && styles.nameChecked]}>
            {name}
          </Text>
          <Text style={styles.unitPrice}>
            ${unitPrice.toLocaleString()} / {formatUnitType(unitType)}
          </Text>
        </View>
        {isChecked && quantity !== "" && (
          <Text style={styles.lineTotal}>${lineTotal.toLocaleString()}</Text>
        )}
      </Pressable>

      {/* Quantity inputs — only when checked */}
      {isChecked && (
        <View style={styles.quantityRow}>
          {isSqFt && (
            <>
              <TextInput
                style={styles.quantityInput}
                value={sqW}
                onChangeText={(v) => {
                  setSqW(v);
                  handleSqChange(v, sqL);
                }}
                keyboardType="decimal-pad"
                placeholder="Width in"
                placeholderTextColor={Colors.text.tertiary}
              />
              <Text style={styles.unitLabel}>×</Text>
              <TextInput
                style={styles.quantityInput}
                value={sqL}
                onChangeText={(v) => {
                  setSqL(v);
                  handleSqChange(sqW, v);
                }}
                keyboardType="decimal-pad"
                placeholder="Length in"
                placeholderTextColor={Colors.text.tertiary}
              />
              <Text style={styles.unitLabel}>
                {quantity ? `= ${quantity} sq ft` : "= sq ft"}
              </Text>
            </>
          )}

          {isLinFt && (
            <>
              <TextInput
                style={styles.quantityInput}
                value={linA}
                onChangeText={(v) => {
                  setLinA(v);
                  handleLinChange(v, linB, linC);
                }}
                keyboardType="decimal-pad"
                placeholder="in"
                placeholderTextColor={Colors.text.tertiary}
              />
              <Text style={styles.unitLabel}>+</Text>
              <TextInput
                style={styles.quantityInput}
                value={linB}
                onChangeText={(v) => {
                  setLinB(v);
                  handleLinChange(linA, v, linC);
                }}
                keyboardType="decimal-pad"
                placeholder="in"
                placeholderTextColor={Colors.text.tertiary}
              />
              <Text style={styles.unitLabel}>+</Text>
              <TextInput
                style={styles.quantityInput}
                value={linC}
                onChangeText={(v) => {
                  setLinC(v);
                  handleLinChange(linA, linB, v);
                }}
                keyboardType="decimal-pad"
                placeholder="in"
                placeholderTextColor={Colors.text.tertiary}
              />
              <Text style={styles.unitLabel}>
                {quantity ? `= ${quantity} lin ft` : "= lin ft"}
              </Text>
            </>
          )}

          {!isSqFt && !isLinFt && (
            <>
              <Text style={styles.quantityLabel}>Quantity:</Text>
              <TextInput
                style={styles.quantityInput}
                value={quantity}
                onChangeText={onQuantityChange}
                keyboardType="decimal-pad"
                placeholder=""
                placeholderTextColor={Colors.text.tertiary}
                autoFocus={quantity === ""}
              />
              <Text style={styles.unitLabel}>{formatUnitType(unitType)}</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 8,
  },
  containerChecked: {
    borderColor: Colors.primary,
    backgroundColor: "#F5F7FF",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkmark: {
    color: Colors.white,
    fontSize: FontSize.body,
    fontWeight: "700",
    lineHeight: 18,
  },
  nameBlock: { flex: 1, gap: 2 },
  name: {
    fontSize: FontSize.body,
    fontWeight: "500",
    color: Colors.text.primary,
    lineHeight: 20,
  },
  nameChecked: { color: Colors.primary, fontWeight: "600" },
  unitPrice: { fontSize: FontSize.caption, color: Colors.text.tertiary },
  lineTotal: {
    fontSize: FontSize.callout,
    fontWeight: "700",
    color: Colors.status.complete,
    flexShrink: 0,
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
  },
  quantityLabel: {
    fontSize: FontSize.small,
    color: Colors.text.secondary,
    fontWeight: "500",
  },
  quantityInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: FontSize.callout,
    fontWeight: "600",
    color: Colors.text.primary,
    minWidth: 72,
    textAlign: "center",
  },
  unitLabel: { fontSize: FontSize.small, color: Colors.text.secondary },
});
