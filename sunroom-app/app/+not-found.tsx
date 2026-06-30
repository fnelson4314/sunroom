import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Screen not found</Text>
      <Link href="/" style={styles.link}>
        Go back home
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: FontSize.title,
    fontWeight: "600",
    color: Colors.text.primary,
    marginBottom: 16,
  },
  link: {
    fontSize: FontSize.label,
    color: Colors.primary,
  },
});
