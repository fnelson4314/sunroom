import { Colors } from "@/constants/Colors";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Image, Pressable, Share, StyleSheet, Text, View } from "react-native";

export default function EditorScreen() {
  const {
    sessionId,
    renderUrl,
    photoUri,
    draftId,
    box_x1,
    box_y1,
    box_x2,
    box_y2,
    totalPrice,
    priceBreakdown,
  } = useLocalSearchParams<{
    sessionId: string;
    renderUrl: string;
    photoUri: string;
    draftId: string;
    box_x1: string;
    box_y1: string;
    box_x2: string;
    box_y2: string;
    totalPrice: string; // add
    priceBreakdown: string;
  }>();

  const [imageError, setImageError] = useState(false);

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out this sunroom design! View it here: ${renderUrl}`,
        url: renderUrl,
      });
    } catch (e) {
      // Share sheet dismissed or failed — no alert needed
    }
  };

  const handleGoToQuote = () => {
    router.push({
      pathname: "/quote",
      params: {
        sessionId,
        renderUrl,
        photoUri,
        totalPrice, // add
        priceBreakdown, // add
      },
    });
  };

  const handleReconfigure = () => {
    // Navigate back to configure, reloading the draft that was auto-saved
    // before generation so all options are pre-filled
    router.replace({
      pathname: "/configure",
      params: {
        photoUri: photoUri ?? "",
        box_x1: box_x1 ?? "0",
        box_y1: box_y1 ?? "0",
        box_x2: box_x2 ?? "1",
        box_y2: box_y2 ?? "1",
        draftId: draftId ?? "",
      },
    });
  };

  const handleNewDesign = () => {
    router.dismissAll();
  };

  return (
    <View style={styles.container}>
      <View style={styles.imageContainer}>
        {renderUrl && !imageError ? (
          <Image
            source={{ uri: renderUrl }}
            style={styles.renderImage}
            resizeMode="contain"
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={styles.imageFallback}>
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={styles.renderImage}
                resizeMode="contain"
              />
            ) : (
              <Text style={styles.fallbackText}>Render not available</Text>
            )}
            {imageError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>
                  Render image could not be loaded. Showing original photo.
                </Text>
              </View>
            )}
          </View>
        )}

        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>

        <View style={styles.renderBadge}>
          <Text style={styles.renderBadgeText}>AI Generated Design</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Your Sunroom Design</Text>
        <Text style={styles.panelSubtitle}>
          Review the design below. You can tweak the configuration, generate a
          quote, or share with the customer.
        </Text>

        <View style={styles.primaryActions}>
          <Pressable style={styles.primaryButton} onPress={handleGoToQuote}>
            <Text style={styles.primaryButtonText}>Generate Quote →</Text>
          </Pressable>
        </View>

        <View style={styles.secondaryActions}>
          <Pressable style={styles.secondaryButton} onPress={handleShare}>
            <Text style={styles.secondaryButtonIcon}>↗</Text>
            <Text style={styles.secondaryButtonText}>Share</Text>
          </Pressable>

          <Pressable style={styles.secondaryButton} onPress={handleReconfigure}>
            <Text style={styles.secondaryButtonIcon}>✎</Text>
            <Text style={styles.secondaryButtonText}>Tweak</Text>
          </Pressable>

          <Pressable style={styles.secondaryButton} onPress={handleNewDesign}>
            <Text style={styles.secondaryButtonIcon}>+</Text>
            <Text style={styles.secondaryButtonText}>New</Text>
          </Pressable>
        </View>

        <Text style={styles.disclaimer}>
          * AI renders are approximate visualizations. Final product may vary
          slightly in color and material appearance.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  imageContainer: { flex: 1, position: "relative" },
  renderImage: { width: "100%", height: "100%" },
  imageFallback: { flex: 1, position: "relative" },
  fallbackText: {
    color: Colors.text.tertiary,
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
  },
  errorBanner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(220,38,38,0.8)",
    padding: 10,
  },
  errorBannerText: { color: Colors.white, fontSize: 12, textAlign: "center" },
  backButton: {
    position: "absolute",
    top: 16,
    left: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.2)",
  },
  backButtonText: { color: Colors.white, fontSize: 14, fontWeight: "600" },
  renderBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "rgba(10,74,159,0.85)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  renderBadgeText: { color: Colors.white, fontSize: 13, fontWeight: "600" },
  panel: {
    backgroundColor: Colors.surface,
    padding: 20,
    paddingBottom: 36,
    gap: 12,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
  },
  panelTitle: { fontSize: 20, fontWeight: "700", color: Colors.text.primary },
  panelSubtitle: {
    fontSize: 13,
    color: Colors.text.secondary,
    lineHeight: 18,
    marginTop: -6,
  },
  primaryActions: { marginTop: 4 },
  primaryButton: {
    backgroundColor: Colors.accent,
    padding: 17,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: { color: Colors.white, fontSize: 17, fontWeight: "700" },
  secondaryActions: { flexDirection: "row", gap: 10 },
  secondaryButton: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryButtonIcon: { fontSize: 18, color: Colors.text.primary },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  disclaimer: {
    fontSize: 12,
    color: Colors.text.tertiary,
    textAlign: "center",
    lineHeight: 16,
    marginTop: 4,
  },
});
