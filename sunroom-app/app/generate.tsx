import { Colors } from "@/constants/Colors";
import {
  cancelGeneration,
  createSession,
  getGenerationStatus,
  startGeneration,
  uploadHousePhoto,
} from "@/services/api";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

// How often to poll for generation status in ms
const POLL_INTERVAL = 4000;

type GenerateStatus =
  | "uploading"
  | "creating_session"
  | "queued"
  | "generating"
  | "complete"
  | "failed";

const STATUS_MESSAGES: Record<GenerateStatus, string> = {
  uploading: "Uploading house photo...",
  creating_session: "Saving your configuration...",
  queued: "Your design is queued...",
  generating: "AI is generating your sunroom...",
  complete: "Your design is ready!",
  failed: "Generation failed",
};

const STATUS_HINTS: Record<GenerateStatus, string> = {
  uploading: "This only takes a moment",
  creating_session: "Almost there",
  queued: "Usually starts within 10 seconds",
  generating: "This typically takes 20-60 seconds",
  complete: "Tap below to view your design",
  failed: "Something went wrong — you can try again",
};

export default function GenerateScreen() {
  const params = useLocalSearchParams<{
    photoUri: string;
    box_x1: string;
    box_y1: string;
    box_x2: string;
    box_y2: string;
    draftId: string;
    productLineId: string;
    selectedOptions: string;
    wallData: string;
    lineItems: string;
    wallAddOns: string;
    roofAddOns: string;
    roofStyle: string;
    wallSystem: string;
    roofColorNote: string;
    wallColor: string;
    wall_corners: string;
    mountHeight: string;
    projectionDistance: string;
    roofOnlySubStyle: string;
    customerName: string;
    customerEmail: string;
    notes: string;
    widthFt: string;
    depthFt: string;
    heightFt: string;
    totalPrice: string;
    priceBreakdown: string;
  }>();

  const [status, setStatus] = useState<GenerateStatus>("uploading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ref to hold poll interval so we can clear it
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleCancel = useCallback(async () => {
    if (!sessionId) {
      router.back();
      return;
    }
    try {
      await cancelGeneration(sessionId);
    } catch (e) {
      console.warn("Cancel request failed:", e);
    } finally {
      router.back();
    }
  }, [sessionId]);

  // Intercept Android hardware back button
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleCancel();
      return true; // prevent default back behavior
    });
    return () => sub.remove();
  }, [handleCancel]);

  // Cancel if component unmounts (covers web/iPad swipe back)
  useEffect(() => {
    return () => {
      if (sessionId && status !== "complete" && status !== "failed") {
        cancelGeneration(sessionId).catch(() => {});
      }
    };
  }, []);

  // ─── Cleanup polling on unmount ───────────────────────────

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ─── Start the pipeline on mount ─────────────────────────

  useEffect(() => {
    startPipeline();
  }, []);

  // ─── Main pipeline ────────────────────────────────────────

  const startPipeline = async () => {
    try {
      // Parse the wall data to get dimensions
      const wallData = JSON.parse(params.wallData || "[]");
      const wallB = wallData.find((w: any) => w.id === "B");
      const sideWall = wallData.find((w: any) => w.id === "A" || w.id === "C");

      // Step 1 — Upload the house photo
      setStatus("uploading");
      const tempSessionId = `temp-${Date.now()}`;
      const photoUrl = await uploadHousePhoto(params.photoUri, tempSessionId);

      // Step 2 — Create the session in the database
      setStatus("creating_session");
      const session = await createSession({
        product_line_id: params.productLineId,
        selected_options: JSON.parse(params.selectedOptions || "[]"),
        width_ft: parseFloat(wallB?.widthFt || "0") || undefined,
        depth_ft:
          parseFloat(sideWall?.widthFt || params.projectionDistance || "0") ||
          undefined,
        height_ft: parseFloat(wallB?.heightFt || "0") || undefined,
        total_price: parseFloat(params.totalPrice || "0") || undefined,
        customer_name: params.customerName || undefined,
        customer_email: params.customerEmail || undefined,
        salesperson_id: "dev-salesperson-1",
        notes: params.notes || undefined,
      });

      const newSessionId = session.id;
      setSessionId(newSessionId);

      // Step 3 — Fire the AI generation
      setStatus("queued");
      console.log(
        "startGeneration payload:",
        JSON.stringify(
          {
            session_id: newSessionId,
            house_photo_url: photoUrl,
            selected_options: JSON.parse(params.selectedOptions || "[]"),
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
            roof_only_sub_style: params.roofOnlySubStyle || null,
            wall_corners: params.wall_corners || "",
          },
          null,
          2,
        ),
      );
      await startGeneration({
        session_id: newSessionId,
        house_photo_url: photoUrl,
        selected_options: JSON.parse(params.selectedOptions || "[]"),
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
        roof_only_sub_style: params.roofOnlySubStyle || null,
        wall_corners: params.wall_corners || "",
      });

      // Step 4 — Start polling for status
      startPolling(newSessionId);
    } catch (e: any) {
      setStatus("failed");
      setErrorMessage(e?.message || "Something went wrong");
    }
  };

  // ─── Polling ──────────────────────────────────────────────

  const startPolling = (id: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const result = await getGenerationStatus(id);

        if (result.status === "complete") {
          clearInterval(pollRef.current!);
          setRenderUrl(result.render_url);
          setStatus("complete");
        } else if (result.status === "failed") {
          clearInterval(pollRef.current!);
          setStatus("failed");
          setErrorMessage("The AI generation failed. Please try again.");
        } else if (result.status === "generating") {
          setStatus("generating");
        } else if (result.status === "queued") {
          setStatus("queued");
        }
      } catch (e) {
        // Don't fail on a single poll error — keep trying
        console.warn("Poll error:", e);
      }
    }, POLL_INTERVAL);
  };

  // ─── Navigate to editor ───────────────────────────────────

  const handleViewDesign = () => {
    router.replace({
      pathname: "/editor",
      params: {
        sessionId,
        renderUrl,
        photoUri: params.photoUri as string,
        draftId: params.draftId as string,
        box_x1: params.box_x1 as string,
        box_y1: params.box_y1 as string,
        box_x2: params.box_x2 as string,
        box_y2: params.box_y2 as string,
        totalPrice: params.totalPrice as string, // add
        priceBreakdown: params.priceBreakdown as string, // add
      },
    });
  };

  // ─── Retry ────────────────────────────────────────────────

  const handleRetry = () => {
    setStatus("uploading");
    setErrorMessage(null);
    setSessionId(null);
    setRenderUrl(null);
    startPipeline();
  };

  // ─── Render ───────────────────────────────────────────────

  const isLoading = status !== "complete" && status !== "failed";

  return (
    <View style={styles.container}>
      {/* House photo as background — blurred feel */}
      {params.photoUri && (
        <Image
          source={{ uri: params.photoUri }}
          style={styles.backgroundPhoto}
          blurRadius={8}
        />
      )}

      {/* Dark overlay */}
      <View style={styles.overlay} />

      {/* Content */}
      <View style={styles.content}>
        {/* Cancel button — always visible during generation */}
        {isLoading && (
          <Pressable style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>✕ Cancel</Text>
          </Pressable>
        )}
        {/* Status icon area */}
        <View style={styles.iconArea}>
          {isLoading && <ActivityIndicator size="large" color={Colors.white} />}
          {status === "complete" && <Text style={styles.successIcon}>✓</Text>}
          {status === "failed" && <Text style={styles.failIcon}>✕</Text>}
        </View>

        {/* Status message */}
        <Text style={styles.statusMessage}>{STATUS_MESSAGES[status]}</Text>
        <Text style={styles.statusHint}>
          {errorMessage || STATUS_HINTS[status]}
        </Text>

        {/* Progress steps */}
        <View style={styles.progressSteps}>
          {/* Lines layer — sits behind everything */}
          <View style={styles.linesLayer}>
            {[0, 1, 2, 3].map((i) => {
              const steps: GenerateStatus[] = [
                "uploading",
                "creating_session",
                "queued",
                "generating",
                "complete",
              ];
              const currentIndex = steps.indexOf(status);
              const isDone = i < currentIndex || status === "complete";
              return (
                <View
                  key={i}
                  style={[
                    styles.progressLine,
                    isDone && styles.progressLineDone,
                  ]}
                />
              );
            })}
          </View>

          {/* Dots and labels layer */}
          <View style={styles.dotsLayer}>
            {(
              [
                { key: "uploading", label: "Upload photo" },
                { key: "creating_session", label: "Save config" },
                { key: "queued", label: "Queue job" },
                { key: "generating", label: "Generate" },
                { key: "complete", label: "Done" },
              ] as const
            ).map((step) => {
              const steps: GenerateStatus[] = [
                "uploading",
                "creating_session",
                "queued",
                "generating",
                "complete",
              ];
              const currentIndex = steps.indexOf(status);
              const stepIndex = steps.indexOf(step.key);
              const isDone = stepIndex < currentIndex || status === "complete";
              const isCurrent = step.key === status && status !== "complete";

              return (
                <View key={step.key} style={styles.progressStep}>
                  <View
                    style={[
                      styles.progressDot,
                      isDone && styles.progressDotDone,
                      isCurrent && styles.progressDotCurrent,
                      status === "failed" &&
                        isCurrent &&
                        styles.progressDotFailed,
                    ]}
                  >
                    {isDone && <Text style={styles.progressDotCheck}>✓</Text>}
                  </View>
                  <Text
                    style={[
                      styles.progressLabel,
                      (isDone || isCurrent) && styles.progressLabelActive,
                    ]}
                  >
                    {step.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Action buttons */}
        {status === "complete" && (
          <Pressable style={styles.primaryButton} onPress={handleViewDesign}>
            <Text style={styles.primaryButtonText}>View Your Design →</Text>
          </Pressable>
        )}

        {status === "failed" && (
          <View style={styles.buttonRow}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => router.back()}
            >
              <Text style={styles.secondaryButtonText}>← Go Back</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={handleRetry}>
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  backgroundPhoto: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.4,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  iconArea: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  successIcon: {
    fontSize: 48,
    color: Colors.status.complete,
  },
  failIcon: {
    fontSize: 48,
    color: Colors.status.failed,
  },
  statusMessage: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.white,
    textAlign: "center",
  },
  statusHint: {
    fontSize: 15,
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
    marginTop: -8,
  },
  progressSteps: {
    width: "100%",
    marginTop: 24,
    marginBottom: 32,
    position: "relative",
  },
  progressStep: {
    alignItems: "center",
    flex: 1,
  },
  linesLayer: {
    position: "absolute",
    top: 13,
    left: "10%",
    right: "10%",
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 0,
  },
  dotsLayer: {
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 1,
  },
  progressDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  progressDotDone: {
    backgroundColor: Colors.status.complete,
    borderColor: Colors.status.complete,
  },
  progressDotCurrent: {
    borderColor: Colors.white,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  progressDotFailed: {
    borderColor: Colors.status.failed,
    backgroundColor: Colors.status.failed,
  },
  progressDotCheck: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  progressLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.55)",
    marginTop: 5,
    textAlign: "center",
    width: 58,
  },
  progressLabelActive: {
    color: "rgba(255,255,255,0.95)",
    fontWeight: "600",
  },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginHorizontal: 2,
  },
  progressLineDone: {
    backgroundColor: Colors.status.complete,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 14,
    minWidth: 200,
    alignItems: "center",
  },
  primaryButtonText: {
    color: Colors.white,
    fontSize: 17,
    fontWeight: "700",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  secondaryButton: {
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  secondaryButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "600",
  },
  cancelButton: {
    position: "absolute",
    top: 56,
    left: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.3)",
    zIndex: 10,
  },
  cancelButtonText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "600",
  },
});
