import { FontSize } from "@/constants/Typography";
import { StyleSheet, Text, View } from "react-native";

type WallCombo = "AB" | "BC" | null;

// The two visible walls form an L. Side wall runs back toward the house; front
// wall faces the camera. Mirrors camera.tsx's own wallLetters (kept in sync —
// see GuideLines/buildWallCorners there for why AB→A/B and BC→B/C) — this is
// a small, stable, pure formatting helper duplicated here rather than
// imported from the route module, so this file never touches camera.tsx's
// touch/geometry code.
function wallLetters(wallCombo: WallCombo): { side: string; front: string } {
  return wallCombo === "AB"
    ? { side: "A", front: "B" }
    : { side: "B", front: "C" };
}

type Props = {
  // The main line, already fully computed by camera.tsx (trace-phase / trace-
  // complete / getInstruction(...) — unchanged logic, just handed down).
  mainLine: string;
  inTracePhase: boolean;
  existingRoof: "studio" | "gable";
  isUnderExisting: boolean;
  allPlaced: boolean;
  pointsPlaced: number;
  wallCount: 1 | 2 | 3;
  wallCombo: WallCombo;
  // Required points are all placed and the optional corner-top slot is still
  // free — camera.tsx owns that decision (it reads the capture flag).
  cornerTopOpen: boolean;
};

// The point-plotting review screen's top banner. Previously five mutually-
// exclusive conditional <Text> blocks in the same visual slot (one of the four
// state combinations below, or the trace-phase hint, or the tap-to-remove
// hint) — now one computed sub-message. Purely presentational: every input
// here is state camera.tsx already computed from its point/phase data: this
// component never touches the touch-responder or geometry math.
export default function InstructionBanner({
  mainLine,
  inTracePhase,
  existingRoof,
  isUnderExisting,
  allPlaced,
  pointsPlaced,
  wallCount,
  wallCombo,
  cornerTopOpen,
}: Props) {
  const { side, front } = wallLetters(wallCombo);

  let subLine: string | null = null;
  if (inTracePhase) {
    subLine =
      existingRoof === "gable"
        ? "Now trace the underside of the existing roof: start at point 1 (top of the side wall), tap upward to the roof PEAK, then back down to point 2 (top of the front wall). Then tap “Done Tracing”."
        : "Now trace the underside of the existing roof: tap along its slope from point 1 (top of the side wall) across to point 2 (top of the front wall), following the eave. Then tap “Done Tracing”.";
  } else if (isUnderExisting && !allPlaced && pointsPlaced === 0) {
    subLine = `Under-Existing: two walls form an L — Wall ${side} runs back to the house, Wall ${front} runs parallel to the house. First place the 5 corner points, then you'll trace the existing roofline above them.`;
  } else if (!isUnderExisting && wallCount !== 1 && pointsPlaced === 0) {
    subLine = `The two visible walls form an L: Wall ${side} is the SIDE wall running back to the house, Wall ${front} runs parallel to the house. Place points 1–4 at their top and bottom corners (top-left, top-right, bottom-right, bottom-left), then point 5 (green) on the ground at the nearest corner where the two walls meet.${
      wallCount === 3
        ? " (3-wall: you capture these two visible walls now; the 3rd wall is priced/added later in the configurator.)"
        : ""
    }`;
  } else if (!isUnderExisting && wallCount === 1 && pointsPlaced === 0) {
    subLine = "Trace the nook corners where the sunroom will attach";
  } else if (cornerTopOpen) {
    // The optional corner top (off unless CAPTURE_CORNER_TOP_POINT). Worth it
    // only when the post is really in the photo — on a new build there's nothing
    // to click and a guess drags the whole solve toward it, so confirming with
    // the required points is the right move there.
    subLine =
      "Re-creating a structure that's already built (LORA capture)? Add point 6 on the TOP of that corner post — it stops the drawn corner sitting low. Building new with nothing there yet? Just confirm.";
  } else if (pointsPlaced > 0 && !allPlaced) {
    subLine = "Tap an existing point to remove it and re-place from there";
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.mainText}>{mainLine}</Text>
      {subLine && <Text style={styles.subText}>{subLine}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
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
  mainText: {
    color: "#fff",
    fontSize: FontSize.callout,
    textAlign: "center",
    fontWeight: "600",
  },
  subText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: FontSize.body,
    textAlign: "center",
  },
});
