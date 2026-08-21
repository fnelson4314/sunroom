// Runnable check for the gable/wing header alignment + the triangle/pentagon
// shape rule. This geometry has regressed three separate times, always the same
// way: someone changes a frame width or a branch in scene.html's `header-align`
// block and the gable wall's header stops landing on the straight wall's transom
// sill, OR a pentagon silently becomes a triangle.
//
//   node test_header_align.js
//
// Mirrors scene.html. If you change flat/rail geometry THERE, change it here.
const assert = require("assert");

// ── scene.html mirrors ───────────────────────────────────────────────────────
const thinFw = (structFwFt) => Math.min(structFwFt, 2 / 12);

// buildPanel: panel sits at +fw, height wallH-2fw; the transom sill rail is
// centred at (h - tH - fw/2) in panel coords.
const sillRailCentre = (wallH, tH, structFw) => {
  const fw = thinFw(structFw);
  return fw + (wallH - 2 * fw) - tH - fw / 2;
};

// buildWall: units stop at unitH = wallH - flat; the unit<->gable top rail is
// centred at unitH - structFw/2.
const topRailCentre = (wallH, flat, structFw) => wallH - flat - structFw / 2;

// header-align branch B: no gable transom, straight wall has one -> pentagon.
const flatBorrowed = (tH, structFw) =>
  tH + 1.5 * thinFw(structFw) - structFw / 2;

// ── The alignment that keeps breaking ────────────────────────────────────────
const WALL_SYSTEMS = { '2_inch': 2 / 12, '4_inch': 4 / 12, '6_inch': 6 / 12 };
for (const [name, structFw] of Object.entries(WALL_SYSTEMS)) {
  for (const wallH of [8, 9, 10.5, 12.47]) {
    for (const tH of [1, 1.5, 2]) {
      const flat = flatBorrowed(tH, structFw);
      const gap =
        topRailCentre(wallH, flat, structFw) - sillRailCentre(wallH, tH, structFw);
      assert.ok(
        Math.abs(gap) < 1e-9,
        `${name} wallH=${wallH} tH=${tH}: header off by ${(gap * 12).toFixed(2)}in`,
      );
      // A pentagon must STAY a pentagon — a flat that collapses to 0 silently
      // turns the gable into a triangle, which is the other half of the
      // historical flip-flop.
      assert.ok(flat > 0, `${name} tH=${tH}: flat collapsed to ${flat} (triangle!)`);
    }
  }
}
console.log("header align: sill rail == top rail for 2/4/6in, pentagon preserved");

// The historical value: back when buildWall had no thin/structural split
// (fw === structFw) the correct term was exactly "+fw". The formula must still
// reduce to that, or the fix is not the same fix that worked before.
const legacy = (tH, fw) => tH + fw;
for (const fw of [2 / 12]) {
  assert.strictEqual(flatBorrowed(1.5, fw), legacy(1.5, fw));
}
console.log("header align: reduces to the legacy +fw when fw === structFw");

// ── The INVENTED transom must match what buildPanel draws ────────────────────
// When no transom height is typed, buildPanel invents one as `h * 0.18` where
// h = unitH - thinFw*2 (the panel is inset by the THIN cosmetic frame). If
// wallTransomFt predicts that with the STRUCTURAL width instead, the borrowed
// flat is short by the difference and the header misses the sill around the
// corner — 1.44in on a 6in system (user 2026-08-20, second time this exact
// thin-vs-structural split has broken header alignment).
const investedTransom = (wallH, structFw) => (wallH - thinFw(structFw) * 2) * 0.18;
for (const [name, structFw] of Object.entries(WALL_SYSTEMS)) {
  const wallH = 8;
  const tH = investedTransom(wallH, structFw);
  const flat = flatBorrowed(tH, structFw);
  const gap =
    topRailCentre(wallH, flat, structFw) - sillRailCentre(wallH, tH, structFw);
  assert.ok(
    Math.abs(gap) < 1e-9,
    `${name}: invented-transom header off by ${(gap * 12).toFixed(2)}in`,
  );
  // and the prediction must equal the DRAWN value, not the structural-width one
  const structural = (wallH - structFw * 2) * 0.18;
  if (structFw > 2 / 12)
    assert.notStrictEqual(
      Math.round(tH * 1000),
      Math.round(structural * 1000),
      `${name}: test would pass even with the old structural-width bug`,
    );
}
console.log("header align: invented transom matches buildPanel (thin frame), all systems");

// ── The branch table (triangle vs pentagon) ──────────────────────────────────
// Shape is chosen by the user's transom selection; these are the cases the
// flip-flop bugs kept trading against each other. Mirrors the header-align
// chain: screen -> <=7ft -> carrier transom -> borrow -> excess.
const DOOR_H_FT = 7;
function shape({ screen, configuredWallH, carrierTransom, straightTransom, wallH }) {
  if (screen) return straightTransom > 0 ? "pentagon" : "triangle";
  if (configuredWallH <= DOOR_H_FT) return "triangle";
  if (carrierTransom > 0) return "triangle";
  if (straightTransom > 0) return "pentagon";
  return Math.max(0, wallH - DOOR_H_FT) > 0 ? "pentagon" : "triangle";
}
const cases = [
  // [description, input, expected]
  ["screen, room transom on", { screen: 1, straightTransom: 1.5, configuredWallH: 9, wallH: 9 }, "pentagon"],
  ["screen, no room transom", { screen: 1, straightTransom: 0, configuredWallH: 9, wallH: 9 }, "triangle"],
  ["7ft wall always triangle", { configuredWallH: 7, straightTransom: 1.5, wallH: 7.3 }, "triangle"],
  ["gable wall has own transom", { configuredWallH: 9, carrierTransom: 1.5, straightTransom: 1.5, wallH: 9 }, "triangle"],
  ["borrow straight transom", { configuredWallH: 9, carrierTransom: 0, straightTransom: 1.5, wallH: 9 }, "pentagon"],
  ["no transom anywhere, tall", { configuredWallH: 9, carrierTransom: 0, straightTransom: 0, wallH: 9 }, "pentagon"],
];
for (const [desc, input, expected] of cases) {
  const got = shape({ screen: 0, carrierTransom: 0, straightTransom: 0, ...input });
  assert.strictEqual(got, expected, `${desc}: expected ${expected}, got ${got}`);
}
console.log("header align: all 6 triangle/pentagon branches unchanged");
