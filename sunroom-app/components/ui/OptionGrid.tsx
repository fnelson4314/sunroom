import { StyleSheet, View } from "react-native";

// Wrapping row of OptionChips — the wall-count/roof-style/product-line grid
// pattern repeated across the configurator, previously copy-pasted per step.
export default function OptionGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
