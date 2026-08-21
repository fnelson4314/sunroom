// Runnable check for the 36in door rule + handrail quantity. Mirrors
// distributeUnitWidths / handrailLinFt in useConfigureState.ts — if you change
// the rule there, change it here.
//   node hooks/__test_units.mjs
import assert from "node:assert";
const DOOR_UNIT_IN = 36, MAX_UNIT_IN = 48;
const ceilFt = (n) => (!n || n <= 0 ? 0 : Math.ceil(n / 12));

function distribute(totalIn, isDoor) {
  const n = isDoor.length;
  if (n === 0 || totalIn <= 0) return [];
  const doors = isDoor.filter(Boolean).length, others = n - doors;
  const remaining = totalIn - doors * DOOR_UNIT_IN;
  if (others > 0 && remaining <= 0)
    return Array(n).fill(Math.round((totalIn / n) * 10) / 10);
  if (others === 0) return Array(n).fill(Math.round((totalIn / n) * 10) / 10);
  const each = remaining / others;
  return isDoor.map((d) => (d ? DOOR_UNIT_IN : Math.round(each * 10) / 10));
}

// Doors are always exactly 36in; the rest share what's left and the wall is filled.
for (const [total, flags] of [[144,[0,1,0]], [240,[0,0,1,0,0]], [180,[1,0,0]]]) {
  const w = distribute(total, flags.map(Boolean));
  flags.forEach((f, i) => { if (f) assert.strictEqual(w[i], DOOR_UNIT_IN, `door must be 36in: ${w}`); });
  assert.ok(Math.abs(w.reduce((a,b)=>a+b,0) - total) < 0.5, `must fill the wall: ${w} vs ${total}`);
}
// No doors -> untouched even split, each within the 48in max after auto-divide.
const plain = distribute(144, [false, false, false]);
assert.deepStrictEqual(plain, [48, 48, 48]);
// All doors -> share the wall (never leave a gap).
assert.deepStrictEqual(distribute(96, [true]), [96]);
console.log("unit widths: doors fixed at 36in, others absorb, wall always filled");

// Handrail: only selected walls, minus a 36in door leaf per door, ceiled per wall.
function handrailLinFt(walls, on) {
  return walls.filter((w) => on.includes(w.id)).reduce((s, w) => {
    const doors = w.unitTypes.filter((t) => t === "door").length;
    return s + ceilFt(Math.max(0, w.widthIn - doors * DOOR_UNIT_IN));
  }, 0);
}
const walls = [
  { id: "A", widthIn: 120, unitTypes: ["screen", "door"] },   // 120-36=84 -> 7ft
  { id: "B", widthIn: 240, unitTypes: ["screen", "screen"] }, // 240      -> 20ft
  { id: "C", widthIn: 96,  unitTypes: ["door"] },             // 96-36=60 -> 5ft
];
assert.strictEqual(handrailLinFt(walls, ["A", "B", "C"]), 32);
assert.strictEqual(handrailLinFt(walls, ["B"]), 20, "unselected walls must not be charged");
assert.strictEqual(handrailLinFt(walls, []), 0, "no walls selected -> no charge");
console.log("handrail lin ft: per-wall selection honoured, 36in removed per door");
