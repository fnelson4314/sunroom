import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { useDesignSession } from "@/contexts/DesignSession";
import {
  previewComposite,
  uploadHousePhoto,
  type PreviewFit,
} from "@/services/api";
import { confirmLeave } from "@/utils/confirm";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

// Module scope so they survive this screen unmounting: Preview → Back to the
// configurator → Preview again with nothing composite-affecting changed reuses
// the render instead of hitting the 3D renderer (and re-uploading) again. The
// key is the exact payload, so ANY change that would alter the composite misses.
let compositeCache: {
  key: string;
  url: string;
  photoUrl: string;
  fit: PreviewFit | null;
} | null = null;
let photoCache: { uri: string; url: string } | null = null;

/**
 * Pre-generation check: renders the 3D composite ONLY (no AI, no credits) so the
 * salesperson and customer can confirm the configured structure sits correctly
 * on the house before spending a generation.
 *
 * Back returns to the still-mounted configurator, so every configuration value
 * survives untouched — this screen owns no config state of its own and passes
 * the exact params it received straight through to /generate.
 */
export default function PreviewScreen() {
  const params = useLocalSearchParams<Record<string, string>>();
  const { lastRender, photoUri } = useDesignSession();
  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);
  const [fit, setFit] = useState<PreviewFit | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError(null);
      setCompositeUrl(null);

      // Everything the composite depends on except the uploaded photo URL
      // (derived from photoUri, which is keyed in below).
      const config = {
        box_x1: parseFloat(params.box_x1),
        box_y1: parseFloat(params.box_y1),
        box_x2: parseFloat(params.box_x2),
        box_y2: parseFloat(params.box_y2),
        wall_data: params.wallData || "",
        wall_system: params.wallSystem || "",
        roof_style: params.roofStyle || "",
        wall_color: params.wallColor || "white",
        mount_height: params.mountHeight || "",
        projection_distance: params.projectionDistance || "",
        include_gable_wings: params.includeGableWings !== "false",
        wall_combo: params.wallCombo || null,
        wall_corners: params.wall_corners || "",
        screen_options: params.screenOptions || "",
      };
      const key = JSON.stringify({ photoUri, ...config });

      // Nothing that affects the composite changed → show the one we already
      // rendered. "Try again" (attempt > 0) always re-renders.
      if (attempt === 0 && compositeCache?.key === key) {
        setPhotoUrl(compositeCache.photoUrl);
        setFit(compositeCache.fit);
        setCompositeUrl(compositeCache.url);
        return;
      }

      try {
        const url =
          (photoCache?.uri === photoUri ? photoCache.url : "") ||
          (await uploadHousePhoto(photoUri, `preview-${Date.now()}`));
        photoCache = { uri: photoUri, url };
        if (!cancelled) setPhotoUrl(url);

        const composite = await previewComposite({
          house_photo_url: url,
          ...config,
        });
        compositeCache = {
          key,
          url: composite.url,
          photoUrl: url,
          fit: composite.fit,
        };
        if (!cancelled) {
          setFit(composite.fit);
          setCompositeUrl(composite.url);
        }
      } catch (e: any) {
        if (!cancelled)
          setError(
            e?.response?.data?.detail ??
              e?.message ??
              "Could not build the preview",
          );
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Two different ways a capture goes wrong, both invisible in the composite:
  //
  //   1. The footprint disagrees with the markers — no camera can align the box,
  //      so the solver rolls it and the whole render leans.
  //   2. The two TOP markers disagree with each other. The three ground markers
  //      are height-independent, so they still fit perfectly while the tops pull
  //      in opposite directions; the solver splits the difference and the box
  //      TWISTS. Tell-tale: a low ground error next to a high mean, and a solved
  //      wall height nothing like the configured one (the solver ignores the
  //      typed height on purpose — the clicked points place the corners).
  //
  // Case 2 is the one that looks like a mystery: the numbers are all correct and
  // the picture is still crooked. It reads as a config bug for as long as nobody
  // is told the markers are the problem.
  const fitWarning = (() => {
    if (!fit) return null;
    const { configuredFt: c, drawnFt: d, configuredHeightFt: ch } = fit;
    const heightOff = Math.abs(fit.solvedHeightFt - ch);
    const topsDisagree =
      ch > 0 &&
      (heightOff > Math.max(1.5, ch * 0.2) ||
        fit.reprojErr > fit.groundErr * 3);

    if (topsDisagree) {
      return (
        `The plotted TOP points imply a ${fit.solvedHeightFt}ft wall, but this ` +
        `room is configured at ${ch}ft. The ground points fit ` +
        `(${fit.groundErr}px) while the overall fit is ${fit.reprojErr}px — the ` +
        `two top corners disagree with each other, so the structure twists. ` +
        `Re-plot the two top points.`
      );
    }
    if (fit.reprojErr > 30) {
      const refitted = c.side !== d.side || c.front !== d.front;
      return (
        `Configured ${c.front}ft x ${c.side}ft (${fit.reprojErr}px off the markers). ` +
        (refitted
          ? `Drawn at ${d.front}ft x ${d.side}ft to fit the photo. `
          : "") +
        "Re-check the wall dimensions, or re-plot the points on the photo."
      );
    }
    return null;
  })();

  // This is the step that actually spends AI credits, so the "replaces your
  // existing render" confirmation lives here rather than back on the
  // configurator (getting to this screen is free).
  const goGenerate = () => {
    const push = () =>
      router.push({
        pathname: "/generate",
        // Pass the already-uploaded photo so generate doesn't upload it twice.
        params: { ...params, uploadedPhotoUrl: photoUrl },
      });
    if (lastRender && lastRender.renderUrls.length > 0) {
      confirmLeave(
        "This uses AI credits and replaces your current design render. Generate now?",
        push,
        { title: "Regenerate design?", confirmText: "Generate" },
      );
      return;
    }
    push();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Check the design</Text>
        <Text style={styles.hint}>
          This is the exact structure that will be rendered — check the walls,
          panels, doors and roof line against the house. No AI credits used yet.
        </Text>

        {!compositeUrl && !error && (
          <View style={styles.placeholder}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.placeholderText}>Building 3D preview...</Text>
          </View>
        )}

        {error && (
          <View style={styles.placeholder}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={styles.retryButton}
              onPress={() => setAttempt((a) => a + 1)}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {compositeUrl && (
          <Image
            source={{ uri: compositeUrl }}
            style={styles.image}
            resizeMode="contain"
          />
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>← Edit config</Text>
        </Pressable>
        <Pressable
          style={[styles.generateButton, !compositeUrl && styles.disabled]}
          onPress={goGenerate}
          disabled={!compositeUrl}
        >
          <Text style={styles.generateText}>Looks right — Generate →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 12 },
  title: {
    fontSize: FontSize.title,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  hint: { fontSize: FontSize.body, color: Colors.text.secondary },
  placeholder: {
    height: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  placeholderText: { fontSize: FontSize.body, color: Colors.text.secondary },
  warning: {
    gap: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.status.failed,
    backgroundColor: Colors.surface,
  },
  warningTitle: {
    fontSize: FontSize.body,
    fontWeight: "700",
    color: Colors.status.failed,
  },
  warningText: { fontSize: FontSize.body, color: Colors.text.secondary },
  errorText: {
    fontSize: FontSize.body,
    color: Colors.status.failed,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  retryText: {
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.primary,
  },
  image: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: Colors.surface,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    paddingBottom: 32,
    backgroundColor: Colors.surface,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
  },
  backButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  backText: {
    fontSize: FontSize.label,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  generateButton: {
    flex: 2,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: Colors.primary,
  },
  generateText: {
    fontSize: FontSize.label,
    fontWeight: "600",
    color: Colors.white,
  },
  disabled: { opacity: 0.4 },
});
