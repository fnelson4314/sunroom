// Studio shed roof: which way does it slope, and which wall carries the wing?
//
// The scene frame is TRANSPOSED between the two wall combos:
//   AB → side wall A is the x=0 slot, house at z=0,        depth along Z
//   BC → side wall C is the z=wallW_B slot, house at x=wallW_C, depth along X
// buildRoof/buildWing used to assume the AB frame unconditionally, so every BC
// capture got a shed sloping ALONG the front wall with the wing stuck on wall B
// (user report 2026-07-27).
//
// Ground truth is the rendered structure MASK: the roof must be HIGH at the
// house and LOW at the front eave in both frames. We project the two roof
// corners the frames disagree about and assert the mask covers the house-side
// one and not the front-side one.
//
//   node test_studio_wing.js          # asserts, exits nonzero on failure
//   node test_studio_wing.js --save   # also writes mask_AB.png / mask_BC.png
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { solveCameraAutoFit, projectPoint } = require("./pnp.js");

const W = 900, H = 675;
const DEPTH_FT = 14; // side wall (A/C) — house→front
const WIDTH_FT = 20; // front wall (B)
const WALL_FT = 8;
const RISE_FT = 3; // roof rise at the house
const SAVE = process.argv.includes("--save");

// ─── Scene frame per combo ────────────────────────────────────────────────────
// bSpec always fills the x=0 slot (spanning Z) and cSpec the z=wallW_B slot
// (spanning X) — see the pick() in scene.html. AB puts side wall A in the first
// and front wall B in the second; BC puts front wall B first and side wall C
// second. So the room is TRANSPOSED between them, and the house sits at z=0
// under AB but at x=wallW_C under BC. That transposition is the whole bug.
const FRAME = {
  AB: { wallW_B: DEPTH_FT, wallW_C: WIDTH_FT, wallH: WALL_FT },
  BC: { wallW_B: WIDTH_FT, wallW_C: DEPTH_FT, wallH: WALL_FT },
};

const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a) => { const n = Math.hypot(...a); return a.map((v) => v / n); };
const lookAtRc = (eye, center) => {
  const zc = unit(sub(eye, center));
  const xc = unit(cross([0, 1, 0], zc));
  const yc = cross(zc, xc);
  return [[xc[0], yc[0], zc[0]], [xc[1], yc[1], zc[1]], [xc[2], yc[2], zc[2]]];
};

// Synthetic capture: project the five markers the app captures (the pt0..pt4
// debug spheres in scene.html) from a chosen eye and hand the pixels back to the
// real solver, so the camera comes out in exactly the shape scene.html consumes.
const FOV = 55;

function makeCapture({ wallW_B, wallW_C, wallH }) {
  // Off to the -X side and well out front, so the x=0 wall faces the camera on
  // the left and the z=wallW_B wall on the right — the layout scene.html assumes.
  const eye = [-wallW_C, wallH * 0.75, wallW_B + wallW_C * 1.4];
  const Rc = lookAtRc(eye, [wallW_C / 2, wallH / 2, wallW_B / 2]);
  const proj = (p) => projectPoint(eye, Rc, FOV, W / H, W, H, p);
  const pts = [
    [0, wallH, 0],             // pt0 left wall top, far end
    [wallW_C, wallH, wallW_B], // pt1 right wall top, far end
    [wallW_C, 0, wallW_B],     // pt2 right wall bottom, far end
    [0, 0, 0],                 // pt3 left wall bottom, far end
    [0, 0, wallW_B],           // pt4 near ground corner
  ].map((p) => { const [x, y] = proj(p); return [x / W, y / H]; });
  return {
    proj,
    camParams: solveCameraAutoFit(pts, { wallW_B, wallW_C, wallH }, W, H),
  };
}

// ─── Payload ──────────────────────────────────────────────────────────────────
// A 3-wall screen room: the exact shape the report came from. gableFlatIn on the
// side walls is the structure-wide transom eaten into the wing base, so a wing
// that never gets drawn silently swallows that wall's transom too.
// parseConfig's output shape, built directly — requiring server.js would start
// its Express listener and hang the test.
const screenWall = (id, widthIn, wing, wingType = "screen") => ({
  wall_id: id,
  width_in: widthIn,
  height_in: WALL_FT * 12,
  frame_width_in: 2,
  units: [0, 1, 2].map(() => ({
    panel_type: wing ? "screen" : "screen_t",
    width_in: widthIn / 3,
    door_style: "screen",
    transom_mat: "screen",
    kneewall_mat: "screen",
    transom_h_in: wing ? 0 : 12,
    kneewall_h_in: 0,
  })),
  split_transom: false,
  split_kneewall: false,
  gable_glass: { glassType: wingType, count: 2 },
  gable_flat_in: wing ? 12 : 0,
});

// 1×1 PNG — the scene only needs a background texture it can load.
const PHOTO_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ" +
  "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function buildPayload(combo, camParams, wingType) {
  // AB draws A+B, BC draws B+C. Either way A and C are the side walls (the ones
  // that carry a wing) and B is the front wall at the low eave.
  const walls = [
    screenWall("A", DEPTH_FT * 12, true, wingType),
    screenWall("B", WIDTH_FT * 12, false, wingType),
    screenWall("C", DEPTH_FT * 12, true, wingType),
  ];
  return {
    photoDataUrl: PHOTO_URL,
    camera: camParams,
    walls,
    roof: {
      style: "studio",
      width_in: WIDTH_FT * 12,
      depth_in: DEPTH_FT * 12,
      wall_height_in: WALL_FT * 12,
      mount_height_in: (WALL_FT + RISE_FT) * 12,
    },
    frameColour: "white",
    shingleRGB: null,
    photoW: W,
    photoH: H,
    debug: false,
    dropFt: 0,
    roofline: null,
    includeGableWings: true,
    wallCombo: combo,
    screenOptions: null,
    isScreenRoom: true,
    repaintMode: "kontext",
  };
}

