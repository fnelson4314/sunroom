import InstructionBanner from "@/components/camera/InstructionBanner";
import FlowNav from "@/components/FlowNav";
import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { useDesignSession } from "@/contexts/DesignSession";
import { getFullCatalog, getSession } from "@/services/api";
import { CAPTURE_CORNER_TOP_POINT } from "@/services/config";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Dimensions,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const POINT_RADIUS = 26;
const DOT_RADIUS = 11;

type WallCount = 1 | 2 | 3;
type WallCombo = "AB" | "BC" | null;
type PlacedPoint = { x: number; y: number };

// ─── Point count ──────────────────────────────────────────────────────────────
// 2-wall: 5 points (4 house wall corners + 1 front corner ground)
// 1-wall and 3-wall: 4 points (rectangle)

function getPointCount(wallCount: WallCount): number {
  // 2- AND 3-wall use the angled 5-point capture (front + near side). At any
  // angle you can only see two walls, so we capture/render the two visible ones;
  // a 3rd wall is config/pricing-only (the hidden far return). Only 1-wall (a
  // recessed nook) is captured as a flat 4-point rectangle.
  return wallCount === 1 ? 4 : 5;
}

// OPTIONAL 6th point: the TOP of the near corner post. The 5 required markers
// never pin it (two house-side tops + three ground points), so on a capture with
// any inconsistency the solve leaves a family of poses that all fit yet disagree
// about where that corner top lands, and the drawn corner DROOPS. pnp.js takes a
// 6th correspondence at [0, wallH, wallW_B] and the auto-height sweep is then
// forced to seat the corner top on the clicked pixel.
//
// OPTIONAL, and OFF by default (CAPTURE_CORNER_TOP_POINT in services/config.ts).
// It only helps when there is something real to click — a LORA capture, or any
// re-creation of a structure that already exists. On a genuine new-build quote
// the corner post isn't there yet, and an ESTIMATED click is worse than none: it
// enters the solve as a hard constraint and drags the whole box toward the guess
// (see sunroom-3d/test_corner_top.js, "guessed" row). Under-existing never
// offers it — server.js already lifts the same correspondence out of the
// roofline trace.
function getMaxPointCount(
  wallCount: WallCount,
  isUnderExisting: boolean,
): number {
  const required = getPointCount(wallCount);
  return CAPTURE_CORNER_TOP_POINT && wallCount !== 1 && !isUnderExisting
    ? required + 1
    : required;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

// The two visible walls form an L. The SIDE wall runs back toward the house; the
// FRONT wall faces the camera. Which letters they carry depends on the combo:
//   AB → side = A, front = B.    BC → side = B, front = C.
// (Confirmed by the footprint guide lines: pt3→pt4 is the side wall, pt2→pt4 the
// front wall — see GuideLines / buildWallCorners.)
function wallLetters(wallCombo: WallCombo): { side: string; front: string } {
  return wallCombo === "AB"
    ? { side: "A", front: "B" }
    : { side: "B", front: "C" };
}

function getPointLabels(wallCount: WallCount, wallCombo: WallCombo): string[] {
  if (wallCount === 1) {
    // Recessed nook: the four corners of the opening the sunroom fills.
    return [
      "Top-left corner of the nook opening (up at the roofline)",
      "Top-right corner of the nook opening (up at the roofline)",
      "Bottom-right corner of the nook, down on the ground",
      "Bottom-left corner of the nook, down on the ground",
    ];
  }
  // 2- and 3-wall: the angled 5-point L (the front wall + the visible side wall).
  // Capture order is top-left, top-right, bottom-right, bottom-left, front corner.
  const { side, front } = wallLetters(wallCombo);
  return [
    `Wall ${side} top left`,
    `Wall ${front} top right`,
    `Wall ${front} bottom right`,
    `Wall ${side} bottom left`,
    `Front corner (green) — the NEAREST ground corner poking out toward you, where Wall ${side} and Wall ${front} meet at the ground`,
    `OPTIONAL — corner post TOP (orange): straight up from the green point, where the two wall tops meet at the eave. Only if it's really there (an existing structure); skip it on a new build`,
  ];
}

// ─── Build wall corners ───────────────────────────────────────────────────────
// Returns raw screen pixel coords — normalization happens in confirmPoints.
// For 2-wall: stores the 5 raw points under key "_5pt" for the renderer
// to use for perspective-correct placement.

function buildWallCorners(
  pts: PlacedPoint[],
  wallCount: WallCount,
  wallCombo: WallCombo,
): Record<string, number[][]> {
  const p = (i: number): number[] => [pts[i].x, pts[i].y];

  if (wallCount === 1) {
    return { B: [p(0), p(1), p(2), p(3)] };
  }

  // 2- and 3-wall: pass all 5 points — renderer uses them for perspective
  // placement and draws the two visible walls (front + near side). A 3rd wall is
  // priced/built via the configurator but never rendered (it's off-camera).
  // pt0=left-top, pt1=right-top, pt2=right-bottom, pt3=left-bottom,
  // pt4=front-corner-ground, pt5=front-corner-TOP (new-roof captures only —
  // pnp.js reads it as the 6th correspondence; under-existing has 5 here and the
  // renderer derives the same point from the roofline trace).
  const five = [p(0), p(1), p(2), p(3), p(4)];
  return {
    _5pt: pts.length >= 6 ? [...five, p(5)] : five,
  };
}

// ─── Guide lines ──────────────────────────────────────────────────────────────

function GuideLines({
  points,
  wallCount,
}: {
  points: PlacedPoint[];
  wallCount: WallCount;
}) {
  if (points.length < 2) return null;

  let pairs: [number, number][] = [];

  if (wallCount === 1) {
    pairs = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ];
  } else {
    // 2-wall: house wall rectangle + lines to front corner
    // House wall: 0-1 top, 1-2 right side, 2-3 bottom, 3-0 left side
    // Front corner connections: 3→4 (left bottom to front corner)
    //                           2→4 (right bottom to front corner)
    pairs = [
      [0, 1], // top of house wall
      [1, 2], // right side of house wall
      [2, 3], // bottom of house wall
      [3, 0], // left side of house wall
      [3, 4], // left bottom → front corner (Wall B footprint)
      [2, 4], // right bottom → front corner (Wall C footprint)
      [4, 5], // front corner → its TOP (the corner post itself)
      [0, 5], // side wall top rail
      [1, 5], // front wall top rail
    ];
  }

  return (
    <>
      {pairs.map(([a, b], i) => {
        if (a >= points.length || b >= points.length) return null;
        const pa = points[a];
        const pb = points[b];
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const cx = (pa.x + pb.x) / 2;
        const cy = (pa.y + pb.y) / 2;
        // Front corner lines shown in different colour
        const isFrontLine = (a === 3 && b === 4) || (a === 2 && b === 4);
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: cx - len / 2,
              top: cy - 1,
              width: len,
              height: 2,
              backgroundColor: isFrontLine
                ? "rgba(100, 255, 100, 0.9)"
                : "rgba(255, 220, 0, 0.9)",
              transform: [{ rotate: `${angle}deg` }],
            }}
          />
        );
      })}
    </>
  );
}

