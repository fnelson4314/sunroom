import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { Pressable, StyleSheet, Text } from "react-native";

type Props = {
  label: string;
  description?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  // A 2-item decision and a 4+-item decision read identically today (one
  // minWidth for every grid). Size lets a bigger/rarer decision (e.g. product
  // line) read differently from a small binary choice (e.g. a yes/no toggle
  // rendered as chips), without inventing a new visual language per step.
  size?: "compact" | "regular" | "wide";
};

// The Tint + Border selection recipe from DESIGN.md: a tinted background plus
// a matching colored border marks "selected," never color alone.
export default function OptionChip({
  label,
  description,
  selected,
  disabled,
  onPress,
  size = "regular",
}: Props) {
  return (
    <Pressable
      style={[
        styles.card,
        sizeStyles[size],
        selected && styles.selected,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.name, selected && styles.nameSelected]}>{label}</Text>
      {description ? <Text style={styles.desc}>{description}</Text> : null}
    </Pressable>
  );
}

const sizeStyles = StyleSheet.create({
  compact: { minWidth: "31%", padding: 10 },
  regular: { minWidth: "47%", padding: 14 },
  wide: { minWidth: "100%", padding: 14 },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 2,
  },
  selected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryTint,
  },
  disabled: { opacity: 0.4 },
  name: { fontSize: FontSize.callout, fontWeight: "600", color: Colors.text.primary },
  nameSelected: { color: Colors.primary },
  desc: { fontSize: FontSize.body, color: Colors.text.tertiary },
});