// ─── Probes ───────────────────────────────────────────────────────────────────
// Two points high above the wall tops, at the house end and the front-eave end
// of the slope. The shed must cover the house one and leave the eave one as open
// sky. Slope the wrong way (the bug) and they swap.
function probesFor(combo) {
  const { wallW_B, wallW_C, wallH } = FRAME[combo];
  const hi = wallH + RISE_FT * 0.8;
  return combo === "AB"
    ? { under: [wallW_C / 2, hi, wallW_B * 0.06], open: [wallW_C / 2, hi, wallW_B * 0.94] }
    : { under: [wallW_C * 0.94, hi, wallW_B / 2], open: [wallW_C * 0.06, hi, wallW_B / 2] };
}

// A point INSIDE the wing face: past halfway along the slope, above the wing's
// flat base and below the roof. On the mirrored slot (the wing wall in every BC
// capture) a FrontSide face here is backface-culled and the composite shows
// background straight through it — the "see-through solid wing".
function wingProbe(combo) {
  const { wallW_B, wallW_C, wallH } = FRAME[combo];
  const y = wallH + RISE_FT * 0.3;
  return combo === "AB"
    ? [wallW_C / 2, y, wallW_B * 0.3]
    : [wallW_C * 0.7, y, wallW_B / 2];
}

function maskAt(pixels, x, y) {
  // The mask is white structure on black. Sample a small box: a single pixel is
  // at the mercy of an antialiased frame edge.
  let white = 0, total = 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const px = Math.round(x) + dx, py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      total++;
      if (pixels[(py * W + px) * 4] > 128) white++;
    }
  }
  return total ? white / total : 0;
}

async function run() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    ],
  });
  try {
    // Third case: same BC geometry with a SOLID wing. Solid is the one wing
    // material that isn't checked by the mask asserts — the mask override is
    // DoubleSide, so a culled solid face still masks white. Only the composite
    // shows it missing.
    for (const [combo, wingType] of [["AB", "screen"], ["BC", "screen"], ["BC", "solid"]]) {
      const label = wingType === "solid" ? `${combo}-solid` : combo;
      const { proj, camParams } = makeCapture(FRAME[combo]);
      const b64 = Buffer.from(JSON.stringify(buildPayload(combo, camParams, wingType))).toString("base64");
      const url = `file://${path.resolve(__dirname, "scene.html")}?config=${encodeURIComponent(b64)}`;
      const page = await browser.newPage();
      await page.setCacheEnabled(false);
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
      if (process.env.SCENE_LOG) {
        page.on("console", (m) => console.log("[browser]", m.text()));
        page.on("pageerror", (e) => console.log("[pageerror]", e.message));
      }
      await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
      await page.waitForFunction(
        () => window.__result !== undefined || window.__error !== undefined,
        { timeout: 30000 },
      );
      const err = await page.evaluate(() => window.__error);
      assert(!err, `${label}: scene error: ${err}`);
      const { mask: maskURL, composite: compURL } = await page.evaluate(
        () => window.__result,
      );

      // Decode back to raw pixels in the page (no image lib needed).
      const decode = (u) =>
        page.evaluate(async (src) => {
          const img = new Image();
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          c.getContext("2d").drawImage(img, 0, 0);
          return Array.from(c.getContext("2d").getImageData(0, 0, img.width, img.height).data);
        }, u);
      const pixels = await decode(maskURL);

      if (SAVE) {
        for (const [name, url] of [["mask", maskURL], ["composite", compURL]]) {
          fs.writeFileSync(
            path.join(__dirname, `${name}_${label}.${url.startsWith("data:image/png") ? "png" : "jpg"}`),
            Buffer.from(url.replace(/^data:image\/\w+;base64,/, ""), "base64"),
          );
        }
      }

      const { under, open } = probesFor(combo);
      const [ux, uy] = proj(under);
      const [ox, oy] = proj(open);
      const uCov = maskAt(pixels, ux, uy);
      const oCov = maskAt(pixels, ox, oy);
      console.log(
        `${label}: house-side probe coverage ${uCov.toFixed(2)} (want ~1), ` +
          `front-eave probe ${oCov.toFixed(2)} (want ~0)`,
      );
      assert(uCov > 0.8, `${label}: roof is not high at the house (coverage ${uCov})`);
      assert(oCov < 0.2, `${label}: structure reaches roof height at the front eave (coverage ${oCov})`);

      // Solid wing must actually be PAINTED, not just masked: compare a pixel
      // inside the wing face against the untouched background corner.
      if (wingType === "solid") {
        const comp = await decode(compURL);
        const at = (x, y) => {
          const i = (Math.round(y) * W + Math.round(x)) * 4;
          return [comp[i], comp[i + 1], comp[i + 2]];
        };
        const bg = at(8, 8);
        const [wx, wy] = proj(wingProbe(combo));
        const px = at(wx, wy);
        const diff = Math.max(...px.map((v, i) => Math.abs(v - bg[i])));
        console.log(
          `${label}: wing pixel rgb(${px}) vs background rgb(${bg}) — diff ${diff} (want > 40)`,
        );
        assert(
          diff > 40,
          `${label}: solid wing is see-through — the face is backface-culled (diff ${diff})`,
        );
      }
      await page.close();
    }
    console.log("ok — studio shed slopes house→front in both frames; solid wing is opaque");
  } finally {
    await browser.close();
  }
}

run().catch((e) => { console.error(e.message); process.exit(1); });
