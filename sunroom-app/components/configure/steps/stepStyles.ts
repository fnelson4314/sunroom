import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { StyleSheet } from "react-native";

// The handful of styles every wizard step shares (title, subtotal row, field
// grouping, text input) — pulled out once instead of copy-pasted per step file.
export const stepStyles = StyleSheet.create({
  stepContent: { gap: 12 },
  stepTitle: {
    fontSize: FontSize.sectionTitle,
    fontWeight: "700",
    color: Colors.text.primary,
    marginBottom: 4,
  },
  stepTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stepSubtotal: {
    fontSize: FontSize.label,
    fontWeight: "700",
    color: Colors.status.complete,
  },
  // Wrapper for a group of fields — gives FieldLabel/hint pairs the same
  // vertical rhythm as the top-level stepContent.
  fieldBlock: { gap: 12 },
  textInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    fontSize: FontSize.label,
    color: Colors.text.primary,
  },
  notesInput: { height: 80, textAlignVertical: "top" },
});
