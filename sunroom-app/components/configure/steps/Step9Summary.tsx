import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { type Option } from "@/hooks/useConfigureState";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { stepStyles } from "./stepStyles";
import type { ConfigureApi } from "./types";

type Props = {
  configure: ConfigureApi;
  allOptions: Option[];
};

export default function Step9Summary({ configure, allOptions }: Props) {
  const grandTotal = configure.calculateTotal(allOptions);
  // Rendered from buildPriceBreakdown — the SAME list the quote/PDF uses. This
  // screen used to re-derive its own lines from state.walls, which meant screen
  // rooms (whose walls live in state.screenRoom.walls) showed an empty breakdown
  // under a non-zero total, and any pricing rule added to the shared builder
  // silently failed to appear here (user 2026-08-15).
  const lineItems = configure.buildPriceBreakdown(allOptions);

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

      {lineItems.length === 0 && (
        <Text style={styles.emptyNote}>
          Nothing priced yet — add wall dimensions and options.
        </Text>
      )}

      {lineItems.map((item, i) => (
        <View key={`${item.name}-${i}`} style={styles.summaryLine}>
          <Text style={styles.summaryLineName}>
            {item.name}
            {!!item.detail && (
              <>
                {"\n"}
                <Text
                  style={{
                    fontSize: FontSize.body,
                    color: Colors.text.tertiary,
                  }}
                >
                  {item.detail}
                </Text>
              </>
            )}
          </Text>
          <Text style={styles.summaryLineValue}>
            ${item.amount.toLocaleString()}
          </Text>
        </View>
      ))}

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
  emptyNote: {
    fontSize: FontSize.body,
    color: Colors.text.tertiary,
    paddingVertical: 12,
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
