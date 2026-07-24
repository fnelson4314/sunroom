import SaveDraftModal from "@/components/configure/SaveDraftModal";
import StepIndicator from "@/components/configure/StepIndicator";
import Step1Setup from "@/components/configure/steps/Step1Setup";
import Step5Walls from "@/components/configure/steps/Step5Walls";
import Step6Roof from "@/components/configure/steps/Step6Roof";
import Step9Summary from "@/components/configure/steps/Step9Summary";
import StepLineItems from "@/components/configure/steps/StepLineItems";
import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import FlowNav from "@/components/FlowNav";
import { renderKey, useDesignSession } from "@/contexts/DesignSession";
import type { Option } from "@/hooks/useConfigureState";
import { confirmLeave } from "@/utils/confirm";
import { useConfigureState } from "@/hooks/useConfigureState";
import {
  getFullCatalog,
  loadDraft,
  saveDraft,
  updateDraft,
} from "@/services/api";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// Human-readable label for each absolute step number.
// configure.tsx maps visible steps → labels and passes them to StepIndicator.
const STEP_LABELS_MAP: Record<number, string> = {
  1: "Setup",
  2: "Demo",
  3: "Concrete",
  4: "Deck",
  5: "Walls",
  6: "Roof",
  7: "Electrical",
  8: "Misc",
  9: "Summary",
};