// ─── Roofline trace (under-existing) ───────────────────────────────────────────
// Draws the traced existing-roof underside as an orange polyline from the left
// top point (pt0) through the intermediate trace taps to the right top point (pt1),
// plus a dot on each intermediate tap.

function RoofTraceLines({
  top0,
  top1,
  trace,
}: {
  top0?: PlacedPoint;
  top1?: PlacedPoint;
  trace: PlacedPoint[];
}) {
  if (!top0 || !top1) return null;
  const chain = [top0, ...trace, top1];
  return (
    <>
      {chain.slice(1).map((pb, i) => {
        const pa = chain[i];
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const cx = (pa.x + pb.x) / 2;
        const cy = (pa.y + pb.y) / 2;
        return (
          <View
            key={`rl${i}`}
            style={{
              position: "absolute",
              left: cx - len / 2,
              top: cy - 1.5,
              width: len,
              height: 3,
              backgroundColor: "rgba(255,130,0,0.95)",
              transform: [{ rotate: `${angle}deg` }],
            }}
          />
        );
      })}
      {trace.map((pt, i) => (
        <View
          key={`rt${i}`}
          style={{
            position: "absolute",
            left: pt.x - 8,
            top: pt.y - 8,
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: "#ff8200",
            borderWidth: 2,
            borderColor: "#fff",
          }}
        />
      ))}
    </>
  );
}

