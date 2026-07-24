// Round-trip check for the 1-wall flat PnP solve (solveCameraFlatAutoHeight).
// Project a known W×H wall's 4 corners through a plausible hand-held camera,
// hand the normalized clicks to the solver, and assert it recovers a
// cheirality-valid pose that reprojects the corners with sub-pixel error and
// lands on ~the true wall height. Run: node ./test_single_wall.js
"use strict";
const assert = require("assert");
const { solveCameraFlatAutoHeight, projectPoint } = require("./pnp");

const normalize = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function lookAtRc(eye, center) {
  const zc = normalize(sub(eye, center));
  let xc = cross([0, 1, 0], zc);
  if (Math.hypot(...xc) < 1e-6) xc = [1, 0, 0];
  xc = normalize(xc);
  const yc = cross(zc, xc);
  return [[xc[0], yc[0], zc[0]], [xc[1], yc[1], zc[1]], [xc[2], yc[2], zc[2]]];
}

const photoW = 1024, photoH = 768, aspect = photoW / photoH;
const W = 12, H = 8; // 12ft wide, 8ft tall opening
const worldPts = [[0, H, 0], [W, H, 0], [W, 0, 0], [0, 0, 0]];
const eye = [W / 2 + 3, 5.5, 20]; // ~eye height, off to the side, 20ft back
const center = [W / 2, H / 2, 0];
const Rc = lookAtRc(eye, center);
const fov = 55;

const pts = worldPts.map((wp) => {
  const [u, v, front] = projectPoint(eye, Rc, fov, aspect, photoW, photoH, wp);
  assert(front > 0, "test setup: corner behind camera");
  return [u / photoW, v / photoH]; // normalized, as camera.tsx stores
});

// Max per-corner reprojection error under a solved camera (rebuilds the
// Three-style look-at from position/target/up so it matches the render).
function maxCornerErr(cam) {
  const eye = [cam.position.x, cam.position.y, cam.position.z];
  const ctr = [cam.target.x, cam.target.y, cam.target.z];
  const zc = normalize(sub(eye, ctr));
  let xc = cross([cam.up.x, cam.up.y, cam.up.z], zc);
  if (Math.hypot(...xc) < 1e-6) xc = [1, 0, 0];
  xc = normalize(xc);
  const yc = cross(zc, xc);
  const Rc = [[xc[0], yc[0], zc[0]], [xc[1], yc[1], zc[1]], [xc[2], yc[2], zc[2]]];
  let mx = 0;
  cam.worldPts.forEach((wp, i) => {
    const [u, v] = projectPoint(eye, Rc, cam.fovY, cam.aspect, photoW, photoH, wp);
    mx = Math.max(mx, Math.hypot(u - cam.imagePts[i][0], v - cam.imagePts[i][1]));
  });
  return mx;
}

const cam = solveCameraFlatAutoHeight(pts, { wallW_C: W, wallW_B: 0, wallH: H }, photoW, photoH);
console.log(`solvedHeight=${cam.solvedHeight}ft err=${cam.meanReprojErr.toFixed(2)}px cheirality=${cam.cheirality}`);
assert(cam.cheirality, "FAIL: pose put a corner behind the camera");
assert(cam.meanReprojErr < 6, `FAIL: reprojection ${cam.meanReprojErr.toFixed(1)}px too high`);
assert(Math.abs(cam.solvedHeight - H) <= 1.5, `FAIL: height ${cam.solvedHeight}ft off true ${H}ft`);
// Every corner — TOPS included — must land on its click, or the wall overshoots
// the opening (the "panes into the sky" bug). Guards the equal-weighting.
assert(maxCornerErr(cam) < 6, `FAIL: a corner is ${maxCornerErr(cam).toFixed(1)}px off — wall doesn't fill the opening`);

// Mismatched config width: the wall must still fill the clicked opening (the
// height sweep compensates the aspect). No corner should fly off.
const camW = solveCameraFlatAutoHeight(pts, { wallW_C: 16, wallW_B: 0, wallH: 8 }, photoW, photoH);
assert(maxCornerErr(camW) < 6, `FAIL: mismatched-width solve left a corner ${maxCornerErr(camW).toFixed(1)}px off`);

console.log("PASS single-wall flat solve");
