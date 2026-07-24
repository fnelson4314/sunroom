import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

interface SaveDraftModalProps {
  visible: boolean;
  initialName: string;
  isSaving: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export default function SaveDraftModal({
  visible,
  initialName,
  isSaving,
  onSave,
  onCancel,
}: SaveDraftModalProps) {
  const [name, setName] = useState(initialName);

  // Sync when modal opens with a new initialName
  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel} />

      <View style={styles.centerWrap} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.title}>Save Configuration</Text>
          <Text style={styles.sub}>
            Give this configuration a name so you can find it later.
          </Text>

          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Smith Residence — 3-season gable"
            placeholderTextColor={Colors.text.tertiary}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => name.trim() && onSave(name.trim())}
          />

          <View style={styles.buttons}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onCancel}
              disabled={isSaving}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.saveBtn,
                (!name.trim() || isSaving) && styles.btnDisabled,
              ]}
              onPress={() => name.trim() && onSave(name.trim())}
              disabled={!name.trim() || isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.saveText}>Save & Exit</Text>
              )}
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
  // Flex-centered instead of a fixed-pixel translate, so the card stays
  // centered at any viewport size instead of assuming an exact 400x240 card.
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 20,
  },
  title: {
    fontSize: FontSize.heading,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  sub: {
    fontSize: FontSize.body,
    color: Colors.text.secondary,
    marginTop: -6,
  },
  input: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: 12,
    fontSize: FontSize.label,
    color: Colors.text.primary,
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  cancelText: {
    fontSize: FontSize.callout,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  saveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: "center",
  },
  saveText: {
    fontSize: FontSize.callout,
    fontWeight: "700",
    color: Colors.white,
  },
  btnDisabled: { opacity: 0.4 },
});
