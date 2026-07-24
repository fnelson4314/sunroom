// Where does the near corner post's TOP end up? Ground truth: pick a camera,
// project the real box with it, feed those pixels back as the capture, and see
// where each solve puts [0, wallH, wallW_B].
//
// Three captures, because "the corner droops" has more than one candidate cause:
//   clean    — every point clicked correctly
//   pt0-high — pt0 clicked at the WING TOP at the house instead of the eave line
//              (the studio-specific mistake: the box has one wall height, so a
//              top point up at the roof is a taller box than the photo shows)
//   house    — pt1/pt2 clicked where the structure meets the HOUSE while the
//              model puts them on the front plane (pnp.js:430-437)
const assert = require("assert");
const {
  solveCameraAutoFit,
  projectPoint,
} = require("./pnp.js");

const W = 1000, H = 750, aspect = W / H, FOV = 55;
const dims = { wallW_B: 18, wallW_C: 12, wallH: 8 };
const { wallW_B, wallW_C, wallH } = dims;
const RISE = 3; // studio roof rise at the house, feet

const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a) => { const n = Math.hypot(...a); return a.map((v) => v / n); };
// Same convention as pnp.js lookAtRc: nested rows, columns = [right, up, back].
const lookAtRc = (eye, center) => {
  const zc = unit(sub(eye, center));
  const xc = unit(cross([0, 1, 0], zc));
  const yc = cross(zc, xc);
  return [[xc[0], yc[0], zc[0]], [xc[1], yc[1], zc[1]], [xc[2], yc[2], zc[2]]];
};

const eye = [22, 5.5, 26]; // out front, off to one side, chest height
const Rc = lookAtRc(eye, [wallW_C / 2, wallH / 2, wallW_B / 2]);
const proj = (p) => projectPoint(eye, Rc, FOV, aspect, W, H, p);
const px = (p) => { const [x, y] = proj(p); return [x / W, y / H]; };

const CORNER_TOP = [0, wallH, wallW_B];
const truth = proj(CORNER_TOP);
assert(truth[2] > 0, "ground-truth corner top must be in front of the camera");

const captures = {
  clean: [[0, wallH, 0], [wallW_C, wallH, wallW_B], [wallW_C, 0, wallW_B], [0, 0, 0], [0, 0, wallW_B]],
  "pt0-high": [[0, wallH + RISE, 0], [wallW_C, wallH, wallW_B], [wallW_C, 0, wallW_B], [0, 0, 0], [0, 0, wallW_B]],
  house: [[0, wallH, 0], [wallW_C, wallH, 0], [wallW_C, 0, 0], [0, 0, 0], [0, 0, wallW_B]],
};

let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const jitter = (pts, n) =>
  pts.map(([x, y]) => [x + ((rand() - 0.5) * 2 * n) / W, y + ((rand() - 0.5) * 2 * n) / H]);

const drift = (pts) => {
  const cam = solveCameraAutoFit(pts, dims, W, H);
  // fittedDims carries widths only; the height comes back as solvedHeight —
  // the same pair scene.html renders with.
  const d = cam.fittedDims || dims;
  const h = cam.solvedHeight || dims.wallH;
  const e = [cam.position.x, cam.position.y, cam.position.z];
  const t = [cam.target.x, cam.target.y, cam.target.z];
  const [x, y] = projectPoint(e, lookAtRc(e, t), cam.fovY, aspect, W, H, [0, h, d.wallW_B]);
  return Math.hypot(x - truth[0], y - truth[1]);
};

const NOISE = 4;
const results = {};
for (const [name, world] of Object.entries(captures)) {
  const six = jitter([...world.map(px), px(CORNER_TOP)], NOISE);
  const d5 = drift(six.slice(0, 5));
  const d6 = drift(six);
  results[name] = { d5, d6 };
  console.log(`${name.padEnd(9)} 5pt=${d5.toFixed(1).padStart(5)}px  6pt=${d6.toFixed(1).padStart(5)}px`);
}

// A GUESSED 6th point — the new-build case, where the corner post isn't in the
// photo yet and the salesperson eyeballs it. It enters the solve as a hard
// constraint, so a wrong guess is worse than no 6th point at all: this is why
// the capture leaves it optional instead of always asking for it.
const cleanSix = jitter([...captures.clean.map(px), px(CORNER_TOP)], NOISE);
const GUESS_PX = 30;
const guessed = [...cleanSix.slice(0, 5), [cleanSix[5][0], cleanSix[5][1] - GUESS_PX / H]];
const dGuess = drift(guessed);
console.log(
  `guessed   5pt=${results.clean.d5.toFixed(1).padStart(5)}px  ` +
    `6pt=${dGuess.toFixed(1).padStart(5)}px  (6th point ${GUESS_PX}px off)`,
);

// A correctly clicked capture already lands the corner; the 6th point is what
// rescues the two ways real captures go wrong.
assert(results.clean.d5 < 3 * NOISE, "a clean capture should not droop");
for (const name of ["pt0-high", "house"]) {
  assert(
    results[name].d6 < results[name].d5,
    `${name}: 6 points should beat 5 (${results[name].d6.toFixed(1)} vs ${results[name].d5.toFixed(1)})`,
  );
}
assert(
  dGuess > results.clean.d5,
  "a guessed 6th point should be worse than not placing one — if this ever " +
    "flips, the capture could ask for it unconditionally",
);
console.log("ok");
