import { Colors } from "@/constants/Colors";
import { Stack } from "expo-router";

// This group has a single screen (the home session list), so a Tabs navigator
// just rendered a lone, non-functional "Home" tab with a placeholder chevron at
// the bottom. A Stack gives the same top "Home" header with no dead tab bar.
export default function TabLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: Colors.background,
        },
        headerTintColor: Colors.text.primary,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Home" }} />
    </Stack>
  );
}
