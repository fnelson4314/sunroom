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
  return res;
}

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
    if (i >= 2) groundTotal += e;
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
  const imagePts = pts.map(([nx, ny]) => [nx * photoW, ny * photoH]);
  const aspect = photoW / photoH;
  const center = [wallW_C / 2, wallH / 2, wallW_B / 2];

  // GROUND-SEATING PRIORITY. The 5 clicked markers rarely form a perfect box
  // (the two top markers sit on the house plane, the model treats one as the
  // front plane — a forgiving perspective mismatch). That leaves an irreducible
  // fit residual. With equal weights the optimiser dumps it on the rigid ground
  // points (worldPts 2,3,4), lifting the base off the patio — the "floating
  // sunroom". Weighting the ground markers heavily forces the camera to seat the
  // base on the clicked ground points; any leftover error lands on the TOP,
  // where the roof overhang/gable hides it. When the clicks DO form a clean box
  // the ground error is ~0 either way, so this never hurts a good solve.
  const weights = [1, 1, 8, 8, 8];

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
  if (betterGround(polished, best)) best = polished;

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
    cheirality: best.front,
  };
}

// Prefer cheirality-valid solutions; among equal validity, the camera that seats
// the base best (lower ground error) wins — that's what stops the float. Falls
// back to overall mean error only when ground errors tie.
function betterGround(a, b) {
  if (a.front !== b.front) return a.front;
  if (Math.abs(a.groundErr - b.groundErr) > 0.5) return a.groundErr < b.groundErr;
  return a.meanErr < b.meanErr;
}

// Prefer cheirality-valid solutions; among equal validity, lower error wins.
function better(a, b) {
  if (a.front !== b.front) return a.front; // valid beats invalid
  return a.meanErr < b.meanErr;
}

/**
 * solveCameraAutoHeight — seat the structure on the markers automatically.
 *
 * The configured wall height rarely matches the height the clicked markers
 * actually imply, which makes the structure float (it's pinned at the bottom,
 * so raising the config height only grows the top upward). Instead we sweep a
 * range of heights, solve the camera for each, and keep the one with the lowest
 * reprojection — i.e. the height at which all 5 markers (top AND bottom) line
 * up, so the base sits on the patio. The chosen height is returned as
 * `solvedHeight` (feet) for scene.html to use for the geometry; the configured
 * height stays untouched as the product spec.
 */
function solveCameraAutoHeight(pts, dims, photoW, photoH) {
  const baseH = dims.wallH || 8;
  const factors = [0.8, 0.9, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5];
  let best = null;
  for (const f of factors) {
    const h = baseH * f;
    const cam = solveCamera(pts, Object.assign({}, dims, { wallH: h }), photoW, photoH);
    // Select on overall mean error (the ground markers are already weighted
    // heavily inside solveCamera, so the chosen camera seats the base; selecting
    // on ground error alone picks too-short heights that blow out the top).
    if (!best || cam.meanReprojErr < best.meanReprojErr) {
      best = cam;
      best.solvedHeight = h;
    }
  }
  console.log(
    `[pnp] auto-height: ${best.solvedHeight.toFixed(2)}ft ` +
      `(config ${baseH.toFixed(2)}ft) reproj=${best.meanReprojErr.toFixed(1)}px ` +
      `groundErr=${best.groundReprojErr.toFixed(1)}px`,
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

module.exports = { solveCamera, solveCameraAutoHeight, reprojectionError, projectPoint };
