import { Alert, Platform } from "react-native";

// Cross-platform confirm. react-native-web's Alert.alert ignores custom buttons
// (shows a single OK), so the destructive callback never fires on web — use
// window.confirm there and the native Alert on iOS/Android. Mirrors the pattern
// already in configure.tsx's discard guard.
export function confirmLeave(
  message: string,
  onConfirm: () => void,
  {
    title = "Leave this design?",
    confirmText = "Leave",
  }: { title?: string; confirmText?: string } = {},
) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    if (typeof window !== "undefined" && window.confirm(message)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Stay", style: "cancel" },
    { text: confirmText, style: "destructive", onPress: onConfirm },
  ]);
}
