import { statusColor, statusLabel } from "@/constants/Status";
import { FontSize } from "@/constants/Typography";
import { StyleSheet, Text, View } from "react-native";

export default function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <View style={[styles.badge, { backgroundColor: color + "20" }]}>
      <Text style={[styles.text, { color }]}>{statusLabel(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  text: { fontSize: FontSize.body, fontWeight: "600" },
});