// ─── Instruction ──────────────────────────────────────────────────────────────

function getInstruction(
  wallCount: WallCount,
  wallCombo: WallCombo,
  nextIndex: number,
  isUnderExisting: boolean,
): string {
  const labels = getPointLabels(wallCount, wallCombo);
  const total = getPointCount(wallCount);
  const max = getMaxPointCount(wallCount, isUnderExisting);
  // Past the required points but the optional corner top is still open: offer it
  // rather than declaring the capture finished.
  if (nextIndex >= total && nextIndex < max) {
    return `Point ${nextIndex + 1} (optional): ${labels[nextIndex]}`;
  }
  if (nextIndex >= total) return "All points placed — confirm when ready";
  return `Point ${nextIndex + 1} of ${total}: ${labels[nextIndex]}`;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<"camera" | "review">("camera");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [points, setPoints] = useState<PlacedPoint[]>([]);
  const [wallCount, setWallCount] = useState<WallCount>(2);
  const [wallCombo, setWallCombo] = useState<WallCombo>("BC");
  const [photoSize, setPhotoSize] = useState<{ w: number; h: number } | null>(
    null,
  );
  // Actual measured size of the tap overlay. Tap coords (locationX/Y) are
  // relative to THIS element, so we must normalize against its real size — not
  // window.innerWidth/Height, which can differ (DevTools open, browser chrome,
  // resize) and silently push normalized points past 0–1, floating the build.
  const [overlaySize, setOverlaySize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const cameraRef = useRef<CameraView>(null);

  // Build type: "new_roof" = today's flow (renderer builds a roof). "under_existing"
  // = walls go under the EXISTING roof, so after the 5 points we also trace the
  // existing roof's underside (roofTrace) → passed to the renderer as _roofline.
  const [buildType, setBuildType] = useState<"new_roof" | "under_existing">(
    "new_roof",
  );
  const [roofTrace, setRoofTrace] = useState<PlacedPoint[]>([]);
  const [traceComplete, setTraceComplete] = useState(false);
  // Under-existing only: the shape of the EXISTING roof we're building beneath.
  // Drives the trace guidance (gable = trace up to a peak; studio = one slope)
  // and flows to the configurator/prompt.
  const [existingRoof, setExistingRoof] = useState<"studio" | "gable">(
    "studio",
  );

  const params = useLocalSearchParams<{ draftId?: string }>();
  const {
    draftId: sessionDraftId,
    reachStep,
    resetSession,
    setPhotoUri: setSessionPhoto,
  } = useDesignSession();
  // A draftId to carry forward: the one we were opened with (returning to edit
  // points) or the shared session's.
  const draftId = params.draftId || sessionDraftId || "";

  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: () => <FlowNav current={0} /> });
  }, [navigation]);

  const resetCapture = () => {
    setPoints([]);
    setRoofTrace([]);
    setTraceComplete(false);
  };

  useEffect(() => {
    getFullCatalog().catch(() => {});
  }, []);

  // Returning to re-plot points on an existing design: load its saved photo and
  // capture presets and drop straight into review mode. The wall config stays
  // put (it lives on the draft row and is untouched here) — only the points and
  // photo can change, which is exactly what should force a re-render later.
  useEffect(() => {
    if (!params.draftId) {
      // Fresh capture from Home → start a brand-new design.
      resetSession(null);
      reachStep(0);
      return;
    }
    reachStep(0);
    (async () => {
      try {
        const s = await getSession(params.draftId!);
        const meta = (s?.draft_state?._meta ?? {}) as Record<string, string>;
        const photo = s?.house_photo_url || meta.photoUri;
        if (photo) {
          setPhotoUri(photo);
          setMode("review");
        }
        if (meta.preset_wall_count)
          setWallCount(Number(meta.preset_wall_count) as WallCount);
        if (meta.preset_roof_style === "under_existing")
          setBuildType("under_existing");
        if (meta.preset_existing_roof === "gable" || meta.preset_existing_roof === "studio")
          setExistingRoof(meta.preset_existing_roof);
      } catch (e) {
        console.warn("Could not load design for re-plot:", e);
      }
    })();
  }, [params.draftId]);

  useEffect(() => {
    if (!photoUri) return;
    fetch(photoUri)
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const img = new window.Image();
        img.onload = () => {
          setPhotoSize({ w: img.naturalWidth, h: img.naturalHeight });
          URL.revokeObjectURL(url);
        };
        img.src = url;
      })
      .catch(() => {});
  }, [photoUri]);

  const isUnderExisting = buildType === "under_existing";
  const totalPoints = getPointCount(wallCount);
  // Taps beyond the required set are accepted up to maxPoints (the optional
  // corner top) — but the capture is complete, and Confirm live, at totalPoints.
  const maxPoints = getMaxPointCount(wallCount, isUnderExisting);
  const allPlaced = points.length >= totalPoints;
  // After the 5 points are placed, under-existing enters the roofline-trace phase
  // until the user taps "Done Tracing".
  const inTracePhase = isUnderExisting && allPlaced && !traceComplete;
  const readyToConfirm = allPlaced && (!isUnderExisting || traceComplete);
  const instructionMainLine = inTracePhase
    ? `Trace the existing roof edge — ${roofTrace.length} point${roofTrace.length === 1 ? "" : "s"} added`
    : traceComplete
      ? "Roofline traced — confirm when ready"
      : getInstruction(wallCount, wallCombo, points.length, isUnderExisting);

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>Camera access is required</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Camera Access</Text>
        </Pressable>
      </View>
    );
  }

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        base64: false,
      });
      if (photo) {
        setPhotoUri(photo.uri);
        setMode("review");
        resetCapture();
      }
    } catch (e) {
      console.error("Failed to take photo:", e);
    }
  };

  const pickFromLibrary = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
        setMode("review");
        resetCapture();
      }
    } catch (e) {
      console.error("Failed to pick image:", e);
    }
  };

  // ─── Confirm ───────────────────────────────────────────────────────────────

  const confirmPoints = async () => {
    if (!allPlaced || !photoUri) return;

    // Normalize against the tap overlay's MEASURED size (onLayout), because the
    // tap coords are relative to that element. window.innerWidth/Height can
    // differ from it (DevTools open, browser chrome, resize) — using them was
    // producing normalized y > 1.0 (points below the photo), which floated the
    // whole structure. Fall back to window dims only if the layout hasn't fired.
    const screenW = overlaySize?.w ?? window.innerWidth;
    const screenH = overlaySize?.h ?? window.innerHeight;

    const wallCorners = buildWallCorners(points, wallCount, wallCombo);

    // Under-existing: the existing roof's underside, traced left→right. Endpoints
    // are the two top points (pt0, pt1); roofTrace holds the intermediate taps
    // (e.g. the front-corner top). The renderer clips the walls to this line.
    if (isUnderExisting && points.length >= 2) {
      const chain = [points[0], ...roofTrace, points[1]];
      wallCorners._roofline = chain.map((p) => [p.x, p.y]);
    }

    const photoAspect = photoSize
      ? photoSize.w / photoSize.h
      : screenW / screenH;
    const screenAspect = screenW / screenH;

    // The review photo is shown with resizeMode="contain" — the WHOLE photo is
    // visible (letterboxed), so every part (incl. the patio at the bottom) can
    // be tapped. Map taps from overlay space into 0–1 photo space accordingly:
    // the photo fits inside the overlay with bars on one axis (offsetX/offsetY
    // are the bar thickness), and we SUBTRACT the bar before dividing.
    let displayedW: number,
      displayedH: number,
      offsetX = 0,
      offsetY = 0;

    if (photoAspect > screenAspect) {
      // Photo relatively wider — fits width, letterbox top/bottom
      displayedW = screenW;
      displayedH = screenW / photoAspect;
      offsetX = 0;
      offsetY = (screenH - displayedH) / 2;
    } else {
      // Photo relatively taller — fits height, letterbox left/right
      displayedH = screenH;
      displayedW = screenH * photoAspect;
      offsetX = (screenW - displayedW) / 2;
      offsetY = 0;
    }

    // Normalize all points to 0-1 photo space
    const normalizedCorners: Record<string, number[][]> = {};
    for (const [wallId, corners] of Object.entries(wallCorners)) {
      normalizedCorners[wallId] = (corners as number[][]).map(([x, y]) => [
        (x - offsetX) / displayedW,
        (y - offsetY) / displayedH,
      ]);
    }

    const allNormPts = Object.entries(normalizedCorners)
      .filter(([key]) => key !== "_combo")
      .flatMap(([, corners]) => corners)
      .filter(
        (p): p is number[] =>
          Array.isArray(p) && p.every((v) => v !== null && !isNaN(v)),
      );
    const nxs = allNormPts.map(([x]) => x);
    const nys = allNormPts.map(([, y]) => y);
    const box_x1 = Math.min(...nxs);
    const box_y1 = Math.min(...nys);
    const box_x2 = Math.max(...nxs);
    const box_y2 = Math.max(...nys);

    console.log(
      "FINAL NORMALIZED",
      JSON.stringify(
        {
          screenW,
          screenH,
          displayedW,
          displayedH,
          offsetX,
          offsetY,
          normalizedCorners,
          box_x1,
          box_y1,
          box_x2,
          box_y2,
        },
        null,
        2,
      ),
    );

    // The photo goes through the shared session, NOT a route param — on web it
    // is a multi-MB data: URI and expo-router puts every param in the URL.
    setSessionPhoto(photoUri);

    const configureParams = {
      box_x1: String(box_x1),
      box_y1: String(box_y1),
      box_x2: String(box_x2),
      box_y2: String(box_y2),
      wall_corners: JSON.stringify(normalizedCorners),
      preset_wall_count: String(wallCount),
      preset_wall_combo: wallCount === 1 ? "" : (wallCombo ?? ""),
      preset_roof_style: isUnderExisting ? "under_existing" : "",
      preset_existing_roof: isUnderExisting ? existingRoof : "",
      // Carry the design's row forward so configure hydrates the EXISTING wall
      // config (which must NOT reset just because points changed) and merges the
      // new points into it.
      draftId,
    };
    // Re-plotting an existing design: replace so we don't stack a second capture
    // screen. A brand-new capture pushes as before.
    if (draftId) {
      router.replace({ pathname: "/configure", params: configureParams });
    } else {
      router.push({ pathname: "/configure", params: configureParams });
    }
  };

  // ─── Camera mode ───────────────────────────────────────────────────────────

  if (mode === "camera") {
    return (
      <View style={styles.container}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          <View style={styles.angleGuide}>
            <View style={styles.angleGuideCorner} />
            <View
              style={[styles.angleGuideCorner, { alignSelf: "flex-end" }]}
            />
          </View>
        </CameraView>

        <View style={styles.wallCountBar}>
          <Text style={styles.wallCountLabel}>Walls:</Text>
          {([1, 2, 3] as WallCount[]).map((n) => (
            <TouchableOpacity
              key={n}
              style={[
                styles.wallCountBtn,
                wallCount === n && styles.wallCountBtnActive,
              ]}
              // Keep the AB/BC choice across wall-count changes — the combo is
              // remembered even while 1-wall hides it (1-wall sends no combo).
              onPress={() => setWallCount(n)}
            >
              <Text
                style={[
                  styles.wallCountBtnText,
                  wallCount === n && styles.wallCountBtnTextActive,
                ]}
              >
                {n}
              </Text>
            </TouchableOpacity>
          ))}
          {(wallCount === 2 || wallCount === 3) && (
            <>
              <View style={styles.wallCountDivider} />
              {(["AB", "BC"] as WallCombo[]).map((combo) => (
                <TouchableOpacity
                  key={combo!}
                  style={[
                    styles.wallCountBtn,
                    wallCombo === combo && styles.wallCountBtnActive,
                  ]}
                  onPress={() => setWallCombo(combo)}
                >
                  <Text
                    style={[
                      styles.wallCountBtnText,
                      wallCombo === combo && styles.wallCountBtnTextActive,
                    ]}
                  >
                    {combo}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>

        <View style={styles.cameraFooter}>
          <View style={styles.buildTypeRow}>
            {(
              [
                ["new_roof", "New Roof"],
                ["under_existing", "Under Existing"],
              ] as const
            ).map(([bt, label]) => (
              <TouchableOpacity
                key={bt}
                style={[
                  styles.buildTypeBtn,
                  buildType === bt && styles.buildTypeBtnActive,
                ]}
                onPress={() => setBuildType(bt)}
              >
                <Text
                  style={[
                    styles.buildTypeBtnText,
                    buildType === bt && styles.buildTypeBtnTextActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {isUnderExisting && (
            <View style={styles.existingRoofRow}>
              <Text style={styles.existingRoofLabel}>Existing roof:</Text>
              {(
                [
                  ["studio", "Studio"],
                  ["gable", "Gable"],
                ] as const
              ).map(([rt, label]) => (
                <TouchableOpacity
                  key={rt}
                  style={[
                    styles.subTypeBtn,
                    existingRoof === rt && styles.buildTypeBtnActive,
                  ]}
                  onPress={() => setExistingRoof(rt)}
                >
                  <Text
                    style={[
                      styles.subTypeBtnText,
                      existingRoof === rt && styles.buildTypeBtnTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={styles.hint}>
            {isUnderExisting
              ? "Under-Existing: capture the patio, then trace the existing roof edge"
              : wallCount === 1
                ? "Position the U-shaped nook in frame"
                : "Position the house wall and patio area in frame (front + one side)"}
          </Text>
          <View style={styles.captureRow}>
            <Pressable style={styles.uploadButton} onPress={pickFromLibrary}>
              <Text style={styles.uploadButtonText}>Upload Photo</Text>
            </Pressable>
            <Pressable style={styles.captureButton} onPress={takePhoto}>
              <View style={styles.captureInner} />
            </Pressable>
            <View style={styles.uploadButton} />
          </View>
        </View>
      </View>
    );
  }

  // ─── Review mode ───────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Photo + tap overlay live in their OWN area, inset to clear the banner
          (top) and footer (bottom). Previously both filled the whole screen and
          the footer covered the bottom of the photo, so the ground couldn't be
          tapped — points landed high and the structure floated. */}
      <View style={styles.photoArea}>
        <Image
          source={{ uri: photoUri! }}
          style={styles.photo}
          resizeMode="contain"
        />

        <View
          style={styles.overlay}
          onLayout={(e) =>
            setOverlaySize({
              w: e.nativeEvent.layout.width,
              h: e.nativeEvent.layout.height,
            })
          }
          onStartShouldSetResponder={() => true}
          onResponderGrant={(evt) => {
            const { locationX, locationY } = evt.nativeEvent;
            // Roofline-trace phase (under-existing): taps build the roof trace.
            if (inTracePhase) {
              const nearT = roofTrace.findIndex(
                (p) =>
                  Math.hypot(p.x - locationX, p.y - locationY) < POINT_RADIUS,
              );
              if (nearT !== -1) {
                setRoofTrace((prev) => prev.slice(0, nearT));
                return;
              }
              setRoofTrace((prev) => [...prev, { x: locationX, y: locationY }]);
              return;
            }
            if (traceComplete) return; // locked; use "Edit Trace" to reopen
            const nearIndex = points.findIndex((p) => {
              const dx = p.x - locationX,
                dy = p.y - locationY;
              return Math.sqrt(dx * dx + dy * dy) < POINT_RADIUS;
            });
            if (nearIndex !== -1) {
              setPoints((prev) => prev.slice(0, nearIndex));
              return;
            }
            if (points.length >= maxPoints) return;
            setPoints((prev) => [...prev, { x: locationX, y: locationY }]);
          }}
        >
          <GuideLines points={points} wallCount={wallCount} />

          {isUnderExisting && allPlaced && (
            <RoofTraceLines
              top0={points[0]}
              top1={points[1]}
              trace={roofTrace}
            />
          )}

          {points.map((pt, i) => (
            <View
              key={i}
              style={[
                styles.pointDot,
                {
                  left: pt.x - DOT_RADIUS,
                  top: pt.y - DOT_RADIUS,
                  width: DOT_RADIUS * 2,
                  height: DOT_RADIUS * 2,
                  borderRadius: DOT_RADIUS,
                  // Front corner ground (4) green, its TOP (5) orange — the pair
                  // the user has to keep vertically aligned.
                  backgroundColor:
                    i === 4 ? "#22cc44" : i === 5 ? "#ff9500" : Colors.primary,
                },
              ]}
            >
              <Text style={styles.pointDotLabel}>{i + 1}</Text>
            </View>
          ))}
        </View>
      </View>

      <InstructionBanner
        mainLine={instructionMainLine}
        inTracePhase={inTracePhase}
        existingRoof={existingRoof}
        isUnderExisting={isUnderExisting}
        allPlaced={allPlaced}
        pointsPlaced={points.length}
        wallCount={wallCount}
        wallCombo={wallCombo}
        cornerTopOpen={allPlaced && points.length < maxPoints}
      />

      <View style={styles.reviewFooter}>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            // Step back one phase at a time.
            if (traceComplete) {
              setTraceComplete(false);
            } else if (roofTrace.length > 0) {
              setRoofTrace((prev) => prev.slice(0, -1));
            } else if (points.length > 0) {
              resetCapture();
            } else {
              setMode("camera");
              setPhotoUri(null);
            }
          }}
        >
          <Text style={styles.secondaryButtonText}>
            {traceComplete
              ? "Edit Trace"
              : roofTrace.length > 0
                ? "Undo"
                : points.length > 0
                  ? "Clear"
                  : "Retake"}
          </Text>
        </Pressable>
        {inTracePhase ? (
          <Pressable
            style={styles.button}
            onPress={() => setTraceComplete(true)}
          >
            <Text style={styles.buttonText}>Done Tracing →</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.button, !readyToConfirm && styles.buttonDisabled]}
            onPress={confirmPoints}
            disabled={!readyToConfirm}
          >
            <Text style={styles.buttonText}>
              {readyToConfirm
                ? "Confirm →"
                : `${points.length} / ${totalPoints} points`}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centered: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  camera: { flex: 1 },
  // Clickable photo region, inset to clear the instruction banner (top) and the
  // footer/Confirm bar (bottom) so the WHOLE photo — including the ground at the
  // bottom — is tappable. The photo + overlay fill this box; normalization keys
  // off the overlay's measured size, so the inset never distorts the mapping.
  photoArea: { position: "absolute", top: 92, left: 0, right: 0, bottom: 132 },
  photo: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  permissionText: {
    fontSize: FontSize.label,
    color: Colors.text.secondary,
    textAlign: "center",
    lineHeight: 24,
  },
  angleGuide: {
    position: "absolute",
    top: "25%",
    left: "5%",
    right: "5%",
    height: "55%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  angleGuideCorner: {
    width: 40,
    height: 40,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: "rgba(255,255,255,0.5)",
  },
  wallCountBar: {
    position: "absolute",
    top: 56,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  wallCountLabel: { color: "#fff", fontSize: FontSize.body, fontWeight: "600" },
  wallCountDivider: {
    width: 1,
    height: 20,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginHorizontal: 4,
  },
  // Camera-screen controls are used one-handed outdoors, often in gloves/sun —
  // touch targets bumped up across the board (2026-08-15).
  wallCountBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  wallCountBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  wallCountBtnText: {
    color: "#fff",
    fontSize: FontSize.callout,
    fontWeight: "600",
  },
  wallCountBtnTextActive: { color: "#fff" },
  buildTypeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 4,
  },
  buildTypeBtn: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  buildTypeBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  buildTypeBtnText: {
    color: "#fff",
    fontSize: FontSize.callout,
    fontWeight: "700",
  },
  buildTypeBtnTextActive: { color: "#fff" },
  existingRoofRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  existingRoofLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: FontSize.body,
    fontWeight: "600",
  },
  subTypeBtn: {
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  subTypeBtnText: { color: "#fff", fontSize: FontSize.callout, fontWeight: "600" },
  cameraFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 48,
    paddingTop: 24,
    alignItems: "center",
    gap: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  hint: {
    color: "#fff",
    fontSize: FontSize.callout,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  captureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 32,
  },
  captureButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#fff",
  },
  captureInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#fff",
  },
  uploadButton: {
    width: 116,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadButtonText: {
    color: "#fff",
    fontSize: FontSize.callout,
    fontWeight: "500",
    textAlign: "center",
  },
  pointDot: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  pointDotLabel: { color: "#fff", fontSize: FontSize.body, fontWeight: "700" },
  reviewFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    padding: 16,
    paddingBottom: 48,
    gap: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  button: {
    flex: 1,
    backgroundColor: Colors.primary,
    padding: 20,
    borderRadius: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: FontSize.label, fontWeight: "600" },
  secondaryButton: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.2)",
    padding: 20,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
  },
  secondaryButtonText: {
    color: "#fff",
    fontSize: FontSize.label,
    fontWeight: "600",
  },
});
