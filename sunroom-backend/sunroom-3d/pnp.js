/**
 * pnp.js
 * ------
 * Solves the camera pose from 5 marker correspondences.
 *
 * WHY NOT DLT?
 * The previous version solved a general 3x4 projection matrix P via the DLT
 * null-space. With only 5 points (10 equations, 11 DOF) P is underconstrained
 * and comes out NON-Euclidean: its rotation block isn't orthonormal, so its
 * markers can straddle the camera's principal plane (some points end up with
 * negative projective depth, w<0). Such a P reprojects each point to 0.0px
 * individually — because u=px/pz works for either sign — yet it CANNOT be
 * rasterized: a GPU flings w<0 vertices to the projective antipode, producing
 * the wild skewed geometry we saw. Decomposing it into position/up/target/fovY
 * gave a nonsense pose (camera at ground level aimed at the sky).
 *
 * THIS VERSION
 * Assumes a pinhole with principal point at the image centre and a single
 * unknown focal length, then solves a true Euclidean pose (R, t) so EVERY
 * point lands in front of the camera (cheirality enforced). Method:
 *   1. Grid of focal lengths (assumed vertical FOVs) × seed camera positions.
 *   2. Levenberg-Marquardt on 6 pose params (eye + Rodrigues rotation).
 *   3. Polish the best with a 7-param LM that also refines focal length.
 * Reprojection won't be a perfect 0.0px (we constrained the intrinsics), but
 * the result is a genuine camera that renders correctly.
 *
 * CONVENTION (matches Three.js exactly, so scene.html reproduces it via
 * PerspectiveCamera + position/up/lookAt(target)):
 *   - Camera looks down its local -Z; local +X right, +Y up; NDC y-up.
 *   - Pixel coords are y-DOWN from the top-left (as the markers are given).
 *
 * WORLD FRAME
 *   origin = pt3 (left house wall bottom); +X right, +Y up, +Z toward camera.
 *   pt0 [0,       H, 0       ]   left  / house side / top
 *   pt1 [wallW_C, H, wallW_B ]   right / front      / top
 *   pt2 [wallW_C, 0, wallW_B ]   right / front      / bottom
 *   pt3 [0,       0, 0       ]   origin
 *   pt4 [0,       0, wallW_B ]   left  / front      / bottom (ground corner)
 */

"use strict";

// ─── small linear-algebra helpers ─────────────────────────────────────────────

function dot(a, b) {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}
function norm(v) {
  return Math.sqrt(dot(v, v));
}
function normalize(v) {
  const n = norm(v) || 1;
  return v.map((x) => x / n);
}
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// Solve A x = b for small dense systems (partial-pivot LU).
function luSolve(A, b) {
  const n = A.length,
    LU = A.map((r) => [...r]),
    pb = [...b];
  for (let k = 0; k < n; k++) {
    let mx = Math.abs(LU[k][k]),
      mr = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(LU[i][k]) > mx) {
        mx = Math.abs(LU[i][k]);
        mr = i;
      }
    [LU[k], LU[mr]] = [LU[mr], LU[k]];
    [pb[k], pb[mr]] = [pb[mr], pb[k]];
    if (Math.abs(LU[k][k]) < 1e-15) continue;
    for (let i = k + 1; i < n; i++) {
      LU[i][k] /= LU[k][k];
      for (let j = k + 1; j < n; j++) LU[i][j] -= LU[i][k] * LU[k][j];
    }
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++) pb[i] -= LU[i][j] * pb[j];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) pb[i] -= LU[i][j] * pb[j];
    pb[i] /= LU[i][i] || 1e-15;
  }
  return pb;
}

// ─── rotation: Rodrigues vector <-> 3x3 matrix ────────────────────────────────