export default function ConfigureScreen() {
  const params = useLocalSearchParams<{
    photoUri: string;
    box_x1: string;
    box_y1: string;
    box_x2: string;
    box_y2: string;
    draftId?: string;
    mountHeight?: string;
    wall_corners?: string;
    preset_wall_count?: string;
    preset_wall_combo?: string;
    preset_roof_style?: string;
    preset_existing_roof?: string;
  }>();

  const [currentStep, setCurrentStep] = useState(1);
  const [allOptions, setAllOptions] = useState<Option[]>([]);
  const [productLines, setProductLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const configure = useConfigureState();
  const navigation = useNavigation();
  const { lastRender, reachStep, setDraftId: setSessionDraftId } =
    useDesignSession();

  // Persists the active wall tab across step navigation so returning to step 5
  // always lands on the last wall the user was editing.
  const [activeWallId, setActiveWallId] = useState<"A" | "B" | "C">("B");

  // Whenever the set of designed walls changes (wall count or AB/BC combo),
  // land on the left-most wall: A for 3-wall or 2-wall AB, B for 2-wall BC/1-wall.
  const wallIdSignature = configure.state.walls.map((w) => w.id).join("");
  useEffect(() => {
    const first = configure.state.walls[0]?.id;
    if (first) setActiveWallId(first);
  }, [wallIdSignature]);

  // Intercept the header back button on step 1 and confirm before discarding.
  // NOTE: react-native-web's Alert.alert ignores custom buttons (it only shows a
  // single OK), so on web the "Discard" callback never fired and Back appeared
  // broken. Use window.confirm on web and the native Alert on iOS/Android.
  const confirmDiscardAndBack = () => {
    const message =
      "Going back will lose all unsaved configuration. Save a draft first if you want to keep your work.";
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm(message)) {
        router.back();
      }
      return;
    }
    Alert.alert("Discard session?", message, [
      { text: "Stay", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <FlowNav current={1} onBeforeNavigate={autoSaveDraft} />
      ),
      headerLeft: () =>
        currentStep === 1 ? (
          <TouchableOpacity
            onPress={confirmDiscardAndBack}
            hitSlop={12}
            style={styles.headerBack}
          >
            <Text style={styles.headerBackIcon}>‹</Text>
          </TouchableOpacity>
        ) : undefined,
    });
  }, [navigation, currentStep]);

  // Mark the configurator reached so the back-nav menu enables it.
  useEffect(() => {
    reachStep(1);
  }, []);

  // Draft state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(params.draftId ?? null);
  const [sessionName, setSessionName] = useState("");
  const [photoUri, setPhotoUri] = useState(params.photoUri ?? "");
  const [boxCoords, setBoxCoords] = useState({
    box_x1: params.box_x1 ?? "0",
    box_y1: params.box_y1 ?? "0",
    box_x2: params.box_x2 ?? "1",
    box_y2: params.box_y2 ?? "1",
  });
  const [wallCorners, setWallCorners] = useState<string>(
    params.wall_corners ?? "",
  );

  // Keep the shared session's draftId in sync so the back-nav menu can route to
  // any screen with the right row.
  useEffect(() => {
    if (draftId) setSessionDraftId(draftId);
  }, [draftId]);

  // ─── Visible step logic ────────────────────────────────────────────────────
  // Step 5 (wall config) is skipped for roof_only (no walls to configure).
  // Step 6 (roof config) is skipped for under_existing (no new roof).

  const getVisibleSteps = (): number[] => {
    const roofStyle = configure.state.roofStyle;
    return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((s) => {
      if (s === 5 && roofStyle === "roof_only") return false;
      if (s === 6 && roofStyle === "under_existing") return false;
      return true;
    });
  };

  // Snap away from hidden steps when roofStyle changes
  useEffect(() => {
    const visible = getVisibleSteps();
    if (!visible.includes(currentStep)) {
      const nearestPrev = [...visible].reverse().find((s) => s < currentStep);
      setCurrentStep(nearestPrev ?? visible[0]);
    }
  }, [configure.state.roofStyle]);

  // ─── Load catalog ──────────────────────────────────────────────────────────
  // Pre-set wall count and combo from camera screen selection
  useEffect(() => {
    const count = parseInt(params.preset_wall_count ?? "");
    if (count === 1 || count === 2 || count === 3) {
      configure.setNumberOfWalls(count);
      // The combo picks which two walls render — applies to 2- AND 3-wall rooms.
      if (
        (count === 2 || count === 3) &&
        (params.preset_wall_combo === "AB" || params.preset_wall_combo === "BC")
      ) {
        configure.setWallCombo(params.preset_wall_combo);
      }
    }
    // Pre-select the roof style from the camera build-type (under-existing).
    if (params.preset_roof_style === "under_existing") {
      configure.setRoofStyle("under_existing");
      if (
        params.preset_existing_roof === "gable" ||
        params.preset_existing_roof === "studio"
      ) {
        configure.setUnderExistingShape(params.preset_existing_roof);
      }
    }
  }, []);

  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const data = await getFullCatalog();
        setAllOptions(data.options);
        setProductLines(data.product_lines);
      } catch (e) {
        setError("Could not load catalog. Is the backend running?");
      } finally {
        setLoading(false);
      }
    };
    fetchCatalog();
  }, []);

  // ─── Load draft state when resuming ───────────────────────────────────────

  useEffect(() => {
    if (!params.draftId || loading) return;
    const fetchDraft = async () => {
      try {
        const draft = await loadDraft(params.draftId!);
        if (draft.draft_state) {
          const meta = draft.draft_state._meta as
            | Record<string, string>
            | undefined;
          // Prefer a photoUri passed in params (the persistent Supabase
          // house_photo_url when reopening a completed session) over the draft's
          // stored _meta.photoUri, which is a local file URI that may be stale.
          if (meta?.photoUri && !params.photoUri) setPhotoUri(meta.photoUri);
          if (meta?.box_x1)
            setBoxCoords({
              box_x1: meta.box_x1,
              box_y1: meta.box_y1,
              box_x2: meta.box_x2,
              box_y2: meta.box_y2,
            });
          // Restore the plotted points (used for generation) unless fresh ones
          // came in as params (e.g. the user just re-plotted on the camera).
          if (meta?.wall_corners && !params.wall_corners)
            setWallCorners(meta.wall_corners);
          configure.hydrateFromDraft(draft.draft_state);
          setSessionName(draft.session_name ?? "");
          setDraftId(draft.id);
        }
      } catch (e) {
        console.warn("Could not load draft:", e);
      }
    };
    fetchDraft();
  }, [params.draftId, loading]);

  // ─── Draft save handler ────────────────────────────────────────────────────

  // Everything the CAMERA screen owns, persisted alongside the config so
  // reopening restores the photo, the box, the plotted points and the capture
  // presets — and so re-plotting points can update the draft without disturbing
  // the wall config (which lives in draft_state, not here).
  const buildMeta = () => ({
    photoUri,
    ...boxCoords,
    wall_corners: wallCorners,
    preset_wall_count: String(configure.state.numberOfWalls ?? ""),
    preset_wall_combo: configure.state.wallCombo ?? "",
    preset_roof_style:
      configure.state.roofStyle === "under_existing" ? "under_existing" : "",
    preset_existing_roof: configure.state.underExistingShape ?? "",
  });

  // Silently persists the current configuration to the draft row, inferring a
  // name the same way Generate's auto-save does. Used before generating and
  // before jumping away via the flow-nav menu, so in-progress edits (line
  // items, customer info, wall config) are never silently lost just because
  // the user hopped to Design/Quote instead of pressing Generate/Save.
  const autoSaveDraft = async (): Promise<string | null> => {
    let activeDraftId = draftId;
    try {
      const state = configure.serializeForDraft();
      const draftState = { ...state, _meta: buildMeta() };
      const name = configure.state.customerName
        ? `${configure.state.customerName} — Draft`
        : sessionName || "Untitled Configuration";
      if (activeDraftId) {
        await updateDraft(activeDraftId, {
          session_name: name,
          draft_state: draftState,
        });
      } else {
        const result = await saveDraft({
          session_name: name,
          salesperson_id: "dev-salesperson-1",
          draft_state: draftState,
        });
        activeDraftId = result.id;
        setDraftId(activeDraftId);
      }
    } catch (e) {
      console.warn("Auto-save failed:", e);
    }
    return activeDraftId;
  };

  const handleSaveDraft = async (name: string) => {
    setIsSavingDraft(true);
    try {
      const state = configure.serializeForDraft();
      const draftState = {
        ...state,
        _meta: buildMeta(),
      };

      if (draftId) {
        await updateDraft(draftId, {
          session_name: name,
          draft_state: draftState,
        });
      } else {
        const result = await saveDraft({
          session_name: name,
          salesperson_id: "dev-salesperson-1",
          draft_state: draftState,
        });
        setDraftId(result.id);
      }

      setSessionName(name);
      setShowSaveModal(false);
      router.replace("/");
    } catch (e: any) {
      console.error("Save draft failed:", e);
      setIsSavingDraft(false);
      alert(
        `Could not save draft: ${e?.message ?? "Unknown error"}. Check that the backend is running.`,
      );
      return;
    }
    setIsSavingDraft(false);
  };

  // ─── Navigation ───────────────────────────────────────────────────────────

  const goNext = () => {
    const visible = getVisibleSteps();
    const idx = visible.indexOf(currentStep);
    if (idx < visible.length - 1) {
      setCurrentStep(visible[idx + 1]);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  const goPrev = () => {
    const visible = getVisibleSteps();
    const idx = visible.indexOf(currentStep);
    if (idx > 0) {
      setCurrentStep(visible[idx - 1]);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  const handleGenerate = async () => {
    if (!configure.canGenerate()) return;

    const activeDraftId = await autoSaveDraft();

    const total = configure.calculateTotal(allOptions);
    const breakdown = configure.buildPriceBreakdown(allOptions);

    const generateParams = configure.buildGenerateParams(
      photoUri,
      boxCoords.box_x1,
      boxCoords.box_y1,
      boxCoords.box_x2,
      boxCoords.box_y2,
    );

    // If the render-affecting inputs are unchanged since the last generation,
    // reuse that render instead of burning another generation — jump straight to
    // the editor. Changing only the customer name/email/notes or pricing line
    // items leaves this key identical, so those edits never re-render.
    const key = renderKey({ ...generateParams, wall_corners: wallCorners });
    if (lastRender && lastRender.key === key && lastRender.renderUrls.length > 0) {
      router.replace({
        pathname: "/editor",
        params: {
          sessionId: lastRender.sessionId,
          renderUrl: lastRender.renderUrls[0],
          renderUrls: JSON.stringify(lastRender.renderUrls),
          photoUri,
          draftId: activeDraftId ?? "",
          box_x1: boxCoords.box_x1,
          box_y1: boxCoords.box_y1,
          box_x2: boxCoords.box_x2,
          box_y2: boxCoords.box_y2,
          totalPrice: String(Math.round(total)),
          priceBreakdown: JSON.stringify(breakdown),
        },
      });
      return;
    }

    const goGenerate = () =>
      router.push({
        pathname: "/generate",
        params: {
          ...generateParams,
          totalPrice: String(Math.round(total)),
          priceBreakdown: JSON.stringify(breakdown),
          draftId: activeDraftId ?? "",
          wall_corners: wallCorners,
          renderKey: key,
        },
      });

    // If there's already a render and the visual inputs changed, warn that this
    // replaces it and uses AI credits (points re-plotted / walls/roof changed).
    // First-ever generation just proceeds.
    if (lastRender && lastRender.renderUrls.length > 0) {
      confirmLeave(
        "Your changes need a new design render, which uses AI credits and replaces the current one. Regenerate now?",
        goGenerate,
        { title: "Regenerate design?", confirmText: "Regenerate" },
      );
      return;
    }
    goGenerate();
  };

  // ─── Loading / error ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading catalog...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  // ─── Step content ─────────────────────────────────────────────────────────
  // Each step is its own component under components/configure/steps/ — this
  // screen keeps owning currentStep/allOptions/productLines/the scroll+footer
  // chrome and just dispatches to the matching step's UI.

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1Setup configure={configure} productLines={productLines} />;

      case 2:
      case 3:
      case 4:
      case 7:
      case 8:
        return (
          <StepLineItems step={currentStep} configure={configure} allOptions={allOptions} />
        );

      case 5:
        return (
          <Step5Walls
            configure={configure}
            allOptions={allOptions}
            activeWallId={activeWallId}
            onActiveWallChange={setActiveWallId}
          />
        );

      case 6:
        return <Step6Roof configure={configure} allOptions={allOptions} />;

      case 9:
        return <Step9Summary configure={configure} allOptions={allOptions} />;

      default:
        return null;
    }
  };

  const total = configure.calculateTotal(allOptions);
  const visibleSteps = getVisibleSteps();
  const currentVisibleIndex = visibleSteps.indexOf(currentStep);
  const isLastStep = currentVisibleIndex === visibleSteps.length - 1;
  const isFirstStep = currentVisibleIndex === 0;
  const visibleStepLabels = visibleSteps.map((s) => STEP_LABELS_MAP[s]);

  return (
    <View style={styles.container}>
      <StepIndicator
        currentStep={currentVisibleIndex + 1}
        totalSteps={visibleSteps.length}
        stepLabels={visibleStepLabels}
        onStepPress={(position) => {
          const step = visibleSteps[position - 1];
          if (step !== undefined) {
            setCurrentStep(step);
            scrollRef.current?.scrollTo({ y: 0, animated: false });
          }
        }}
      />

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {renderStep()}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerTotal}>
          <Text style={styles.footerTotalLabel}>Total</Text>
          <Text style={styles.footerTotalValue}>${total.toLocaleString()}</Text>
        </View>

        <View style={styles.footerButtons}>
          {!isFirstStep && (
            <Pressable style={styles.prevButton} onPress={goPrev}>
              <Text style={styles.prevButtonText}>← Prev</Text>
            </Pressable>
          )}
          {!isLastStep ? (
            <Pressable style={styles.nextButton} onPress={goNext}>
              <Text style={styles.nextButtonText}>Next →</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[
                styles.generateButton,
                !configure.canGenerate() && styles.buttonDisabled,
              ]}
              onPress={handleGenerate}
              disabled={!configure.canGenerate()}
            >
              <Text style={styles.generateButtonText}>Generate →</Text>
            </Pressable>
          )}
        </View>

        <TouchableOpacity
          style={styles.saveDraftButton}
          onPress={() => setShowSaveModal(true)}
        >
          <Text style={styles.saveDraftText}>
            {draftId ? "💾 Update Draft & Exit" : "💾 Save & Exit"}
          </Text>
        </TouchableOpacity>

        {configure.canGenerate() && !isLastStep && (
          <Pressable
            style={styles.generateEarlyButton}
            onPress={handleGenerate}
          >
            <Text style={styles.generateEarlyText}>✦ Generate now</Text>
          </Pressable>
        )}
      </View>

      <SaveDraftModal
        visible={showSaveModal}
        initialName={
          sessionName ||
          (configure.state.customerName
            ? `${configure.state.customerName} — Draft`
            : "Untitled Configuration")
        }
        isSaving={isSavingDraft}
        onSave={handleSaveDraft}
        onCancel={() => setShowSaveModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginLeft: 6,
  },
  headerBackIcon: {
    fontSize: 26,
    lineHeight: 28,
    color: Colors.primary,
    fontWeight: "600",
    marginTop: -3,
    marginLeft: -1,
  },
  container: { flex: 1, backgroundColor: Colors.background },
  centered: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  footer: {
    backgroundColor: Colors.surface,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  footerTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerTotalLabel: {
    fontSize: FontSize.small,
    fontWeight: "600",
    color: Colors.text.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  footerTotalValue: {
    fontSize: FontSize.title,
    fontWeight: "700",
    color: Colors.status.complete,
  },
  footerButtons: { flexDirection: "row", gap: 10 },
  prevButton: {
    flex: 1,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  prevButtonText: {
    fontSize: FontSize.label,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  nextButton: {
    flex: 2,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  nextButtonText: { fontSize: FontSize.label, fontWeight: "600", color: Colors.white },
  generateButton: {
    flex: 2,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  generateButtonText: { fontSize: FontSize.label, fontWeight: "600", color: Colors.white },
  buttonDisabled: { opacity: 0.4 },
  saveDraftButton: {
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  saveDraftText: {
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  generateEarlyButton: {
    backgroundColor: Colors.primaryTint,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  generateEarlyText: { fontSize: FontSize.body, fontWeight: "600", color: Colors.primary },
  loadingText: { fontSize: FontSize.callout, color: Colors.text.secondary },
  errorText: { fontSize: FontSize.label, color: Colors.status.failed, textAlign: "center" },
});
