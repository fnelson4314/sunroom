import FlowNav from "@/components/FlowNav";
import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { useDesignSession } from "@/contexts/DesignSession";
import { getRefineStatus, refineRender } from "@/services/api";
import { confirmLeave } from "@/utils/confirm";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export default function EditorScreen() {
  const {
    sessionId,
    renderUrl,
    renderUrls,
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
    draftId: string;
    box_x1: string;
    box_y1: string;
    box_x2: string;
    box_y2: string;
    totalPrice: string;
    priceBreakdown: string;
  }>();

  const navigation = useNavigation();
  const { reachStep, setDraftId, setLastRender, lastRender, photoUri } =
    useDesignSession();

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: () => <FlowNav current={3} /> });
  }, [navigation]);

  // The set of renders to choose from. Prefer the variations array; fall back to
  // the single render_url so older flows keep working.
  const initialUrls = useMemo<string[]>(() => {
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

  // Held in state, not derived: a change request APPENDS a new version, and the
  // gallery has to show it without leaving the screen.
  const [urls, setUrls] = useState<string[]>(initialUrls);

  // Mark Design reached and keep the shared session pointed at this render so the
  // back-nav menu can return here / go to Quote. Don't clobber a real render key
  // set by the generator (only fill in when the context has nothing yet).
  useEffect(() => {
    reachStep(2);
    if (draftId) setDraftId(draftId);
    if (!lastRender && sessionId && urls.length > 0) {
      setLastRender({ key: "", sessionId, renderUrls: urls });
    }
  }, []);

  const isGallery = urls.length > 1;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const [containerWidth, setContainerWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const selectedUrl = urls[selectedIndex] ?? renderUrl ?? null;

  // ─── Follow-up change request ─────────────────────────────────────────────
  // The salesperson describes a small change in their own words and the current
  // render is edited in place ("make the kneewall match the house"). Feeding the
  // RENDER back in — rather than re-generating from the composite — keeps
  // everything already correct and moves only what was asked.
  const [changeText, setChangeText] = useState("");
  const [refining, setRefining] = useState(false);
  // Shown INLINE, not via Alert.alert — react-native-web ignores it (see
  // utils/confirm.ts), so a failed request looked like nothing happening at all.
  const [changeError, setChangeError] = useState<string | null>(null);

  // Poll handle so leaving the screen mid-change doesn't leave a timer running.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const requestChange = async () => {
    const text = changeText.trim();
    if (!text || refining || !sessionId || !selectedUrl) return;
    setRefining(true);
    setChangeError(null);
    try {
      // Queue it, then poll — the edit is a full image-model call (~2 min) and a
      // held-open request that long is lost to a phone locking or a tab sleeping.
      await refineRender({
        session_id: sessionId,
        request: text,
        // Chain from whichever version is on screen, so changes stack.
        source_render_url: selectedUrl,
      });
      setChangeText("");

      const before = urls.length;
      const started = Date.now();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const st = await getRefineStatus(sessionId);
          const done =
            st.refine_status === "complete" ||
            (st.render_urls?.length ?? 0) > before;
          if (done) {
            if (pollRef.current) clearInterval(pollRef.current);
            const next = st.render_urls?.length ? st.render_urls : urls;
            setUrls(next);
            setSelectedIndex(next.length - 1);
            setLastRender({ key: "", sessionId, renderUrls: next });
            setRefining(false);
          } else if (st.refine_status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setChangeError(st.error || "Could not apply that change");
            setRefining(false);
          } else if (Date.now() - started > 6 * 60 * 1000) {
            // Safety valve — never spin forever.
            if (pollRef.current) clearInterval(pollRef.current);
            setChangeError(
              "This is taking unusually long. Reopen the design shortly to see if it applied.",
            );
            setRefining(false);
          }
        } catch {
          // A dropped poll is not a failure — the job keeps running.
        }
      }, 4000);
    } catch (e: any) {
      setChangeError(
        e?.response?.data?.detail ?? e?.message ?? "Could not start that change",
      );
      setRefining(false);
    }
  };

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
        totalPrice,
        priceBreakdown,
      },
    });
  };

  const handleReconfigure = () => {
    router.replace({
      pathname: "/configure",
      params: {
        box_x1: box_x1 ?? "0",
        box_y1: box_y1 ?? "0",
        box_x2: box_x2 ?? "1",
        box_y2: box_y2 ?? "1",
        draftId: draftId ?? "",
      },
    });
  };

  const handleNewDesign = () => {
    confirmLeave(
      "Start a new design? This design is saved in your sessions — you can reopen it from the home screen anytime.",
      () => router.dismissAll(),
      { title: "Start a new design?", confirmText: "New Design" },
    );
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

        {/* Follow-up change request — edits the render on screen in place. */}
        <View style={styles.changeBox}>
          <Text style={styles.changeLabel}>Request a change</Text>
          <Text style={styles.changeHint}>
            Describe one small change in plain words — it edits the design you're
            viewing and keeps it as a new version.
          </Text>
          <View style={styles.changeRow}>
            <TextInput
              style={styles.changeInput}
              value={changeText}
              onChangeText={setChangeText}
              placeholder="e.g. make the kneewall siding match the house"
              placeholderTextColor={Colors.text.tertiary}
              editable={!refining}
              maxLength={300}
              multiline
            />
            <Pressable
              style={[
                styles.changeButton,
                (!changeText.trim() || refining) && styles.buttonDisabled,
              ]}
              onPress={requestChange}
              disabled={!changeText.trim() || refining}
            >
              {refining ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.changeButtonText}>Apply</Text>
              )}
            </Pressable>
          </View>
          {refining && (
            <Text style={styles.changeHint}>
              Applying your change — this can take a minute or two.
            </Text>
          )}
          {!!changeError && (
            <Text style={styles.changeError}>{changeError}</Text>
          )}
        </View>

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
  changeBox: {
    marginTop: 4,
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    gap: 8,
  },
  changeLabel: {
    fontSize: FontSize.label,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  changeHint: { fontSize: FontSize.small, color: Colors.text.secondary },
  changeRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  changeInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 90,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    color: Colors.text.primary,
    fontSize: FontSize.body,
  },
  changeButton: {
    minWidth: 88,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
  },
  buttonDisabled: { opacity: 0.4 },
  changeError: { fontSize: FontSize.small, color: Colors.status.failed },
  changeButtonText: {
    fontSize: FontSize.label,
    fontWeight: "600",
    color: Colors.white,
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
