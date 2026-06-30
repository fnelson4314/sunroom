import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";

export default function EditorScreen() {
  const {
    sessionId,
    renderUrl,
    renderUrls,
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
    renderUrls: string;
    photoUri: string;
    draftId: string;
    box_x1: string;
    box_y1: string;
    box_x2: string;
    box_y2: string;
    totalPrice: string;
    priceBreakdown: string;
  }>();

  // The set of renders to choose from. Prefer the variations array; fall back to
  // the single render_url so older flows keep working.
  const urls = useMemo<string[]>(() => {
    let list: string[] = [];
    try {
      const parsed = JSON.parse(renderUrls || "[]");
      if (Array.isArray(parsed)) list = parsed.filter(Boolean);
    } catch {
      // ignore — fall through to single
    }
    if (list.length === 0 && renderUrl) list = [renderUrl];
    return list;
  }, [renderUrls, renderUrl]);

  const isGallery = urls.length > 1;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const [containerWidth, setContainerWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const selectedUrl = urls[selectedIndex] ?? renderUrl ?? null;

  const markFailed = (i: number) =>
    setFailed((prev) => (prev[i] ? prev : { ...prev, [i]: true }));

  const selectIndex = (i: number) => {
    setSelectedIndex(i);
    if (containerWidth > 0) {
      scrollRef.current?.scrollTo({ x: i * containerWidth, animated: true });
    }
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (containerWidth <= 0) return;
    const idx = Math.round(e.nativeEvent.contentOffset.x / containerWidth);
    if (idx !== selectedIndex) setSelectedIndex(idx);
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out this sunroom design! View it here: ${selectedUrl}`,
        url: selectedUrl ?? undefined,
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
        renderUrl: selectedUrl ?? "",
        photoUri,
        totalPrice,
        priceBreakdown,
      },
    });
  };

  const handleReconfigure = () => {
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

  // A single render filling the available area, with graceful fallback.
  const renderImageAt = (i: number, width?: number) => {
    const url = urls[i];
    if (url && !failed[i]) {
      return (
        <Image
          source={{ uri: url }}
          style={width != null ? { width, height: "100%" } : styles.renderImage}
          resizeMode="contain"
          onError={() => markFailed(i)}
        />
      );
    }
    return (
      <View style={[styles.imageFallback, width != null ? { width } : null]}>
        {photoUri ? (
          <Image
            source={{ uri: photoUri }}
            style={styles.renderImage}
            resizeMode="contain"
          />
        ) : (
          <Text style={styles.fallbackText}>Render not available</Text>
        )}
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>
            This render could not be loaded.
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View
        style={styles.imageContainer}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        {isGallery ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumEnd}
            style={styles.swiper}
          >
            {urls.map((_, i) => (
              <View
                key={i}
                style={{ width: containerWidth || undefined, height: "100%" }}
              >
                {renderImageAt(i, containerWidth || undefined)}
              </View>
            ))}
          </ScrollView>
        ) : (
          renderImageAt(0)
        )}

        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>

        <View style={styles.renderBadge}>
          <Text style={styles.renderBadgeText}>AI Generated Design</Text>
        </View>

        {isGallery && (
          <>
            <View style={styles.counter}>
              <Text style={styles.counterText}>
                {selectedIndex + 1} / {urls.length}
              </Text>
            </View>
            <View style={styles.dots}>
              {urls.map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i === selectedIndex && styles.dotActive]}
                />
              ))}
            </View>
          </>
        )}
      </View>

      {isGallery && (
        <View style={styles.filmstrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filmstripContent}
          >
            {urls.map((url, i) => (
              <Pressable
                key={i}
                onPress={() => selectIndex(i)}
                style={[
                  styles.thumb,
                  i === selectedIndex && styles.thumbSelected,
                ]}
              >
                {url && !failed[i] ? (
                  <Image
                    source={{ uri: url }}
                    style={styles.thumbImage}
                    resizeMode="cover"
                    onError={() => markFailed(i)}
                  />
                ) : (
                  <View style={styles.thumbFallback}>
                    <Text style={styles.thumbFallbackText}>!</Text>
                  </View>
                )}
                <View style={styles.thumbIndexBadge}>
                  <Text style={styles.thumbIndexText}>{i + 1}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Your Sunroom Design</Text>
        <Text style={styles.panelSubtitle}>
          {isGallery
            ? "Swipe or tap a thumbnail to compare the AI variations. The one you're viewing is used for the quote and share."
            : "Review the design below. You can tweak the configuration, generate a quote, or share with the customer."}
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
  swiper: { flex: 1 },
  renderImage: { width: "100%", height: "100%" },
  imageFallback: {
    flex: 1,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: {
    color: Colors.text.tertiary,
    fontSize: FontSize.callout,
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
  errorBannerText: { color: Colors.white, fontSize: FontSize.small, textAlign: "center" },
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
  backButtonText: { color: Colors.white, fontSize: FontSize.callout, fontWeight: "600" },
  renderBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "rgba(10,74,159,0.85)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  renderBadgeText: { color: Colors.white, fontSize: FontSize.body, fontWeight: "600" },
  counter: {
    position: "absolute",
    bottom: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  counterText: { color: Colors.white, fontSize: FontSize.body, fontWeight: "700" },
  dots: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  dotActive: { backgroundColor: Colors.white, width: 9, height: 9, borderRadius: 5 },
  filmstrip: {
    backgroundColor: "#111",
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
  },
  filmstripContent: { padding: 10, gap: 10 },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "#222",
  },
  thumbSelected: { borderColor: Colors.primary },
  thumbImage: { width: "100%", height: "100%" },
  thumbFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#333",
  },
  thumbFallbackText: { color: Colors.text.tertiary, fontSize: FontSize.title, fontWeight: "700" },
  thumbIndexBadge: {
    position: "absolute",
    top: 3,
    left: 3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbIndexText: { color: Colors.white, fontSize: FontSize.caption, fontWeight: "700" },
  panel: {
    backgroundColor: Colors.surface,
    padding: 20,
    paddingBottom: 36,
    gap: 12,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
  },
  panelTitle: { fontSize: FontSize.title, fontWeight: "700", color: Colors.text.primary },
  panelSubtitle: {
    fontSize: FontSize.body,
    color: Colors.text.secondary,
    lineHeight: 20,
    marginTop: -6,
  },
  primaryActions: { marginTop: 4 },
  primaryButton: {
    backgroundColor: Colors.primary,
    padding: 17,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: { color: Colors.white, fontSize: FontSize.subhead, fontWeight: "700" },
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
  secondaryButtonIcon: { fontSize: FontSize.heading, color: Colors.text.primary },
  secondaryButtonText: {
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  disclaimer: {
    fontSize: FontSize.small,
    color: Colors.text.tertiary,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 4,
  },
});
