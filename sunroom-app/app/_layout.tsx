import { Colors } from "@/constants/Colors";
import { DesignSessionProvider } from "@/contexts/DesignSession";
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <DesignSessionProvider>
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: Colors.background,
          },
          headerTintColor: Colors.text.primary,
          headerShadowVisible: false,
          headerTitleAlign: "center",
          contentStyle: {
            backgroundColor: Colors.background,
          },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="camera" options={{ title: "Take Photo" }} />
        <Stack.Screen
          name="configure"
          options={{ title: "Configure", headerLeft: () => null }}
        />
        <Stack.Screen
          name="generate"
          options={{ title: "Generating", headerLeft: () => null }}
        />
        <Stack.Screen
          name="editor"
          options={{ title: "Design Editor", headerLeft: () => null }}
        />
        <Stack.Screen name="quote" options={{ title: "Quote" }} />
        <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </DesignSessionProvider>
  );
}
