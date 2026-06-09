import { Colors } from "@/constants/Colors";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function Modal() {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Modal</Text>
        <Text style={styles.body}>
          This is a modal screen. It slides up from the bottom.
        </Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  body: {
    fontSize: 15,
    color: Colors.text.secondary,
    lineHeight: 22,
  },
  button: {
    backgroundColor: Colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "600",
  },
});
