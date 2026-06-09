import { Colors } from "@/constants/Colors";
import { getFullCatalog } from "@/services/api";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
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
  return wallCount === 2 ? 5 : 4;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

function getPointLabels(wallCount: WallCount, wallCombo: WallCombo): string[] {
  if (wallCount === 1) {
    return [
      "Nook — Top Left",
      "Nook — Top Right",
      "Nook — Bottom Right",
      "Nook — Bottom Left",
    ];
  }
  if (wallCount === 3) {
    return [
      "House Wall — Top Left",
      "House Wall — Top Right",
      "House Wall — Bottom Right",
      "House Wall — Bottom Left",
    ];
  }
  // 2 walls — 5 points
  if (wallCombo === "AB") {
    return [
      "Left wall — Top (house)",
      "Right wall — Top (house)",
      "Right wall — Bottom (ground)",
      "Left wall — Bottom (ground)",
      "Front corner — Ground (where walls meet, out in yard)",
    ];
  }
  // BC default
  return [
    "Left wall — Top (house)",
    "Right wall — Top (house)",
    "Right wall — Bottom (ground)",
    "Left wall — Bottom (ground)",
    "Front corner — Ground (where walls meet, out in yard)",
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

  if (wallCount === 3) {
    return { _flat_wall: [p(0), p(1), p(2), p(3)] };
  }

  // 2-wall: pass all 5 points — renderer uses them for perspective placement
  // pt0=left-top, pt1=right-top, pt2=right-bottom, pt3=left-bottom, pt4=front-corner-ground
  return {
    _5pt: [p(0), p(1), p(2), p(3), p(4)],
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

  if (wallCount === 1 || wallCount === 3) {
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

// ─── Instruction ──────────────────────────────────────────────────────────────

function getInstruction(
  wallCount: WallCount,
  wallCombo: WallCombo,
  nextIndex: number,
): string {
  const labels = getPointLabels(wallCount, wallCombo);
  const total = getPointCount(wallCount);
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
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    getFullCatalog().catch(() => {});
  }, []);

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

  const totalPoints = getPointCount(wallCount);
  const allPlaced = points.length >= totalPoints;

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
        setPoints([]);
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
        setPoints([]);
      }
    } catch (e) {
      console.error("Failed to pick image:", e);
    }
  };

  // ─── Confirm ───────────────────────────────────────────────────────────────

  const confirmPoints = async () => {
    if (!allPlaced || !photoUri) return;

    // Get live window dimensions — static Dimensions.get() is stale on web
    // when the browser window has been resized since page load
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    const wallCorners = buildWallCorners(points, wallCount, wallCombo);

    const photoAspect = photoSize
      ? photoSize.w / photoSize.h
      : screenW / screenH;
    const screenAspect = screenW / screenH;

    let displayedW: number,
      displayedH: number,
      offsetX = 0,
      offsetY = 0;

    if (photoAspect > screenAspect) {
      // Photo wider than screen — fits height, crops left/right
      displayedH = screenH;
      displayedW = screenH * photoAspect;
      offsetX = (displayedW - screenW) / 2;
      offsetY = 0;
    } else {
      // Photo taller than screen — fits width, crops top/bottom
      displayedW = screenW;
      displayedH = screenW / photoAspect;
      offsetX = 0;
      offsetY = (displayedH - screenH) / 2;
    }

    // Normalize all points to 0-1 photo space
    const normalizedCorners: Record<string, number[][]> = {};
    for (const [wallId, corners] of Object.entries(wallCorners)) {
      normalizedCorners[wallId] = (corners as number[][]).map(([x, y]) => [
        (x + offsetX) / displayedW,
        (y + offsetY) / displayedH,
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

    router.push({
      pathname: "/configure",
      params: {
        photoUri,
        box_x1: String(box_x1),
        box_y1: String(box_y1),
        box_x2: String(box_x2),
        box_y2: String(box_y2),
        wall_corners: JSON.stringify(normalizedCorners),
        preset_wall_count: String(wallCount),
        preset_wall_combo: wallCombo ?? "",
      },
    });
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
              onPress={() => {
                setWallCount(n);
                setWallCombo(n === 2 ? "BC" : null);
              }}
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
          {wallCount === 2 && (
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
          <Text style={styles.hint}>
            {wallCount === 1
              ? "Position the U-shaped nook in frame"
              : wallCount === 3
                ? "Position the flat house wall in frame"
                : "Position the house wall and patio area in frame"}
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
      <Image
        source={{ uri: photoUri! }}
        style={styles.photo}
        resizeMode="cover"
      />

      <View
        style={styles.overlay}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const nearIndex = points.findIndex((p) => {
            const dx = p.x - locationX,
              dy = p.y - locationY;
            return Math.sqrt(dx * dx + dy * dy) < POINT_RADIUS;
          });
          if (nearIndex !== -1) {
            setPoints((prev) => prev.slice(0, nearIndex));
            return;
          }
          if (points.length >= totalPoints) return;
          setPoints((prev) => [...prev, { x: locationX, y: locationY }]);
        }}
      >
        <GuideLines points={points} wallCount={wallCount} />

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
                // Front corner point (index 4) gets green colour
                backgroundColor: i === 4 ? "#22cc44" : Colors.primary,
              },
            ]}
          >
            <Text style={styles.pointDotLabel}>{i + 1}</Text>
          </View>
        ))}
      </View>

      <View style={styles.instructionBanner}>
        <Text style={styles.instructionText}>
          {getInstruction(wallCount, wallCombo, points.length)}
        </Text>
        {wallCount === 2 && points.length === 0 && (
          <Text style={styles.instructionSub}>
            Points 1-4: tap the house wall corners. Point 5 (green): tap the
            ground where the sunroom front corner will be.
          </Text>
        )}
        {wallCount !== 2 && points.length === 0 && (
          <Text style={styles.instructionSub}>
            Trace the house wall corners where the sunroom will attach
          </Text>
        )}
        {points.length > 0 && !allPlaced && (
          <Text style={styles.instructionSub}>
            Tap an existing point to remove it and re-place from there
          </Text>
        )}
      </View>

      <View style={styles.reviewFooter}>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            if (points.length > 0) setPoints([]);
            else {
              setMode("camera");
              setPhotoUri(null);
            }
          }}
        >
          <Text style={styles.secondaryButtonText}>
            {points.length > 0 ? "Clear" : "Retake"}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.button, !allPlaced && styles.buttonDisabled]}
          onPress={confirmPoints}
          disabled={!allPlaced}
        >
          <Text style={styles.buttonText}>
            {allPlaced
              ? "Confirm →"
              : `${points.length} / ${totalPoints} points`}
          </Text>
        </Pressable>
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
  photo: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  permissionText: {
    fontSize: 15,
    color: Colors.text.secondary,
    textAlign: "center",
    lineHeight: 22,
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
  wallCountLabel: { color: "#fff", fontSize: 13, fontWeight: "600" },
  wallCountDivider: {
    width: 1,
    height: 20,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginHorizontal: 4,
  },
  wallCountBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  wallCountBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  wallCountBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  wallCountBtnTextActive: { color: "#fff" },
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
    fontSize: 14,
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
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#fff",
  },
  captureInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#fff",
  },
  uploadButton: { width: 100, alignItems: "center", justifyContent: "center" },
  uploadButtonText: {
    color: "#fff",
    fontSize: 13,
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
  pointDotLabel: { color: "#fff", fontSize: 11, fontWeight: "700" },
  instructionBanner: {
    position: "absolute",
    top: 24,
    left: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  instructionText: {
    color: "#fff",
    fontSize: 14,
    textAlign: "center",
    fontWeight: "600",
  },
  instructionSub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    textAlign: "center",
  },
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
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.2)",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
  },
  secondaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
