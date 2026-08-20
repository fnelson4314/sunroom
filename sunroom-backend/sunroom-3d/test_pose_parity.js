// Does the SAME footprint + SAME points give the same camera for a glass room
// and a screen room? If yes, any glass-vs-screen "rotation" is a data
// difference (different widths reaching the renderer), not the solver.
const assert = require("assert");
const { parseConfig, getPnPDims } = require("./server.js");
const { solveCameraAutoFit } = require("./pnp.js");

const W = 1280, H = 960;
// Plausible L-shaped 5-point capture (normalized), same for both.
const pts = [
  [0.17, 0.39], [0.47, 0.35], [0.17, 0.68], [0.47, 0.72], [0.66, 0.63],
];

const glassWalls = [
  { id: "A", widthIn: "144", heightIn: "96", panelTypes: ["fixed_glass", "fixed_glass"], unitWidths: ["72", "72"] },
  { id: "B", widthIn: "216", heightIn: "96", panelTypes: ["fixed_glass", "fixed_glass", "fixed_glass"], unitWidths: ["72", "72", "72"] },
];
const screenWalls = glassWalls.map((w) => ({
  ...w,
  panelTypes: w.panelTypes.map(() => "screen"),
}));

const pose = (walls, wallSystem) => {
  const spec = parseConfig({ wallData: JSON.stringify(walls), wallSystem, roofStyle: "gable" });
  const dims = getPnPDims(spec, "AB");
  const cam = solveCameraAutoFit(pts, dims, W, H);
  return { dims, cam };
};

const g = pose(glassWalls, "4_inch");
const s = pose(screenWalls, "2_inch");

console.log("glass  dims:", g.dims, "err:", g.cam.meanReprojErr.toFixed(2));
console.log("screen dims:", s.dims, "err:", s.cam.meanReprojErr.toFixed(2));

assert.deepStrictEqual(s.dims, g.dims, "same widths must give the same PnP dims");
// The pose itself: eye, look-at, fov, fitted height and fitted footprint.
for (const k of ["fovY", "solvedHeight", "meanReprojErr"]) {
  assert.strictEqual(s.cam[k], g.cam[k], `camera.${k} differs between glass and screen`);
}
for (const k of ["position", "target", "up"]) {
  assert.deepStrictEqual(s.cam[k], g.cam[k], `camera.${k} differs between glass and screen`);
}
assert.deepStrictEqual(s.cam.fittedDims, g.cam.fittedDims, "fitted footprint differs");
console.log("pose parity: identical footprint -> identical camera (glass == screen)");

// And the converse: a footprint that differs by the amount a re-typed screen
// wall plausibly would, to show how far the pose moves.
const off = pose(
  glassWalls.map((w) => (w.id === "A" ? { ...w, widthIn: "168" } : w)),
  "2_inch",
);
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z).toFixed(2);
console.log(
  `side wall 144in -> 168in (one re-typed dimension): camera eye moves ` +
    `${d(off.cam.position, g.cam.position)}ft, look-at moves ` +
    `${d(off.cam.target, g.cam.target)}ft, fitted height ` +
    `${g.cam.solvedHeight.toFixed(2)} -> ${off.cam.solvedHeight.toFixed(2)}ft`,
);
console.log("=> a different footprint IS a different camera: the box turns.");

// ─── Inconsistent TOP markers twist the box ──────────────────────────────────
// Real capture (session "test", 2026-08-15): three ground markers fit to a few
// px while the two top markers pull 29px and 47px in OPPOSITE directions, and
// the solver stretches an 8ft wall to 12.5ft chasing them. This is the failure
// the preview's fit warning exists to name — it is NOT a footprint problem, so
// the mean error stays under the 30px "config doesn't match" threshold.
const real = [
  [0.17, 0.373], [0.642, 0.353], [0.64, 0.701], [0.171, 0.668], [0.455, 0.749],
];
const cam = solveCameraAutoFit(real, { wallW_B: 18, wallW_C: 18, wallH: 8 }, 1280, 960);
assert.ok(cam.groundReprojErr < 8, `ground markers should fit: ${cam.groundReprojErr}`);
assert.ok(cam.meanReprojErr > cam.groundReprojErr * 3, "tops should be the outlier");
assert.ok(cam.meanReprojErr < 30, "and stay under the footprint-mismatch threshold");
assert.ok(cam.solvedHeight > 8 * 1.2, `tops inflate the wall: ${cam.solvedHeight}`);
console.log(
  `inconsistent tops: ground=${cam.groundReprojErr.toFixed(1)}px ` +
    `mean=${cam.meanReprojErr.toFixed(1)}px 8ft->${cam.solvedHeight.toFixed(1)}ft ` +
    `(caught by the height/ground-split check, missed by reprojErr>30)`,
);
