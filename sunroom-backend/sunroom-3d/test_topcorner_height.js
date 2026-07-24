// test_topcorner_height.js — the drawn TOP corners must land on the clicked
// markers REGARDLESS of the typed config height.
//
// Why this exists: the two top markers sit at world height H; the three ground
// markers are height-independent. solveCameraAutoHeight used to sweep only
// configH × [0.8..1.5], so a too-tall config could never reach the height the
// markers imply (config 12ft floored the sweep at 9.6ft) — the drawn top corners
// rendered ~20px high while the seated base looked fine ("bottom ok, top off",
// user 2026-07-20). Now the sweep is an ABSOLUTE range + golden-section refine,
// so the clicks (not the typed height) place the corners. This guards that.
//
// Pure unit test against pnp.js — no renderer needed:
//     node sunroom-3d/test_topcorner_height.js

"use strict";
const assert = require("assert");
const pnp = require("./pnp.js");

const W = 1000, H = 750, aspect = W / H;
const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];

// Ground-truth box + a realistic hand-held pose; project the 5 corners to get
// noise-free "clicked" markers.
const TRUE = { wallW_B: 12, wallW_C: 14, wallH: 9 };
const eye = [26, 5.5, 26], fovY = 52;
const center = [TRUE.wallW_C/2, TRUE.wallH/2, TRUE.wallW_B/2];

function camProject(e, c, fov) {
  const zc = norm(sub(e, c));
  const xc = norm(cross([0, 1, 0], zc));
  const yc = cross(zc, xc);
  const R = [[xc[0],yc[0],zc[0]], [xc[1],yc[1],zc[1]], [xc[2],yc[2],zc[2]]];
  return (Xw) => {
    const d = sub(Xw, e);
    const cx = R[0][0]*d[0]+R[1][0]*d[1]+R[2][0]*d[2];
    const cy = R[0][1]*d[0]+R[1][1]*d[1]+R[2][1]*d[2];
    const cz = R[0][2]*d[0]+R[1][2]*d[1]+R[2][2]*d[2];
    const t = Math.tan((fov*Math.PI/180)/2), front = -cz;
    return [((cx/front/(t*aspect)+1)/2)*W, ((1-cy/front/t)/2)*H];
  };
}
const corners = (d) => [
  [0, d.wallH, 0], [d.wallW_C, d.wallH, d.wallW_B],
  [d.wallW_C, 0, d.wallW_B], [0, 0, 0], [0, 0, d.wallW_B],
];

const truePx = corners(TRUE).map(camProject(eye, center, fovY));
const clicks = truePx.map(([u, v]) => [u/W, v/H]);

function topErrorForConfigHeight(configH) {
  const cam = pnp.solveCameraAutoFit(
    clicks, { wallW_B: TRUE.wallW_B, wallW_C: TRUE.wallW_C, wallH: configH }, W, H,
  );
  const d = {
    wallW_B: cam.fittedDims ? cam.fittedDims.wallW_B : TRUE.wallW_B,
    wallW_C: cam.fittedDims ? cam.fittedDims.wallW_C : TRUE.wallW_C,
    wallH: cam.solvedHeight, // scene.html draws at the SOLVED height (server.js wiring)
  };
  const e = [cam.position.x, cam.position.y, cam.position.z];
  const c = [cam.target.x, cam.target.y, cam.target.z];
  const proj = camProject(e, c, cam.fovY);
  // NOTE: camProject rebuilds R from up=[0,1,0]; the solver keeps roll ~0 so this
  // matches scene.html's PerspectiveCamera closely enough for a corner check.
  const errs = corners(d).map((Xw, i) => {
    const [u, v] = proj(Xw);
    return Math.hypot(u - truePx[i][0], v - truePx[i][1]);
  });
  return Math.max(errs[0], errs[1]); // the two top corners
}

// Config heights from far too short to far too tall — every one must recover the
// true height and seat the top corners. Silence pnp's verbose per-solve logs.
const origLog = console.log;
console.log = () => {};
const results = [7, 8, 9, 10, 12, 14].map((h) => [h, topErrorForConfigHeight(h)]);
console.log = origLog;

let failed = false;
for (const [h, err] of results) {
  const ok = err < 1.0; // noise-free ⇒ sub-pixel
  console.log(`  config ${h}ft → top-corner error ${err.toFixed(2)}px  ${ok ? "ok" : "FAIL"}`);
  if (!ok) failed = true;
}
assert(!failed, "top corners drift from the clicked markers at some config height");
console.log("test_topcorner_height: top corners seat on the clicks at every config height");