// r (axis * angle) → R (3x3, camera-to-world: columns are camera axes in world)
function rodrigues(r) {
  const th = Math.hypot(r[0], r[1], r[2]);
  if (th < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const x = r[0] / th,
    y = r[1] / th,
    z = r[2] / th;
  const c = Math.cos(th),
    s = Math.sin(th),
    C = 1 - c;
  return [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
}

// R (3x3) → Rodrigues vector
function rmatToRodrigues(R) {
  let cth = (R[0][0] + R[1][1] + R[2][2] - 1) / 2;
  cth = Math.max(-1, Math.min(1, cth));
  const th = Math.acos(cth);
  if (th < 1e-9) return [0, 0, 0];
  const sx = R[2][1] - R[1][2],
    sy = R[0][2] - R[2][0],
    sz = R[1][0] - R[0][1];
  const f = th / (2 * Math.sin(th));
  return [f * sx, f * sy, f * sz];
}

// Look-at rotation (Three.js style): camera at `eye` aimed at `center`,
// world-up = +Y. Returns R (camera-to-world), columns = [right, up, back].
function lookAtRc(eye, center) {
  const zc = normalize(sub3(eye, center)); // +Z points back, away from target
  let xc = cross3([0, 1, 0], zc);
  if (norm(xc) < 1e-6) xc = [1, 0, 0]; // looking straight up/down — pick a right
  xc = normalize(xc);
  const yc = cross3(zc, xc);
  return [
    [xc[0], yc[0], zc[0]],
    [xc[1], yc[1], zc[1]],
    [xc[2], yc[2], zc[2]],
  ];
}

// ─── projection (Three.js perspective, pixel y-down) ──────────────────────────

// Project world point Xw to pixel (u,v). Returns [u, v, frontDepth] where
// frontDepth > 0 means the point is in front of the camera (cheirality ok).
function projectPoint(eye, Rc, fovYdeg, aspect, W, H, Xw) {
  const d = sub3(Xw, eye);
  // camera coords Xc = Rc^T d  (Rc columns are camera axes in world)
  const xc = Rc[0][0] * d[0] + Rc[1][0] * d[1] + Rc[2][0] * d[2];
  const yc = Rc[0][1] * d[0] + Rc[1][1] * d[1] + Rc[2][1] * d[2];
  const zc = Rc[0][2] * d[0] + Rc[1][2] * d[1] + Rc[2][2] * d[2];
  const t = Math.tan((fovYdeg * Math.PI) / 180 / 2);
  const front = -zc; // visible when > 0 (camera looks down -Z)
  const ndcx = xc / front / (t * aspect);
  const ndcy = yc / front / t;
  const u = ((ndcx + 1) / 2) * W;
  const v = ((1 - ndcy) / 2) * H;
  return [u, v, front];
}

// ─── Levenberg-Marquardt pose solver ──────────────────────────────────────────

// params: [ex,ey,ez, rx,ry,rz] (+ optional fovY as params[6] when optimizeFov)
// weights: optional per-point importance. We weight the GROUND markers far more
// than the top ones — see solveCamera for why. Weighted least squares minimises
// Σ wᵢ·errᵢ², so each residual is scaled by √wᵢ.
function residuals(params, fovYfixed, worldPts, imagePts, aspect, W, H, weights) {
  const eye = [params[0], params[1], params[2]];
  const Rc = rodrigues([params[3], params[4], params[5]]);
  const fovY = params.length > 6 ? params[6] : fovYfixed;
  const res = [];
  for (let i = 0; i < worldPts.length; i++) {
    const [u, v] = projectPoint(eye, Rc, fovY, aspect, W, H, worldPts[i]);
    const ws = weights ? Math.sqrt(weights[i]) : 1;
    res.push((u - imagePts[i][0]) * ws);
    res.push((v - imagePts[i][1]) * ws);
  }
  // Gentle gravity regularizer: Rc[1][0] is the world-Y component of the
  // camera's RIGHT axis � zero when the camera is held level. Hand-held capture
  // photos are near-level, but the free pose rolls a few degrees to soak up
  // click noise, rendering the structure visibly leaning. A LIGHT pull keeps
  // the pose in its correct basin (a strong one warps position/height � tried,
  // reverted) while trimming most of the roll.
  res.push(ROLL_WEIGHT * Rc[1][0]);
  return res;
}

// Tuned on real captures: 300 warped the pose (camera dropped below the eave);
// 0 leaves ~5-8 degrees of visible lean. See residuals().
const ROLL_WEIGHT = 80;

function sumSq(r) {
  let s = 0;
  for (const v of r) s += v * v;
  return s;
}

function lmSolve(initParams, fovYfixed, worldPts, imagePts, aspect, W, H, iters, weights) {
  const n = initParams.length;
  let p = initParams.slice();
  let lambda = 1e-2;
  let r = residuals(p, fovYfixed, worldPts, imagePts, aspect, W, H, weights);
  let err = sumSq(r);
  const eps = 1e-5;

  for (let it = 0; it < iters; it++) {
    // numerical Jacobian (central differences), m residuals × n params
    const cols = [];
    for (let j = 0; j < n; j++) {
      const pp = p.slice();
      pp[j] += eps;
      const pm = p.slice();
      pm[j] -= eps;
      const rp = residuals(pp, fovYfixed, worldPts, imagePts, aspect, W, H, weights);
      const rm = residuals(pm, fovYfixed, worldPts, imagePts, aspect, W, H, weights);
      cols.push(rp.map((v, k) => (v - rm[k]) / (2 * eps)));
    }
    const m = r.length;
    const JtJ = Array.from({ length: n }, () => Array(n).fill(0));
    const Jtr = Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      for (let b = a; b < n; b++) {
        let s = 0;
        for (let k = 0; k < m; k++) s += cols[a][k] * cols[b][k];
        JtJ[a][b] = JtJ[b][a] = s;
      }
      let s = 0;
      for (let k = 0; k < m; k++) s += cols[a][k] * r[k];
      Jtr[a] = s;
    }

    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      // (JtJ + lambda·diag(JtJ)) δ = -Jtr   (Marquardt damping)
      const A = JtJ.map((row, i) =>
        row.map((v, jj) => v + (i === jj ? lambda * v + 1e-12 : 0)),
      );
      const delta = luSolve(A, Jtr.map((v) => -v));
      const pn = p.map((v, i) => v + delta[i]);
      const rn = residuals(pn, fovYfixed, worldPts, imagePts, aspect, W, H, weights);
      const en = sumSq(rn);
      if (en < err) {
        p = pn;
        r = rn;
        err = en;
        lambda = Math.max(lambda * 0.4, 1e-10);
        improved = true;
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
    if (err < 1e-8) break;
  }

  const eye = [p[0], p[1], p[2]];
  const Rc = rodrigues([p[3], p[4], p[5]]);
  const fovY = p.length > 6 ? p[6] : fovYfixed;
  // TRUE (unweighted) per-point Euclidean reprojection error (px). Reported
  // separately from the weighted objective the LM actually minimised, so logs
  // stay in real pixels. groundErr is the seating error of the 3 ground markers
  // (worldPts 2,3,4) — the number that decides whether the base floats.
  let total = 0,
    groundTotal = 0,
    front = true;
  for (let i = 0; i < worldPts.length; i++) {
    const [u, v, f] = projectPoint(eye, Rc, fovY, aspect, W, H, worldPts[i]);
    const e = Math.hypot(u - imagePts[i][0], v - imagePts[i][1]);
    total += e;
    if (i >= 2 && i <= 4) groundTotal += e;
    if (f <= 0) front = false;
  }
  return {
    params: p,
    eye,
    Rc,
    fovY,
    meanErr: total / worldPts.length,
    groundErr: groundTotal / 3,
    front,
  };
}

// ─── Leveled (zero-roll) refit ────────────────────────────────────────────────
// A hand-held capture photo is level: world-vertical lines are vertical in the
// image. A free 6-DOF pose happily ROLLS a few degrees to soak up click noise,
// which renders the whole structure visibly leaning. Rather than a soft roll
// penalty (which warps the pose toward wrong-but-level local minima), we refit
// with roll REMOVED FROM THE PARAMETERIZATION: R = Ry(yaw)·Rx(pitch). The
// camera's right axis is (cosθ, 0, -sinθ) — horizontal by construction — so
// the solution cannot lean, and because we warm-start from the best free pose
// it stays in the same solution basin (same camera height/distance branch).

function ryRx(yaw, pitch) {
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  // columns are camera axes in world: right, up, back
  return [
    [cy, sy * sp, sy * cp],
    [0, cp, -sp],
    [-sy, cy * sp, cy * cp],
  ];
}

// params: [ex,ey,ez, yaw, pitch] (+ optional fovY as params[5]). Same shape as
// the free solver but with roll REMOVED from the parameterization — eye and
// fov stay fully free so the optimizer can still seat the base on the weighted
// ground markers; it just cannot lean the image to soak up click noise.
function residualsLevel(params, fovYfixed, worldPts, imagePts, aspect, W, H, weights) {
  const eye = [params[0], params[1], params[2]];
  const Rc = ryRx(params[3], params[4]);
  const fovY = params.length > 5 ? params[5] : fovYfixed;
  const res = [];
  for (let i = 0; i < worldPts.length; i++) {
    const [u, v] = projectPoint(eye, Rc, fovY, aspect, W, H, worldPts[i]);
    const ws = weights ? Math.sqrt(weights[i]) : 1;
    res.push((u - imagePts[i][0]) * ws);
    res.push((v - imagePts[i][1]) * ws);
  }
  return res;
}

function lmSolveLevel(initParams, fovYfixed, worldPts, imagePts, aspect, W, H, iters, weights) {
  const n = initParams.length;
  let p = initParams.slice();
  let lambda = 1e-2;
  let r = residualsLevel(p, fovYfixed, worldPts, imagePts, aspect, W, H, weights);
  let err = sumSq(r);
  const eps = 1e-5;

  for (let it = 0; it < iters; it++) {
    const cols = [];
    for (let j = 0; j < n; j++) {
      const pp = p.slice();
      pp[j] += eps;
      const pm = p.slice();
      pm[j] -= eps;
      const rp = residualsLevel(pp, fovYfixed, worldPts, imagePts, aspect, W, H, weights);
      const rm = residualsLevel(pm, fovYfixed, worldPts, imagePts, aspect, W, H, weights);
      cols.push(rp.map((v, k) => (v - rm[k]) / (2 * eps)));
    }
    const m = r.length;
    const JtJ = Array.from({ length: n }, () => Array(n).fill(0));
    const Jtr = Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      for (let b = a; b < n; b++) {
        let s = 0;
        for (let k = 0; k < m; k++) s += cols[a][k] * cols[b][k];
        JtJ[a][b] = JtJ[b][a] = s;
      }
      let s = 0;
      for (let k = 0; k < m; k++) s += cols[a][k] * r[k];
      Jtr[a] = s;
    }

    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      const A = JtJ.map((row, i) =>
        row.map((v, jj) => v + (i === jj ? lambda * v + 1e-12 : 0)),
      );
      const delta = luSolve(A, Jtr.map((v) => -v));
      const pn = p.map((v, i) => v + delta[i]);
      const rn = residualsLevel(pn, fovYfixed, worldPts, imagePts, aspect, W, H, weights);
      const en = sumSq(rn);
      if (en < err) {
        p = pn;
        r = rn;
        err = en;
        lambda = Math.max(lambda * 0.4, 1e-10);
        improved = true;
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
    if (err < 1e-8) break;
  }

  const eye = [p[0], p[1], p[2]];
  const Rc = ryRx(p[3], p[4]);
  const fovY = p.length > 5 ? p[5] : fovYfixed;
  let total = 0,
    groundTotal = 0,
    front = true;
  for (let i = 0; i < worldPts.length; i++) {
    const [u, v, f] = projectPoint(eye, Rc, fovY, aspect, W, H, worldPts[i]);
    const e = Math.hypot(u - imagePts[i][0], v - imagePts[i][1]);
    total += e;
    if (i >= 2 && i <= 4) groundTotal += e;
    if (f <= 0) front = false;
  }
  return {
    params: p,
    eye,
    Rc,
    fovY,
    meanErr: total / worldPts.length,
    groundErr: groundTotal / 3,
    front,
  };
}

// ─── public API ───────────────────────────────────────────────────────────────

function solveCamera(pts, dims, photoW, photoH) {
  const { wallW_B, wallW_C, wallH } = dims;

  const worldPts = [
    [0, wallH, 0],
    [wallW_C, wallH, wallW_B],
    [wallW_C, 0, wallW_B],
    [0, 0, 0],
    [0, 0, wallW_B],
  ];
  // Optional 6th correspondence: the TOP of the shared corner post
  // (0, wallH, wallW_B). Under-existing captures supply it for free � the
  // first roofline trace tap sits exactly there. Without it, the 5 points
  // leave a family of camera poses that all fit yet disagree about where the
  // corner TOP lands, and the drawn corner visibly DROOPS below the real one.
  // With it, the auto-height sweep is forced to seat the corner top on the
  // clicked pixel.
  if (pts.length >= 6) worldPts.push([0, wallH, wallW_B]);
  const imagePts = pts.slice(0, worldPts.length).map(([nx, ny]) => [nx * photoW, ny * photoH]);
  const aspect = photoW / photoH;
  const center = [wallW_C / 2, wallH / 2, wallW_B / 2];

  // GROUND-SEATING PRIORITY. The 5 clicked markers rarely form a perfect box
  // (the two top markers sit on the house plane, the model treats one as the
  // front plane — a forgiving perspective mismatch). That leaves an irreducible
  // fit residual. With equal weights the optimiser dumps it on the rigid ground
  // points (worldPts 2,3,4), lifting the base off the patio — the "floating
  // sunroom". Weighting the ground markers heavily forces the camera to seat the
  // base on the clicked ground points. When the clicks DO form a clean box the
  // ground error is ~0 either way, so this never hurts a good solve.
  //
  // TOP corners (worldPts 0,1) used to be weight 1 — the rest of the residual
  // dumped there "where the roof overhang hides it". But under-existing gable
  // captures pin the SHARED corner top (the 6th point, weight 8) while the two
  // outer top corners stayed at 1, so the whole top residual concentrated on
  // them and they drooped 25-40px below the clicked eave shoulders (visible on
  // pentagon gables where the user clicks the exact corner). Bumped to 4: ground
  // still dominates 2:1 (stays seated), pt5 stays pinned, but the outer corners
  // no longer eat the entire residual alone.
  // The 6 clicked points don't fit a rigid box under one camera — there's an
  // irreducible ~14px residual (the centred-principal-point pinhole floor on
  // hand-clicked markers). Weighting only chooses WHERE that residual lands, it
  // can't remove it: measured on a real capture, [1,1,8,8,8,8] put ~39px on the
  // top corners with the base planted (gnd 3.6px); [6,6,8,8,8,8] halved the top
  // error but floated the base (gnd 11px) — same 13.9px mean, just relocated.
  // 3 is the balance: base stays seated, tops don't droop as hard as the base-
  // priority original. The real fix for a specific drooping corner is a more
  // precise CLICK on it, not this knob.
  // ponytail: calibration knob — 1=base-priority (tops droop), 8=top-priority
  // (base floats). Don't expect it to beat the ~14px floor; it only moves it.
  const weights = pts.length >= 6 ? [3, 3, 8, 8, 8, 8] : [1, 1, 8, 8, 8];

  // Seed camera positions: out in front (+Z), a spread of sideways offsets and
  // standing-ish heights. The real photographer is somewhere in this volume.
  const span = Math.max(wallW_B, wallW_C);
  const eyes = [];
  for (const dz of [0.8 * span, 1.5 * span]) {
    for (const dx of [-wallW_C, 0, wallW_C, 2 * wallW_C]) {
      for (const hy of [0.5 * wallH, 0.9 * wallH, 1.4 * wallH]) {
        eyes.push([center[0] + dx, hy, center[2] + dz]);
      }
    }
  }
  const fovCandidates = [40, 50, 60, 70, 80];

  // Coarse search: best (seed × fov) by reprojection, preferring cheirality.
  let best = null;
  for (const fovY of fovCandidates) {
    for (const eye of eyes) {
      const Rc = lookAtRc(eye, center);
      const init = [...eye, ...rmatToRodrigues(Rc)];
      const sol = lmSolve(init, fovY, worldPts, imagePts, aspect, photoW, photoH, 60, weights);
      sol.penalty = plausibilityPenalty(sol, wallH);
      if (!best || betterGround(sol, best)) best = sol;
    }
  }

  // Fine polish: also refine focal length (7th param), seeded from the best.
  const polished = lmSolve(
    [...best.params.slice(0, 6), best.fovY],
    best.fovY,
    worldPts,
    imagePts,
    aspect,
    photoW,
    photoH,
    120,
    weights,
  );
  polished.penalty = plausibilityPenalty(polished, wallH);
  if (betterGround(polished, best)) best = polished;

  // TRUST-REGION LEVELING. The free pose can roll several degrees (click noise /
  // box-model mismatch), which leans the rendered structure. A fully-free level
  // solve drains to a wrong low-camera basin; a frozen-pose re-aim wrecks the
  // base seating. Middle path: warm-start a level (yaw/pitch, eye and fov free)
  // refit FROM the free winner, then accept it only if it stayed in the same
  // basin (camera didn't move far) and kept both the seating and the overall
  // fit reasonable. Otherwise keep the free pose � a slight lean beats a wrong
  // camera.
  {
    const b0 = [best.Rc[0][2], best.Rc[1][2], best.Rc[2][2]];
    const pitch0 = -Math.asin(Math.max(-1, Math.min(1, b0[1])));
    const yaw0 = Math.atan2(b0[0], b0[2]);
    const level = lmSolveLevel(
      [...best.eye, yaw0, pitch0, best.fovY],
      best.fovY, worldPts, imagePts, aspect, photoW, photoH, 120, weights,
    );
    level.penalty = plausibilityPenalty(level, wallH);
    const moved = Math.hypot(
      level.eye[0] - best.eye[0],
      level.eye[1] - best.eye[1],
      level.eye[2] - best.eye[2],
    );
    const span = Math.max(wallW_B, wallW_C);
    const ok =
      level.front &&
      moved <= 0.35 * span &&            // same basin: camera stayed put-ish
      level.groundErr <= best.groundErr + 4 && // base still seated
      level.meanErr <= best.meanErr * 1.5 + 3; // overall fit sane
    if (ok) {
      best = level;
    } else {
      console.log(
        `[pnp] leveling kept free pose (moved=${moved.toFixed(1)}ft ` +
          `gnd=${level.groundErr.toFixed(1)}px mean=${level.meanErr.toFixed(1)}px)`,
      );
    }
  }

  // Convert pose → Three.js camera params (position / target / up / fovY).
  const eye = best.eye,
    Rc = best.Rc;
  const back = [Rc[0][2], Rc[1][2], Rc[2][2]]; // camera +Z (points away from scene)
  const up = [Rc[0][1], Rc[1][1], Rc[2][1]]; // camera +Y
  const target = sub3(eye, back); // a point along the optical axis (forward = -back)

  console.log(
    `[pnp] solved: fovY=${best.fovY.toFixed(1)}° err=${best.meanErr.toFixed(1)}px ` +
      `groundErr=${best.groundErr.toFixed(1)}px ` +
      `cheirality=${best.front ? "ok" : "FAIL"} ` +
      `pos=(${eye.map((v) => v.toFixed(2)).join(",")})`,
  );

  return {
    fovY: best.fovY,
    aspect,
    position: { x: eye[0], y: eye[1], z: eye[2] },
    target: { x: target[0], y: target[1], z: target[2] },
    up: { x: up[0], y: up[1], z: up[2] },
    near: 0.1,
    far: 500,
    worldPts,
    imagePts,
    photoW,
    photoH,
    meanReprojErr: best.meanErr,
    groundReprojErr: best.groundErr,
    plausibility: best.penalty || 0,
    cheirality: best.front,
  };
}

// Physical plausibility of a candidate pose for a HAND-HELD CAPTURE PHOTO,
// as a soft penalty in pixels added to fit error during candidate selection.
// Pure reprojection can crown absurd cameras: on a real capture, a 14.5�-fov
// camera 30ft up / 65ft away with 16� of roll beat the physical solution
// (47� fov, 6.4ft high, 2.5px) by 0.6px � and drew a drooping, warped
// composite. Soft penalties (not hard rejects) so a genuinely zoomed/elevated
// photo can still win if the evidence is strong.
function plausibilityPenalty(sol, wallH) {
  let p = 0;
  if (sol.fovY < 35) p += (35 - sol.fovY) * 1.5; // heavy telephoto
  if (sol.fovY > 85) p += (sol.fovY - 85) * 1.5; // absurd wide
  const y = sol.eye[1];
  const maxY = 2.2 * (wallH || 8);
  if (y > maxY) p += (y - maxY) * 2; // camera in the sky
  if (y < 1) p += (1 - y) * 4; // camera at/below grade
  const roll =
    Math.asin(Math.min(1, Math.abs(sol.Rc[1][0]))) * (180 / Math.PI);
  if (roll > 6) p += (roll - 6) * 2; // hand-held photos are near-level
  return p;
}

// Prefer cheirality-valid solutions; among equal validity, the camera that seats
// the base best (lower ground error) wins — that's what stops the float. Falls
// back to overall mean error only when ground errors tie.
function betterGround(a, b) {
  if (a.front !== b.front) return a.front;
  const pa = a.penalty || 0,
    pb = b.penalty || 0;
  const ga = a.groundErr + pa,
    gb = b.groundErr + pb;
  if (Math.abs(ga - gb) > 0.5) return ga < gb;
  return a.meanErr + pa < b.meanErr + pb;
}

// Prefer cheirality-valid solutions; among equal validity, lower error wins.
function better(a, b) {
  if (a.front !== b.front) return a.front; // valid beats invalid
  return a.meanErr < b.meanErr;
}

// Balanced selection for the LEVEL-constrained search. betterGround (ground
// error first) works for free poses — free DOF can zero the ground AND keep
// the top decent, so ground-first just breaks ties. Under the level constraint
// those goals genuinely trade off, and ground-first selects degenerate fits
// (base perfect, top 40px+ off). Scoring mean + ground keeps the seating
// pressure without letting the top blow up.
function betterScore(a, b) {
  if (a.front !== b.front) return a.front;
  return a.meanErr + a.groundErr < b.meanErr + b.groundErr;
}

/**
 * solveCameraAutoHeight — seat the structure on the markers automatically.
 *
 * The two TOP markers (pt0/pt1) sit at world height H; the three ground markers
 * are height-independent. So the wall height is what decides where the drawn TOP
 * corners land in the image — and the CONFIGURED height rarely matches the height
 * the clicked markers actually imply. Anchoring the sweep to the config value
 * (the old `configH × [0.8..1.5]`) meant a too-tall config could never reach the
 * true height at all: config 12ft floored the sweep at 9.6ft, so a room the
 * markers implied at 9ft rendered with its top corners ~20px high (user report
 * 2026-07-20 — "top corners don't match the plotted points"). The bottom stayed
 * seated because ground markers don't move with H, which is exactly the symptom.
 *
 * Fix: sweep an ABSOLUTE plausible wall-height range, INDEPENDENT of the config
 * input, then golden-section refine to nail the exact height the markers imply.
 * The clicked points, not the typed height, place the corners. The chosen height
 * is returned as `solvedHeight` (feet) for scene.html; the configured height
 * stays untouched as the product spec (pricing).
 */
function solveCameraAutoHeight(pts, dims, photoW, photoH) {
  const baseH = dims.wallH || 8;
  const score = (cam) => cam.meanReprojErr + (cam.plausibility || 0);
  const solveAt = (h) => {
    const cam = solveCamera(pts, Object.assign({}, dims, { wallH: h }), photoW, photoH);
    cam.solvedHeight = h;
    return cam;
  };

  // Absolute coarse sweep over realistic sunroom/screen-room wall heights (ft),
  // plus the config value itself so a good config is never worse off.
  const coarse = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13, 14];
  if (!coarse.includes(baseH)) coarse.push(baseH);
  coarse.sort((a, b) => a - b);

  let best = null;
  const cache = new Map();
  const evalH = (h) => {
    const key = h.toFixed(3);
    if (cache.has(key)) return cache.get(key);
    const cam = solveAt(h);
    cache.set(key, cam);
    if (!best || score(cam) < score(best)) best = cam;
    return cam;
  };
  for (const h of coarse) evalH(h);

  // Golden-section refine around the coarse winner: the height axis is smooth
  // and unimodal near the optimum, so a 1-D search kills the grid granularity
  // (the old sweep left ~3px of top error just from 0.5ft steps).
  const idx = coarse.indexOf(best.solvedHeight);
  let lo = coarse[Math.max(0, idx - 1)];
  let hi = coarse[Math.min(coarse.length - 1, idx + 1)];
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = hi - gr * (hi - lo);
  let d = lo + gr * (hi - lo);
  let fc = score(evalH(c));
  let fd = score(evalH(d));
  for (let i = 0; i < 8 && hi - lo > 0.05; i++) {
    if (fc < fd) { hi = d; d = c; fd = fc; c = hi - gr * (hi - lo); fc = score(evalH(c)); }
    else { lo = c; c = d; fc = fd; d = lo + gr * (hi - lo); fd = score(evalH(d)); }
  }

  console.log(
    `[pnp] auto-height: ${best.solvedHeight.toFixed(2)}ft ` +
      `(config ${baseH.toFixed(2)}ft) reproj=${best.meanReprojErr.toFixed(1)}px ` +
      `groundErr=${best.groundReprojErr.toFixed(1)}px`,
  );
  return best;
}

/**
 * solveCameraAutoFit — seat the structure on the markers even when the
 * CONFIGURED footprint doesn't match the structure in the photo.
 *
 * Same insight as auto-height, one level up: the drawn box must fit the
 * CAPTURE. If the configured side/front widths disagree with the clicked
 * points (salesperson designs an 18×10 room over a photo of a ~14×13 one),
 * no camera exists that lines the box up — the solver warps (rolls) the
 * camera several degrees trying, and the whole render LEANS. When the
 * configured dims fit well we keep them; when they fit poorly we sweep
 * scale factors around them and adopt the footprint the photo implies.
 * The adopted dims are returned as fittedDims for the renderer; pricing
 * always keeps the configured dims.
 */
function solveCameraAutoFit(pts, dims, photoW, photoH) {
  const base = solveCameraAutoHeight(pts, dims, photoW, photoH);
  base.fittedDims = { wallW_B: dims.wallW_B, wallW_C: dims.wallW_C };
  const baseScore = base.meanReprojErr + (base.plausibility || 0);
  if (baseScore <= 8) return base; // config matches the photo

  // Coarse scan of footprint scales at the configured height (single solve
  // each — cheap), then full auto-height only on the most promising pair.
  const factors = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4];
  let cand = null;
  for (const fs of factors) {
    for (const ff of factors) {
      const d = {
        wallW_B: dims.wallW_B * fs,
        wallW_C: dims.wallW_C * ff,
        wallH: dims.wallH,
      };
      const c = solveCamera(pts, d, photoW, photoH);
      const cScore = c.meanReprojErr + (c.plausibility || 0);
      if (!cand || cScore < cand.err) {
        cand = { err: cScore, d };
      }
    }
  }
  const refined = solveCameraAutoHeight(pts, cand.d, photoW, photoH);
  // Adopt only a decisive improvement — otherwise trust the config.
  if (refined.meanReprojErr <= base.meanReprojErr * 0.6 && refined.meanReprojErr <= 10) {
    console.log(
      `[pnp] auto-fit: footprint ${dims.wallW_B.toFixed(1)}×${dims.wallW_C.toFixed(1)}ft ` +
        `→ ${cand.d.wallW_B.toFixed(1)}×${cand.d.wallW_C.toFixed(1)}ft ` +
        `(config didn't match the photo: ${base.meanReprojErr.toFixed(1)}px → ` +
        `${refined.meanReprojErr.toFixed(1)}px)`,
    );
    refined.fittedDims = { wallW_B: cand.d.wallW_B, wallW_C: cand.d.wallW_C };
    return refined;
  }
  return base;
}

