import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { StyleSheet, Text, View } from "react-native";

// Replaces configure.tsx's documented fragile spacing hack (fieldHint used a
// -8 negative margin that only worked because the parent happened to supply
// gap:12) with a real, self-contained gap between label and hint.
export default function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  label: {
    fontSize: FontSize.body,
    fontWeight: "700",
    color: Colors.text.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  hint: { fontSize: FontSize.small, color: Colors.text.tertiary },
});
