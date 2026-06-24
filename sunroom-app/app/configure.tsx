import LineItemRow from "@/components/configure/LineItemRow";
import SaveDraftModal from "@/components/configure/SaveDraftModal";
import ScreenRoomBuilder from "@/components/configure/ScreenRoomBuilder";
import StepIndicator from "@/components/configure/StepIndicator";
import WallBuilder, {
  FEATURE_OPTION_KEYWORDS,
  PANEL_TYPES,
} from "@/components/configure/WallBuilder";
import { Colors } from "@/constants/Colors";
import type { Option } from "@/hooks/useConfigureState";
import { inToCeilFt, useConfigureState } from "@/hooks/useConfigureState";
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
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const STEP_CATEGORIES: Record<number, string> = {
  2: "demo",
  3: "concrete",
  4: "deck",
  7: "electrical",
  8: "miscellaneous",
};

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
  }>();

  const [currentStep, setCurrentStep] = useState(1);
  const [allOptions, setAllOptions] = useState<Option[]>([]);
  const [productLines, setProductLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const configure = useConfigureState();
  const navigation = useNavigation();

  // Persists the active wall tab across step navigation so returning to step 5
  // always lands on the last wall the user was editing.
  const [activeWallId, setActiveWallId] = useState<"A" | "B" | "C">("B");

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
      headerLeft: () =>
        currentStep === 1 ? (
          <TouchableOpacity
            onPress={confirmDiscardAndBack}
            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
          >
            <Text style={{ fontSize: 17, color: Colors.primary }}>‹ Back</Text>
          </TouchableOpacity>
        ) : undefined,
    });
  }, [navigation, currentStep]);

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
  const [wallCorners] = useState<string>(params.wall_corners ?? "");

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
      if (
        count === 2 &&
        (params.preset_wall_combo === "AB" || params.preset_wall_combo === "BC")
      ) {
        configure.setWallCombo(params.preset_wall_combo);
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
          if (meta?.photoUri) setPhotoUri(meta.photoUri);
          if (meta?.box_x1)
            setBoxCoords({
              box_x1: meta.box_x1,
              box_y1: meta.box_y1,
              box_x2: meta.box_x2,
              box_y2: meta.box_y2,
            });
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

  const handleSaveDraft = async (name: string) => {
    setIsSavingDraft(true);
    try {
      const state = configure.serializeForDraft();
      const draftState = {
        ...state,
        _meta: { photoUri, ...boxCoords },
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

    let activeDraftId = draftId;
    try {
      const state = configure.serializeForDraft();
      const draftState = { ...state, _meta: { photoUri, ...boxCoords } };
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
      console.warn("Auto-save before generate failed:", e);
    }

    const total = configure.calculateTotal(allOptions);
    const breakdown = configure.buildPriceBreakdown(allOptions);

    const generateParams = configure.buildGenerateParams(
      photoUri,
      boxCoords.box_x1,
      boxCoords.box_y1,
      boxCoords.box_x2,
      boxCoords.box_y2,
    );

    router.push({
      pathname: "/generate",
      params: {
        ...generateParams,
        totalPrice: String(Math.round(total)),
        priceBreakdown: JSON.stringify(breakdown),
        draftId: activeDraftId ?? "",
        wall_corners: wallCorners,
      },
    });
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

  const renderStep = () => {
    switch (currentStep) {
      case 1: {
        const roofStyle = configure.state.roofStyle;
        const showMountHeight =
          roofStyle === "gable" ||
          roofStyle === "studio" ||
          (roofStyle === "roof_only" &&
            configure.state.roofOnlySubStyle !== null);
        const isRoofOnly = roofStyle === "roof_only";

        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Project Setup</Text>

            <Text style={styles.fieldLabel}>Product Line</Text>
            <Text style={styles.fieldHint}>
              Determines the wall system for this project
            </Text>
            <View style={styles.optionGrid}>
              {productLines.map((pl) => {
                const isSelected =
                  configure.state.selectedProductLine?.id === pl.id;
                return (
                  <Pressable
                    key={pl.id}
                    style={[
                      styles.optionCard,
                      isSelected && styles.optionCardSelected,
                    ]}
                    onPress={() =>
                      configure.setProductLine({
                        id: pl.id,
                        product_name: pl.product_name,
                        description: pl.description,
                        wall_system: pl.wall_system,
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.optionName,
                        isSelected && styles.optionNameSelected,
                      ]}
                    >
                      {pl.product_name}
                    </Text>
                    {pl.description && (
                      <Text style={styles.optionDesc}>{pl.description}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Roof Style</Text>
            <View style={styles.optionGrid}>
              {(
                [
                  { value: "studio", label: "Studio / Single" },
                  { value: "gable", label: "Gable" },
                  { value: "under_existing", label: "Under Existing" },
                  { value: "roof_only", label: "Roof Only" },
                ] as const
              ).map((roof) => (
                <Pressable
                  key={roof.value}
                  style={[
                    styles.optionCard,
                    configure.state.roofStyle === roof.value &&
                      styles.optionCardSelected,
                  ]}
                  onPress={() => configure.setRoofStyle(roof.value)}
                >
                  <Text
                    style={[
                      styles.optionName,
                      configure.state.roofStyle === roof.value &&
                        styles.optionNameSelected,
                    ]}
                  >
                    {roof.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Roof-only sub-style: gable or studio/single */}
            {isRoofOnly && (
              <View>
                <Text style={styles.fieldLabel}>Roof Shape</Text>
                <Text style={styles.fieldHint}>
                  Choose the shape of the roof being installed
                </Text>
                <View style={styles.optionGrid}>
                  {(
                    [
                      { value: "studio", label: "Studio / Single" },
                      { value: "gable", label: "Gable" },
                    ] as const
                  ).map((sub) => (
                    <Pressable
                      key={sub.value}
                      style={[
                        styles.optionCard,
                        configure.state.roofOnlySubStyle === sub.value &&
                          styles.optionCardSelected,
                      ]}
                      onPress={() => configure.setRoofOnlySubStyle(sub.value)}
                    >
                      <Text
                        style={[
                          styles.optionName,
                          configure.state.roofOnlySubStyle === sub.value &&
                            styles.optionNameSelected,
                        ]}
                      >
                        {sub.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Roof dimensions — inputs in inches, priced as ceil-ft, no overhang */}
                <Text style={[styles.fieldLabel, { marginTop: 12 }]}>
                  Roof Dimensions
                </Text>
                <Text style={styles.fieldHint}>
                  Enter in inches — converted to ceiling feet for pricing, no
                  overhang added
                </Text>
                <View style={styles.roofDimsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roofDimLabel}>Width (in)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={configure.state.roofOnlyWidthIn}
                      onChangeText={configure.setRoofOnlyWidthIn}
                      placeholder="e.g. 240"
                      placeholderTextColor={Colors.text.tertiary}
                      keyboardType="decimal-pad"
                    />
                    {!!configure.state.roofOnlyWidthIn && (
                      <Text style={styles.roofDimConvert}>
                        = {inToCeilFt(configure.state.roofOnlyWidthIn)} ft
                      </Text>
                    )}
                  </View>
                  <Text style={styles.roofDimSep}>×</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roofDimLabel}>Depth (in)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={configure.state.roofOnlyDepthIn}
                      onChangeText={configure.setRoofOnlyDepthIn}
                      placeholder="e.g. 144"
                      placeholderTextColor={Colors.text.tertiary}
                      keyboardType="decimal-pad"
                    />
                    {!!configure.state.roofOnlyDepthIn && (
                      <Text style={styles.roofDimConvert}>
                        = {inToCeilFt(configure.state.roofOnlyDepthIn)} ft
                      </Text>
                    )}
                  </View>
                  {configure.state.roofOnlyWidthIn &&
                    configure.state.roofOnlyDepthIn && (
                      <View style={styles.roofDimResult}>
                        <Text style={styles.roofDimResultText}>
                          {inToCeilFt(configure.state.roofOnlyWidthIn) *
                            inToCeilFt(configure.state.roofOnlyDepthIn)}{" "}
                          sq ft
                        </Text>
                      </View>
                    )}
                </View>

                {/* Wall height + mount height side by side */}
                <View style={[styles.roofDimsRow, { marginTop: 4 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roofDimLabel}>Wall Height (in)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={configure.state.roofOnlyWallHeightIn}
                      onChangeText={configure.setRoofOnlyWallHeightIn}
                      placeholder="e.g. 96"
                      placeholderTextColor={Colors.text.tertiary}
                      keyboardType="decimal-pad"
                    />
                    {!!configure.state.roofOnlyWallHeightIn && (
                      <Text style={styles.roofDimConvert}>
                        = {inToCeilFt(configure.state.roofOnlyWallHeightIn)} ft
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roofDimLabel}>Mount Height (in)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={configure.state.mountHeight}
                      onChangeText={configure.setMountHeight}
                      placeholder="e.g. 132"
                      placeholderTextColor={Colors.text.tertiary}
                      keyboardType="decimal-pad"
                    />
                    {!!configure.state.mountHeight && (
                      <Text style={styles.roofDimConvert}>
                        = {inToCeilFt(configure.state.mountHeight)} ft
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* Mount height — gable and studio only (roof_only has its own inline input above) */}
            {showMountHeight && configure.state.roofStyle !== "roof_only" && (
              <View>
                <Text style={styles.fieldLabel}>Mount Height (ft)</Text>
                <Text style={styles.fieldHint}>
                  {roofStyle === "gable" ||
                  configure.state.roofOnlySubStyle === "gable"
                    ? "Total height from ground to the peak of the gable"
                    : "Total height from ground to the top edge of the wing glass"}
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={configure.state.mountHeight}
                  onChangeText={configure.setMountHeight}
                  placeholder="e.g. 11"
                  placeholderTextColor={Colors.text.tertiary}
                  keyboardType="decimal-pad"
                />
              </View>
            )}

            {/* Number of walls — hidden for roof_only */}
            {!isRoofOnly && (
              <View>
                <Text style={styles.fieldLabel}>Number of Walls</Text>
                <View style={styles.wallCountRow}>
                  {([1, 2, 3] as const).map((n) => (
                    <Pressable
                      key={n}
                      style={[
                        styles.wallCountCard,
                        configure.state.numberOfWalls === n &&
                          styles.wallCountCardSelected,
                      ]}
                      onPress={() => configure.setNumberOfWalls(n)}
                    >
                      <Text
                        style={[
                          styles.wallCountNumber,
                          configure.state.numberOfWalls === n &&
                            styles.wallCountNumberSelected,
                        ]}
                      >
                        {n}
                      </Text>
                      <Text style={styles.wallCountLabel}>
                        {n === 1 ? "wall" : "walls"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {configure.state.numberOfWalls === 2 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.fieldLabel}>Wall Position</Text>
                    <Text style={styles.fieldHint}>
                      Which two walls of the sunroom
                    </Text>
                    <View style={styles.optionGrid}>
                      {(["AB", "BC"] as const).map((combo) => (
                        <Pressable
                          key={combo}
                          style={[
                            styles.optionCard,
                            configure.state.wallCombo === combo &&
                              styles.optionCardSelected,
                          ]}
                          onPress={() => configure.setWallCombo(combo)}
                        >
                          <Text
                            style={[
                              styles.optionName,
                              configure.state.wallCombo === combo &&
                                styles.optionNameSelected,
                            ]}
                          >
                            {combo === "AB" ? "A + B" : "B + C"}
                          </Text>
                          <Text style={styles.optionDesc}>
                            {combo === "AB"
                              ? "Left side + Front"
                              : "Front + Right side"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        );
      }

      case 2:
      case 3:
      case 4:
      case 7:
      case 8: {
        const category = STEP_CATEGORIES[currentStep];
        const categoryOptions =
          currentStep === 4
            ? allOptions.filter(
                (o) => o.category === "deck" || o.category === "deck_options",
              )
            : allOptions.filter((o) => o.category === category);

        const stepTotal = categoryOptions
          .filter((o) => configure.isLineItemChecked(o.id))
          .reduce((sum, o) => {
            const qty = parseFloat(configure.getLineItemQuantity(o.id)) || 0;
            return sum + o.unit_price * qty;
          }, 0);

        const stepTitles: Record<number, string> = {
          2: "Demolition",
          3: "Concrete",
          4: "Deck & Deck Options",
          7: "Electrical / HVAC",
          8: "Miscellaneous",
        };

        return (
          <View style={styles.stepContent}>
            <View style={styles.stepTitleRow}>
              <Text style={styles.stepTitle}>{stepTitles[currentStep]}</Text>
              {stepTotal > 0 && (
                <Text style={styles.stepSubtotal}>
                  ${stepTotal.toLocaleString()}
                </Text>
              )}
            </View>
            <Text style={styles.fieldHint}>
              Check all items that apply and enter quantities
            </Text>
            {categoryOptions.map((option) => (
              <LineItemRow
                key={option.id}
                name={option.name}
                unitPrice={option.unit_price}
                unitType={option.unit_type}
                isChecked={configure.isLineItemChecked(option.id)}
                quantity={configure.getLineItemQuantity(option.id)}
                onToggle={() => configure.toggleLineItem(option.id)}
                onQuantityChange={(val) =>
                  configure.setLineItemQuantity(option.id, val)
                }
              />
            ))}
          </View>
        );
      }

      case 5: {
        // Step 5 is hidden for roof_only. Branches on wall_system:
        // 2_inch → ScreenRoomBuilder, everything else → WallBuilder.
        const isScreenRoom =
          configure.state.selectedProductLine?.wall_system === "2_inch";

        const handrailOption =
          allOptions.find((o) =>
            o.name.toLowerCase().includes("screen room aluminum handrails"),
          ) ?? null;
        const extraDoorOption =
          allOptions.find((o) =>
            o.name.toLowerCase().includes("additional screen door"),
          ) ?? null;

        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>
              {isScreenRoom
                ? "Screen Room Configuration"
                : "Wall Configuration"}
            </Text>

            {isScreenRoom ? (
              <ScreenRoomBuilder
                screenRoom={configure.state.screenRoom}
                roofStyle={configure.state.roofStyle}
                mountHeight={configure.state.mountHeight}
                allOptions={allOptions}
                selectedWallType={configure.state.wallType}
                activeWallId={activeWallId}
                onActiveWallChange={setActiveWallId}
                onWallTypeSelect={configure.setWallType}
                onWallDimensionChange={configure.setScreenWallDimension}
                onUnitWidthChange={configure.setScreenUnitWidth}
                onUnitTypeChange={configure.setScreenUnitType}
                onKneewallChange={configure.setScreenKneewall}
                onKneewallSolidStyle={configure.setScreenKneewallSolidStyle}
                onChairrailChange={configure.setScreenChairrail}
                onHandrailChange={configure.setScreenHandrail}
                onTransomChange={configure.setScreenTransom}
                onTransomHeightChange={configure.setScreenTransomHeight}
                onGableGlassChange={configure.setScreenGableGlass}
                wallColor={configure.state.wallColor}
                onWallColorChange={configure.setWallColor}
                handrailOption={handrailOption}
                extraDoorOption={extraDoorOption}
              />
            ) : (
              <WallBuilder
                roofStyle={configure.state.roofStyle}
                mountHeight={configure.state.mountHeight}
                walls={configure.state.walls}
                wallSystem={
                  configure.state.selectedProductLine?.wall_system ?? null
                }
                allOptions={allOptions}
                selectedWallType={configure.state.wallType}
                wallAddOns={configure.state.wallAddOns}
                defaultTransomHeightIn={configure.state.defaultTransomHeightIn}
                defaultKneewallHeightIn={
                  configure.state.defaultKneewallHeightIn
                }
                activeWallId={activeWallId}
                onActiveWallChange={setActiveWallId}
                onWallTypeSelect={configure.setWallType}
                onDimensionChange={configure.setWallDimension}
                onDefaultTransomHeightChange={configure.setDefaultTransomHeight}
                onDefaultKneewallHeightChange={
                  configure.setDefaultKneewallHeight
                }
                onUnitTransomHeightChange={configure.setUnitTransomHeight}
                onUnitKneewallHeightChange={configure.setUnitKneewallHeight}
                onWallUnitsChange={configure.setWallUnits}
                onWallPanelTypeChange={(wallId, unitIndex, panelTypeId) =>
                  configure.setWallPanelType(
                    wallId,
                    unitIndex,
                    panelTypeId,
                    allOptions,
                    FEATURE_OPTION_KEYWORDS,
                    PANEL_TYPES,
                  )
                }
                onUnitMaterialChange={(wallId, unitIndex, feature, material) =>
                  configure.setUnitMaterial(
                    wallId,
                    unitIndex,
                    feature,
                    material,
                    allOptions,
                  )
                }
                onUnitDoorStyleChange={(wallId, unitIndex, style) =>
                  configure.setUnitDoorStyle(
                    wallId,
                    unitIndex,
                    style,
                    allOptions,
                  )
                }
                onSplitTransomChange={configure.setSplitTransom}
                onSplitKneewallChange={configure.setSplitKneewall}
                onGableGlassChange={(wallId, config) =>
                  configure.setGableGlass(wallId, config, allOptions)
                }
                onWallAddOnToggle={configure.toggleWallAddOn}
                onWallAddOnQuantityChange={configure.setWallAddOnQuantity}
                wallColor={configure.state.wallColor}
                onWallColorChange={configure.setWallColor}
                onSolidMaterialChange={configure.setSolidPanelMaterial}
                onWallUnitWidthChange={configure.setWallUnitWidth}
              />
            )}
          </View>
        );
      }

      case 6: {
        // Step 6 is hidden for under_existing (getVisibleSteps filters it out).
        const baseRoofTypes = allOptions.filter((o) => {
          if (o.category !== "roof_type" || o.sort_order > 8) return false;
          const roofStyle = configure.state.roofStyle;
          if (!roofStyle || roofStyle === "under_existing") return true;
          if (roofStyle === "roof_only") {
            // Filter by the chosen sub-style (gable or studio)
            const sub = configure.state.roofOnlySubStyle;
            if (!sub) return true; // none picked yet — show all
            return o.name.toLowerCase().includes(sub);
          }
          return o.name.toLowerCase().includes(roofStyle);
        });
        const roofAddOnOptions = allOptions.filter(
          (o) => o.category === "roof_type" && o.sort_order > 8,
        );

        const getRoofCost = () => {
          if (!configure.state.roofType) return 0;
          if (configure.state.roofStyle === "roof_only") {
            const w = inToCeilFt(configure.state.roofOnlyWidthIn);
            const d = inToCeilFt(configure.state.roofOnlyDepthIn);
            return configure.state.roofType.unit_price * w * d;
          }
          const bWall = configure.state.walls.find((w) => w.id === "B");
          const width = inToCeilFt(bWall?.widthIn || "");
          let depth = 0;
          if (configure.state.numberOfWalls === 1) {
            depth = inToCeilFt(configure.state.projectionDistance);
          } else {
            const sideWall = configure.state.walls.find(
              (w) => w.id === "A" || w.id === "C",
            );
            depth = inToCeilFt(sideWall?.widthIn || "");
          }
          return (
            configure.state.roofType.unit_price * (width + 2) * (depth + 1)
          );
        };

        const roofTotal = getRoofCost();

        return (
          <View style={styles.stepContent}>
            <View style={styles.stepTitleRow}>
              <Text style={styles.stepTitle}>Roof Configuration</Text>
              {roofTotal > 0 && (
                <Text style={styles.stepSubtotal}>
                  ${roofTotal.toLocaleString()}
                </Text>
              )}
            </View>

            <Text style={styles.fieldLabel}>Roof Type</Text>
            <View style={styles.optionGrid}>
              {baseRoofTypes.map((option) => (
                <Pressable
                  key={option.id}
                  style={[
                    styles.optionCard,
                    configure.state.roofType?.id === option.id &&
                      styles.optionCardSelected,
                  ]}
                  onPress={() => configure.setRoofType(option)}
                >
                  <Text
                    style={[
                      styles.optionName,
                      configure.state.roofType?.id === option.id &&
                        styles.optionNameSelected,
                    ]}
                  >
                    {option.name}
                  </Text>
                  <Text style={styles.optionDesc}>
                    ${option.unit_price}/sq ft
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Shingle / Roof Color Match</Text>
            <Text style={styles.fieldHint}>
              Describe the existing home's roof color to match
            </Text>
            <TextInput
              style={styles.noteInput}
              value={configure.state.roofColorNote}
              onChangeText={configure.setRoofColorNote}
              placeholder="e.g. Charcoal grey architectural shingles"
              placeholderTextColor={Colors.text.tertiary}
              multiline
              numberOfLines={2}
            />

            <Text style={styles.fieldLabel}>Roof Add-Ons</Text>
            {roofAddOnOptions.map((option) => (
              <LineItemRow
                key={option.id}
                name={option.name}
                unitPrice={option.unit_price}
                unitType={option.unit_type}
                isChecked={configure.state.roofAddOns[option.id] !== undefined}
                quantity={configure.state.roofAddOns[option.id] || ""}
                onToggle={() => configure.toggleRoofAddOn(option.id)}
                onQuantityChange={(val) =>
                  configure.setRoofAddOnQuantity(option.id, val)
                }
              />
            ))}
          </View>
        );
      }

      case 9: {
        const grandTotal = configure.calculateTotal(allOptions);
        const checkedLineItems = allOptions.filter(
          (o) => configure.state.lineItems[o.id] !== undefined,
        );
        const checkedRoofAddOns = allOptions.filter(
          (o) => configure.state.roofAddOns[o.id] !== undefined,
        );

        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Customer & Summary</Text>

            <Text style={styles.fieldLabel}>Customer Name</Text>
            <TextInput
              style={styles.textInput}
              value={configure.state.customerName}
              onChangeText={configure.setCustomerName}
              placeholder="Full name"
              placeholderTextColor={Colors.text.tertiary}
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.textInput}
              value={configure.state.customerEmail}
              onChangeText={configure.setCustomerEmail}
              placeholder="email@example.com"
              placeholderTextColor={Colors.text.tertiary}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              style={[styles.textInput, styles.notesInput]}
              value={configure.state.notes}
              onChangeText={configure.setNotes}
              placeholder="Any special requirements..."
              placeholderTextColor={Colors.text.tertiary}
              multiline
              numberOfLines={3}
            />

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>
              Price Breakdown
            </Text>

            {configure.state.wallType &&
              configure.state.walls.map((wall) => {
                const wFt = inToCeilFt(wall.widthIn);
                const hFt = inToCeilFt(wall.heightIn);
                const cost = configure.state.wallType!.unit_price * wFt * hFt;
                if (cost === 0) return null;
                return (
                  <View key={wall.id} style={styles.summaryLine}>
                    <Text style={styles.summaryLineName}>
                      Wall {wall.id} — {configure.state.wallType!.name}
                    </Text>
                    <Text style={styles.summaryLineValue}>
                      ${cost.toLocaleString()}
                    </Text>
                  </View>
                );
              })}

            {Object.entries(configure.state.wallAddOns).map(
              ([wallId, wallOptions]) =>
                Object.entries(wallOptions).map(([optionId, qty]) => {
                  const option = allOptions.find((o) => o.id === optionId);
                  if (!option) return null;
                  const wall = configure.state.walls.find(
                    (w) => w.id === wallId,
                  );
                  const isArea =
                    option.name.toLowerCase().includes("transom glass") ||
                    option.name.toLowerCase().includes("kneewall glass");
                  const wFt = inToCeilFt(wall?.widthIn || "");
                  const hFt = inToCeilFt(wall?.heightIn || "");
                  const quantity = isArea ? wFt * hFt : parseFloat(qty) || 0;
                  const cost = option.unit_price * quantity;
                  if (cost === 0) return null;
                  return (
                    <View
                      key={`${wallId}-${optionId}`}
                      style={styles.summaryLine}
                    >
                      <Text style={styles.summaryLineName}>
                        Wall {wallId} — {option.name} × {quantity}{" "}
                        {option.unit_type.replace("_", " ")}
                      </Text>
                      <Text style={styles.summaryLineValue}>
                        ${cost.toLocaleString()}
                      </Text>
                    </View>
                  );
                }),
            )}

            {configure.state.roofType &&
              (() => {
                let roofCost = 0;
                let roofDetail = "";
                if (configure.state.roofStyle === "roof_only") {
                  const w = inToCeilFt(configure.state.roofOnlyWidthIn);
                  const d = inToCeilFt(configure.state.roofOnlyDepthIn);
                  roofCost = configure.state.roofType.unit_price * w * d;
                  roofDetail = `${configure.state.roofOnlyWidthIn}″ × ${configure.state.roofOnlyDepthIn}″ → ${w} × ${d} ft`;
                } else {
                  const bWall = configure.state.walls.find((w) => w.id === "B");
                  const width = inToCeilFt(bWall?.widthIn || "");
                  let depth = 0;
                  if (configure.state.numberOfWalls === 1) {
                    depth = inToCeilFt(configure.state.projectionDistance);
                  } else {
                    const sideWall = configure.state.walls.find(
                      (w) => w.id === "A" || w.id === "C",
                    );
                    depth = inToCeilFt(sideWall?.widthIn || "");
                  }
                  roofCost =
                    configure.state.roofType.unit_price *
                    (width + 2) *
                    (depth + 1);
                  roofDetail = `(${width}+2) × (${depth}+1) ft incl. overhangs`;
                }
                if (roofCost === 0) return null;
                return (
                  <View style={styles.summaryLine}>
                    <Text style={styles.summaryLineName}>
                      Roof — {configure.state.roofType.name}
                      {"\n"}
                      <Text
                        style={{ fontSize: 13, color: Colors.text.tertiary }}
                      >
                        {roofDetail}
                      </Text>
                    </Text>
                    <Text style={styles.summaryLineValue}>
                      ${roofCost.toLocaleString()}
                    </Text>
                  </View>
                );
              })()}

            {checkedLineItems.map((option) => {
              const qty =
                parseFloat(configure.getLineItemQuantity(option.id)) || 0;
              const cost = option.unit_price * qty;
              if (cost === 0) return null;
              return (
                <View key={option.id} style={styles.summaryLine}>
                  <Text style={styles.summaryLineName}>
                    {option.name} × {qty} {option.unit_type.replace("_", " ")}
                  </Text>
                  <Text style={styles.summaryLineValue}>
                    ${cost.toLocaleString()}
                  </Text>
                </View>
              );
            })}

            {checkedRoofAddOns.map((option) => {
              const qty =
                parseFloat(configure.state.roofAddOns[option.id]) || 0;
              const cost = option.unit_price * qty;
              if (cost === 0) return null;
              return (
                <View key={option.id} style={styles.summaryLine}>
                  <Text style={styles.summaryLineName}>
                    {option.name} × {qty} {option.unit_type.replace("_", " ")}
                  </Text>
                  <Text style={styles.summaryLineValue}>
                    ${cost.toLocaleString()}
                  </Text>
                </View>
              );
            })}

            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Estimated Total</Text>
              <Text style={styles.grandTotalValue}>
                ${grandTotal.toLocaleString()}
              </Text>
            </View>

            <View style={{ height: 100 }} />
          </View>
        );
      }

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
  stepContent: { gap: 12 },
  stepTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text.primary,
    marginBottom: 4,
  },
  stepTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stepSubtotal: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.status.complete,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.text.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 8,
  },
  fieldHint: { fontSize: 12, color: Colors.text.tertiary, marginTop: -8 },
  optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    minWidth: "47%",
    flex: 1,
    gap: 3,
  },
  optionCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: "#EEF2FF",
  },
  optionName: { fontSize: 14, fontWeight: "600", color: Colors.text.primary },
  optionNameSelected: { color: Colors.primary },
  optionDesc: { fontSize: 13, color: Colors.text.tertiary },
  wallCountRow: { flexDirection: "row", gap: 10 },
  wallCountCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 4,
  },
  wallCountCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: "#EEF2FF",
  },
  wallCountNumber: {
    fontSize: 32,
    fontWeight: "700",
    color: Colors.text.secondary,
  },
  wallCountNumberSelected: { color: Colors.primary },
  wallCountLabel: { fontSize: 12, color: Colors.text.tertiary },
  noteInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    fontSize: 14,
    color: Colors.text.primary,
    textAlignVertical: "top",
    minHeight: 60,
  },
  textInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    fontSize: 15,
    color: Colors.text.primary,
  },
  notesInput: { height: 80, textAlignVertical: "top" },
  summaryLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  summaryLineName: {
    flex: 1,
    fontSize: 13,
    color: Colors.text.secondary,
    paddingRight: 8,
  },
  summaryLineValue: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 16,
    marginTop: 8,
  },
  grandTotalLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  grandTotalValue: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.status.complete,
  },
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
    fontSize: 12,
    fontWeight: "600",
    color: Colors.text.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  footerTotalValue: {
    fontSize: 20,
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
    fontSize: 15,
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
  nextButtonText: { fontSize: 15, fontWeight: "600", color: Colors.white },
  generateButton: {
    flex: 2,
    backgroundColor: Colors.status.complete,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  generateButtonText: { fontSize: 15, fontWeight: "600", color: Colors.white },
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
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  generateEarlyButton: {
    backgroundColor: "#EEF2FF",
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  generateEarlyText: { fontSize: 13, fontWeight: "600", color: Colors.primary },
  loadingText: { fontSize: 14, color: Colors.text.secondary },
  errorText: { fontSize: 15, color: Colors.status.failed, textAlign: "center" },
  roofDimsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  roofDimLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  roofDimSep: {
    fontSize: 20,
    fontWeight: "300",
    color: Colors.text.tertiary,
    marginTop: 20,
  },
  roofDimConvert: {
    fontSize: 12,
    color: Colors.text.tertiary,
    textAlign: "center",
    fontStyle: "italic",
    marginTop: 2,
  },
  roofDimResult: {
    backgroundColor: "#EEF2FF",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 20,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  roofDimResultText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.primary,
  },
});
