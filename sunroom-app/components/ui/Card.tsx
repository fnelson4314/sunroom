import { Colors } from "@/constants/Colors";
import { StyleSheet, View, ViewProps } from "react-native";

type Props = ViewProps & {
  // Upgrades the hairline border to the blue "in-progress" treatment (e.g. a
  // saved draft) — per DESIGN.md, state is shown via border, not elevation.
  active?: boolean;
};

// DESIGN.md's card recipe: flat, 12px radius, hairline border, no shadow at
// rest. The one card primitive every screen's ad hoc card style should sit on.
export default function Card({ active, style, children, ...rest }: Props) {
  return (
    <View style={[styles.card, active && styles.active, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.border,
    gap: 8,
  },
  active: {
    borderColor: Colors.primary,
    borderWidth: 1.5,
  },
});
