# Renderer Debugging Context

## Current status

RESOLVED. The sunroom aligns to the house using a Euclidean PnP camera.
scene.html builds a standard THREE.PerspectiveCamera from the pose pnp.js
returns; no offset/rotation solver remains.

## What the original bug actually was

The first instinct — "scene.html should use the PnP camera directly" — was a
trap, because the PnP camera itself was broken.

pnp.js used to solve a general 3x4 projection matrix P via a DLT null-space.
With only 5 correspondences (10 equations, 11 DOF) P is underconstrained and
comes out NON-Euclidean: its rotation block is not orthonormal. Consequences:

- It reprojects every marker to 0.0px — but that is misleading. pnp computes
  each point as u = px/pz independently, which works for either sign of pz.
- Markers straddle the camera's principal plane: pt4 (front-left ground) had
  projective depth w < 0 while the other four had w > 0.
- A GPU CANNOT rasterize that: w<0 vertices are flung to the projective
  antipode. THAT was the "weird rotation" — the front of the sunroom rendering
  behind the camera.
- Decomposing P into position/up/target/fovY gave a nonsense pose (camera at
  y=0.09 ft aimed at the sky), so feeding those into a PerspectiveCamera also
  failed.

So no scene.html camera construction could ever work — not the hardcoded one,
not the decomposed pose, not even baking P straight into the clip matrix. The
matrix was not a renderable camera.

## The fix (pnp.js rewrite)

Solve a real Euclidean pose instead of a free projective matrix:

- Assume a pinhole with principal point at the image centre and a single
  unknown focal length (the only intrinsics a THREE.PerspectiveCamera can
  represent).
- Solve 6-DOF pose (eye + Rodrigues rotation) by Levenberg-Marquardt over a
  grid of focal-length candidates x seed camera positions, then a final polish
  that also refines focal length.
- Enforce cheirality (every marker in front of the camera).

Return position / target / up / fovY. scene.html plugs these into a normal
PerspectiveCamera and the projection reproduces exactly.

## Accuracy

Reprojection floors at ~16px on the real test markers. That is the genuine
limit for a centred-principal-point pinhole on hand-clicked points — verified:
freeing the principal point reaches ~7px but only with a degenerate off-image
PP and 14 deg fov, which THREE cannot render anyway. ~16px (~1.7% of frame
width) aligns well. The previous "0.0px" was a non-renderable lie.

## Coordinate system (unchanged, positive Z)

World origin = pt3 (left house wall bottom). +X right, +Y up, +Z toward camera.
  pt0 [0,       H, 0      ]  left  / house side / top
  pt1 [wallW_C, H, wallW_B]  right / front      / top
  pt2 [wallW_C, 0, wallW_B]  right / front      / bottom
  pt3 [0,       0, 0      ]  origin
  pt4 [0,       0, wallW_B]  left  / front      / ground corner

scene.html geometry sits at these positive-Z coordinates: wall B spans Z at
X=0, wall C spans X at Z=wallW_B.

## Real test case (for re-checking pnp.js)

- worldPts as above with wallW_B=18, wallW_C=10, wallH=8 (ft)
- imagePts (px): pt0 [237,344] pt1 [818,329] pt2 [820,630] pt3 [239,604] pt4 [602,679]
- Expected solve: fovY ~50 deg, eye ~(-12, 4.2, 28.5), up ~vertical,
  cheirality ok, mean reprojection ~16px.
- `node -e` against pnp.js solveCamera + reprojectionError reproduces this.

## Baseline file

sunroom-backend/sunroom-3d/scene.html — the renderer scene.
sunroom-backend/sunroom-3d/pnp.js     — the Euclidean PnP solver.
