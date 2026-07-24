import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

type Props = {
  title: string;
  hint?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

// The one chevron-header expand/collapse idiom (WallBuilder's pre-existing
// "Panel Details" section is the reference), replacing three coexisting
// collapsible implementations across WallBuilder/ScreenRoomBuilder.
export default function Collapsible({ title, hint, expanded, onToggle, children }: Props) {
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={onToggle} activeOpacity={0.7}>
        <View>
          <Text style={styles.label}>{title}</Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
        <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>
      {expanded && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
  },
  label: {
    fontSize: FontSize.small,
    fontWeight: "700",
    color: Colors.text.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  hint: { fontSize: FontSize.caption, color: Colors.text.tertiary },
  chevron: { fontSize: FontSize.caption, color: Colors.text.tertiary },
  body: { borderTopWidth: 0.5, borderTopColor: Colors.border },
});