// ─── Single flat wall (1-wall "nook fill") ────────────────────────────────────
// A 1-wall room fills a rectangular opening: 4 coplanar corners, NO side wall
// and NO depth. Because the drawn wall is COPLANAR with the 4 fit points, any
// pose that reprojects the corners onto the clicks lands the wall exactly on the
// opening — the planar focal-length ambiguity that plagues general PnP is
// harmless here (zero depth = nothing behind the plane to warp). Image order
// matches camera.tsx's 1-wall capture: top-left, top-right, bottom-right,
// bottom-left. World frame: wall in the z=0 plane, facing +Z (toward camera).
function solveCameraFlat(pts, dims, photoW, photoH) {
  const W = dims.wallW_C,
    H = dims.wallH;
  const worldPts = [
    [0, H, 0], // top-left
    [W, H, 0], // top-right
    [W, 0, 0], // bottom-right
    [0, 0, 0], // bottom-left
  ];
  const imagePts = pts.slice(0, 4).map(([nx, ny]) => [nx * photoW, ny * photoH]);
  const aspect = photoW / photoH;
  const center = [W / 2, H / 2, 0];
  // ALL FOUR corners are exact opening corners, so weight them EQUALLY — unlike
  // the L-shape solve, which down-weights the two top markers (imprecise
  // house-plane clicks the roof overhang hides). Down-weighting the tops here
  // let the height solve overshoot: the wall — and its screen panes — shot up
  // past the clicked opening into the sky (user report). Equal weights pin the
  // top corners, so the wall fills exactly the clicked quad.
  const weights = [1, 1, 1, 1];

  const span = Math.max(W, H);
  const eyes = [];
  for (const dz of [0.8 * span, 1.5 * span]) {
    for (const dx of [-W, 0, W]) {
      for (const hy of [0.5 * H, 0.9 * H, 1.4 * H]) {
        eyes.push([center[0] + dx, hy, center[2] + dz]);
      }
    }
  }
  const fovCandidates = [40, 50, 60, 70];

  let best = null;
  for (const fovY of fovCandidates) {
    for (const eye of eyes) {
      const Rc = lookAtRc(eye, center);
      const init = [...eye, ...rmatToRodrigues(Rc)];
      const sol = lmSolve(init, fovY, worldPts, imagePts, aspect, photoW, photoH, 60, weights);
      sol.penalty = plausibilityPenalty(sol, H);
      if (!best || better(sol, best)) best = sol;
    }
  }
  const polished = lmSolve(
    [...best.params.slice(0, 6), best.fovY],
    best.fovY, worldPts, imagePts, aspect, photoW, photoH, 120, weights,
  );
  polished.penalty = plausibilityPenalty(polished, H);
  if (better(polished, best)) best = polished;

  const eye = best.eye,
    Rc = best.Rc;
  const back = [Rc[0][2], Rc[1][2], Rc[2][2]];
  const up = [Rc[0][1], Rc[1][1], Rc[2][1]];
  const target = sub3(eye, back);
  console.log(
    `[pnp] flat wall solved: fovY=${best.fovY.toFixed(1)}° ` +
      `err=${best.meanErr.toFixed(1)}px cheirality=${best.front ? "ok" : "FAIL"}`,
  );
  return {
    fovY: best.fovY,
    aspect,
    position: { x: eye[0], y: eye[1], z: eye[2] },
    target: { x: target[0], y: target[1], z: target[2] },
    up: { x: up[0], y: up[1], z: up[2] },
    near: 0.1,
    far: 500,
    worldPts,
    imagePts,
    photoW,
    photoH,
    meanReprojErr: best.meanErr,
    groundReprojErr: best.groundErr,
    plausibility: best.penalty || 0,
    cheirality: best.front,
  };
}

