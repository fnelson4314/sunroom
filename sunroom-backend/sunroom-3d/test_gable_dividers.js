// Runnable check for gable/wing pane-divider placement (gablePaneDividers).
// Mirrors the copies in scene.html and WallBuilder.tsx (gableDividerXs) — run
// this if the align/symmetry behaviour ever looks off.
//   node test_pick_symmetric.js
const assert = require("assert");

// Feet-based copy of scene.html's gablePaneDividers.
function gablePaneDividers(internal, wallW, count) {
  const k = count - 1;
  if (k <= 0) return [];
  if (k === internal.length) return internal; // panes == units → aligned
  return Array.from({ length: k }, (_, i) => (wallW / count) * (i + 1));
}

const approx = (a, b) => Math.abs(a - b) < 1e-9;
const isSymmetric = (xs, w) =>
  xs.every((x, i) => approx(x + xs[xs.length - 1 - i], w));

// 1 pane → no dividers
assert.deepStrictEqual(gablePaneDividers([3, 6], 9, 1), []);

// panes == units → exact unit divider Xs (even if uneven widths)
assert.deepStrictEqual(gablePaneDividers([2, 7], 9, 3), [2, 7]);
assert.deepStrictEqual(gablePaneDividers([4], 10, 2), [4]);

// panes != units → even spacing, and ALWAYS symmetric about the width
for (const w of [9, 10, 12]) {
  for (let count = 2; count <= 6; count++) {
    const units = count + 2; // deliberately != count so we hit the even branch
    const internal = Array.from(
      { length: units - 1 },
      (_, i) => (w / units) * (i + 1),
    );
    const got = gablePaneDividers(internal, w, count);
    assert.strictEqual(got.length, count - 1, `w=${w} count=${count} n`);
    assert.ok(isSymmetric(got, w), `w=${w} count=${count} NOT symmetric: ${got}`);
  }
}

console.log("gablePaneDividers: all checks passed");
