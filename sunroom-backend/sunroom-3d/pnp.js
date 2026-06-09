/**
 * pnp.js
 * ------
 * Solves the 3x4 projection matrix P from 5 point correspondences
 * and converts it directly to a Three.js-compatible camera matrix.
 *
 * Instead of decomposing P into K/R/t (which is numerically fragile),
 * we convert P directly into the Three.js projectionMatrix format.
 *
 * Three.js uses column-major 4x4 matrices. We build:
 *   - projectionMatrix  from P + image dimensions
 *   - matrixWorldInverse from P (camera extrinsics)
 *
 * COORDINATE SYSTEM
 * World origin = pt3 (left house wall bottom)
 * +X right along house wall, +Y up, +Z toward camera
 *
 * BC world points:
 *   pt0 [0,       H, 0 ]
 *   pt1 [wallW_C, H, wallW_B]
 *   pt2 [wallW_C, 0, wallW_B]
 *   pt3 [0,       0, 0 ]  <- origin
 *   pt4 [0,       0, wallW_B]
 */

"use strict";

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

function transpose(A) {
  return A[0].map((_, j) => A.map((r) => r[j]));
}
function mmul(A, B) {
  const Bt = transpose(B);
  return A.map((r) => Bt.map((c) => dot(r, c)));
}

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

function nullSpace(A) {
  const At = transpose(A),
    AtA = mmul(At, A),
    n = AtA.length;
  const M = AtA.map((r, i) => r.map((v, j) => v + (i === j ? 1e-7 : 0)));
  let v = Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0.01));
  const nv = norm(v);
  for (let i = 0; i < v.length; i++) v[i] /= nv;
  for (let iter = 0; iter < 400; iter++) {
    const w = luSolve(M, v);
    const nw = norm(w);
    for (let i = 0; i < w.length; i++) w[i] /= nw;
    const diff = Math.max(
      ...w.map((wi, i) => Math.abs(Math.abs(wi) - Math.abs(v[i]))),
    );
    v = w;
    if (diff < 1e-14) break;
  }
  return v;
}

function buildDLT(worldPts, imagePts) {
  return worldPts.flatMap(
    ([X, Y, Z],
    [i]?.[i],
    (_, i) => {
      const [u, v] = imagePts[i];
      return [
        [0, 0, 0, 0, -X, -Y, -Z, -1, v * X, v * Y, v * Z, v],
        [X, Y, Z, 1, 0, 0, 0, 0, -u * X, -u * Y, -u * Z, -u],
      ];
    }),
  );
}

// Fixed DLT builder (flatMap with index)
function buildDLT2(worldPts, imagePts) {
  const rows = [];
  for (let i = 0; i < worldPts.length; i++) {
    const [X, Y, Z] = worldPts[i],
      [u, v] = imagePts[i];
    rows.push([0, 0, 0, 0, -X, -Y, -Z, -1, v * X, v * Y, v * Z, v]);
    rows.push([X, Y, Z, 1, 0, 0, 0, 0, -u * X, -u * Y, -u * Z, -u]);
  }
  return rows;
}

// Camera centre = null space of P (4-vector, then dehomogenize)
function cameraCentre(P) {
  const v = nullSpace(transpose(P).map((_, i) => P.map((r) => r[i])) /* Pt */);
  // Actually null space of P itself as a map R^4->R^3
  // Solve via null space of the 3x4 P
  const Pt = transpose(P); // 4x3
  const PtP = mmul(Pt, P); // 4x4
  const c = nullSpace(PtP);
  const w = c[3] || 1e-15;
  return [c[0] / w, c[1] / w, c[2] / w];
}

/**
 * solveCamera(pts, dims, photoW, photoH)
 * Returns camera params for Three.js including the raw P matrix
 * so scene.html can build its own projection.
 */
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

  // Solve DLT
  const A = buildDLT2(worldPts, imagePts);
  const pVec = nullSpace(A);
  const P = [pVec.slice(0, 4), pVec.slice(4, 8), pVec.slice(8, 12)];

  // Camera centre
  const C = cameraCentre(P);

  // Scene centre (look-at target)
  const target = { x: wallW_C / 2, y: wallH / 2, z: wallW_B / 2 };

  // Forward = toward target
  const fwd = normalize([target.x - C[0], target.y - C[1], target.z - C[2]]);

  // Up = world Y projected perpendicular to forward
  const worldUp = [0, 1, 0];
  const right = normalize(cross3(fwd, worldUp));
  const up = normalize(cross3(right, fwd));
  // Ensure up points generally upward in image (negative Y in screen space)
  const upFinal = up[1] < 0 ? up.map((v) => -v) : up;

  // fovY: use the vertical image scale from P
  // Project two world points that differ by wallH in Y, measure pixel distance
  function project(X, Y, Z) {
    const px = P[0][0] * X + P[0][1] * Y + P[0][2] * Z + P[0][3];
    const py = P[1][0] * X + P[1][1] * Y + P[1][2] * Z + P[1][3];
    const pz = P[2][0] * X + P[2][1] * Y + P[2][2] * Z + P[2][3];
    return [px / pz, py / pz];
  }

  // Use pt3 (bottom) and pt0 (top) — both at X=0,Z=0
  const [, v_bot] = project(0, 0, 0);
  const [, v_top] = project(0, wallH, 0);
  const pixPerFt = Math.abs(v_top - v_bot) / wallH;

  // Distance from camera to origin in world space
  const distToOrigin = norm([C[0] - 0, C[1] - 0, C[2] - 0]);
  // Approximate distance to the wall plane
  const distToWall = Math.abs(dot(fwd, [-C[0], -C[1], -C[2]]));

  // fy in pixels from similar triangles: pixPerFt = fy / distToWall * 1ft
  const fy = pixPerFt * distToWall;
  const fovY = Math.max(
    20,
    Math.min(100, (2 * Math.atan(photoH / (2 * fy)) * 180) / Math.PI),
  );

  console.log(
    `[pnp] PnP solved: fovY=${fovY.toFixed(1)}° pos=(${C.map((v) => v.toFixed(2)).join(",")}) target=(${target.x},${target.y},${target.z})`,
  );

  return {
    fovY,
    aspect: photoW / photoH,
    position: { x: C[0], y: C[1], z: C[2] },
    target,
    up: { x: upFinal[0], y: upFinal[1], z: upFinal[2] },
    near: 0.1,
    far: 500,
    worldPts,
    imagePts,
    P,
  };
}

function reprojectionError(camera) {
  const { P, worldPts, imagePts } = camera;
  let total = 0;
  for (let i = 0; i < worldPts.length; i++) {
    const [X, Y, Z] = worldPts[i],
      [u0, v0] = imagePts[i];
    const px = P[0][0] * X + P[0][1] * Y + P[0][2] * Z + P[0][3];
    const py = P[1][0] * X + P[1][1] * Y + P[1][2] * Z + P[1][3];
    const pz = P[2][0] * X + P[2][1] * Y + P[2][2] * Z + P[2][3];
    const up = px / pz,
      vp = py / pz;
    const err = Math.sqrt((up - u0) ** 2 + (vp - v0) ** 2);
    total += err;
    console.log(
      `[pnp]   pt${i}: projected=(${up.toFixed(1)},${vp.toFixed(1)}) actual=(${u0.toFixed(1)},${v0.toFixed(1)}) err=${err.toFixed(1)}px`,
    );
  }
  const mean = total / worldPts.length;
  console.log(`[pnp]   mean reprojection error: ${mean.toFixed(2)}px`);
  return mean;
}

module.exports = { solveCamera, reprojectionError };