// Sweep an absolute wall-height range (same idea as solveCameraAutoHeight): the
// clicked quad's aspect, not the typed height, decides where the top corners
// land, so pick the height whose W×H rectangle best fits the opening.
function solveCameraFlatAutoHeight(pts, dims, photoW, photoH) {
  const score = (c) => c.meanReprojErr + (c.plausibility || 0);
  const baseH = dims.wallH || 8;
  const heights = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13, 14];
  if (!heights.includes(baseH)) heights.push(baseH);
  let best = null;
  for (const h of heights) {
    const cam = solveCameraFlat(pts, Object.assign({}, dims, { wallH: h }), photoW, photoH);
    cam.solvedHeight = h;
    if (!best || score(cam) < score(best)) best = cam;
  }
  console.log(
    `[pnp] flat auto-height: ${best.solvedHeight.toFixed(2)}ft ` +
      `reproj=${best.meanReprojErr.toFixed(1)}px`,
  );
  return best;
}

function reprojectionError(camera) {
  const eye = [camera.position.x, camera.position.y, camera.position.z];
  const center = [camera.target.x, camera.target.y, camera.target.z];
  const upHint = [camera.up.x, camera.up.y, camera.up.z];
  // Rebuild the exact Three.js look-at rotation from position/target/up.
  const zc = normalize(sub3(eye, center));
  let xc = cross3(upHint, zc);
  if (norm(xc) < 1e-6) xc = [1, 0, 0];
  xc = normalize(xc);
  const yc = cross3(zc, xc);
  const Rc = [
    [xc[0], yc[0], zc[0]],
    [xc[1], yc[1], zc[1]],
    [xc[2], yc[2], zc[2]],
  ];
  const { worldPts, imagePts, aspect, photoW, photoH, fovY } = camera;
  let total = 0;
  for (let i = 0; i < worldPts.length; i++) {
    const [u, v, f] = projectPoint(eye, Rc, fovY, aspect, photoW, photoH, worldPts[i]);
    const err = Math.hypot(u - imagePts[i][0], v - imagePts[i][1]);
    total += err;
    console.log(
      `[pnp]   pt${i}: projected=(${u.toFixed(1)},${v.toFixed(1)}) ` +
        `actual=(${imagePts[i][0].toFixed(1)},${imagePts[i][1].toFixed(1)}) ` +
        `err=${err.toFixed(1)}px front=${f > 0 ? "y" : "N"}`,
    );
  }
  const mean = total / worldPts.length;
  console.log(`[pnp]   mean reprojection error: ${mean.toFixed(2)}px`);
  return mean;
}

module.exports = {
  solveCamera,
  solveCameraAutoHeight,
  solveCameraAutoFit,
  solveCameraFlatAutoHeight,
  reprojectionError,
  projectPoint,
};
