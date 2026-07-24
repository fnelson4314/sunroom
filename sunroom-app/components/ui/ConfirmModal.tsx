import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type Props = {
  visible: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// The shared RN-Modal shell for rich confirm dialogs (more than a yes/no
// string, so utils/confirm.ts's Alert/window.confirm wrapper doesn't fit).
// Previously each screen hand-rolled its own scrim+card overlay.
export default function ConfirmModal({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.centerWrap} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {typeof body === "string" ? <Text style={styles.body}>{body}</Text> : body}
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={destructive ? styles.destructiveBtn : styles.confirmBtn}
              onPress={onConfirm}
            >
              <Text style={destructive ? styles.destructiveText : styles.confirmText}>
                {confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 20,
  },
  title: { fontSize: FontSize.subhead, fontWeight: "700", color: Colors.text.primary },
  body: { fontSize: FontSize.callout, color: Colors.text.secondary, lineHeight: 22 },
  buttons: { flexDirection: "row", gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: Colors.background,
    borderWidth: 0.5,
    borderColor: Colors.border,
  },
  cancelText: { fontSize: FontSize.label, fontWeight: "600", color: Colors.text.primary },
  confirmBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: Colors.primary,
  },
  confirmText: { fontSize: FontSize.label, fontWeight: "600", color: Colors.white },
  destructiveBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: Colors.status.failed + "15",
    borderWidth: 1,
    borderColor: Colors.status.failed + "40",
  },
  destructiveText: { fontSize: FontSize.label, fontWeight: "600", color: Colors.status.failed },
});
