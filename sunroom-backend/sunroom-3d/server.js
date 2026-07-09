/**
 * server.js
 * ---------
 * Headless 3D sunroom renderer service.
 *
 * POST /render
 * {
 *   photoBase64: string,       // house photo as base64 JPEG
 *   photoW: number,
 *   photoH: number,
 *   pts: [[x,y], ...],         // 5 normalized points from camera.tsx
 *   config: { ... },           // full sunroom config dict (same as Python tasks.py receives)
 *   wallData: string,          // JSON string of wall array
 *   roofStyle: string,
 *   wallSystem: string,
 *   wallColor: string,
 *   mountHeight: string,
 *   projectionDistance: string,
 * }
 *
 * Returns: JPEG bytes (Content-Type: image/jpeg)
 *
 * The server:
 *   1. Parses the config into wall/roof specs
 *   2. Samples the shingle colour from the top 15% of the photo
 *   3. Runs the PnP solver to get camera params
 *   4. Launches Puppeteer, loads scene.html, injects the payload
 *   5. Captures the canvas and returns it
 */

"use strict";

const express = require("express");
const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const {
  solveCameraAutoHeight,
  solveCameraAutoFit,
  reprojectionError,
} = require("./pnp");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "20mb" }));

// Keep the renderer ALIVE. Node 22 hard-crashes the whole process on an unhandled
// promise rejection (and on uncaught exceptions), which drops the in-flight
// connection — the client sees "connection forcibly closed" and falls back to the
// slower Python renderer. A dev render service should log and keep serving instead,
// so one bad render (or a browser hiccup) never kills the server.
process.on("unhandledRejection", (err) => {
  console.error("[server] unhandledRejection (ignored, staying up):", err);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException (ignored, staying up):", err);
});

// ─── Shingle colour sampler (JS port of Python version) ───────────────────────

function sampleShingleColour(photoBase64) {
  // We'll do this in Puppeteer via canvas pixel sampling
  // Return null here — sampling is done inside the browser context
  // (access to ImageData API is easier there)
  return null;
}

// ─── Config parser (mirrors sunroom_renderer.py parse_config) ─────────────────

function parseConfig(body) {
  const {
    wallData = "[]",
    wallSystem = "4_inch",
    wallColor = "white",
    roofStyle = "studio",
    mountHeight = "",
    projectionDistance = "",
  } = body;

  const frameW = { "2_inch": 2, "4_inch": 4, "6_inch": 6 }[wallSystem] ?? 4;

  function toInches(val) {
    const v = parseFloat(val) || 0;
    return v > 0 && v <= 30 ? v * 12 : v;
  }

  let rawWalls = [];
  try {
    rawWalls = JSON.parse(wallData);
  } catch {}

  const walls = rawWalls.map((rw) => {
    const widthIn = toInches(rw.widthFt ?? rw.widthIn ?? "0");
    const heightIn = toInches(rw.heightFt ?? rw.heightIn ?? "0");
    const panelTypes = rw.panelTypes ?? ["fixed_glass"];
    const unitMaterials = rw.unitMaterials ?? [];
    const unitWidthsRaw = rw.unitWidths ?? [];
    const unitTransomH = rw.unitTransomHeights ?? [];
    const unitKneewallH = rw.unitKneewallHeights ?? [];
    const unitDoorStyles = rw.unitDoorStyles ?? [];
    const n = panelTypes.length;

    let unitWidths;
    if (unitWidthsRaw.length === n) {
      const parsed = unitWidthsRaw.map(Number).filter((v) => !isNaN(v));
      unitWidths =
        parsed.length === n && parsed.reduce((a, b) => a + b, 0) > 0
          ? parsed
          : Array(n).fill(widthIn / n);
    } else {
      unitWidths = Array(n).fill(widthIn / n);
    }

    const units = panelTypes.map((pt, i) => ({
      panel_type: pt,
      width_in: unitWidths[i],
      door_style: unitDoorStyles[i] ?? "sliding",
      transom_mat: (unitMaterials[i] ?? {}).transom ?? "glass",
      kneewall_mat: (unitMaterials[i] ?? {}).kneewall ?? "glass",
      transom_h_in: parseFloat(unitTransomH[i]) || 0,
      kneewall_h_in: parseFloat(unitKneewallH[i]) || 0,
    }));

    return {
      wall_id: rw.id ?? "B",
      width_in: widthIn,
      height_in: heightIn,
      frame_width_in: frameW,
      units,
      split_transom: rw.splitTransom ?? false,
      split_kneewall: rw.splitKneewall ?? false,
      gable_glass: rw.gableGlass ?? null,
    };
  });
  // Log the received combo verbatim — "MISSING" means the app didn't send it
  // (stale frontend bundle / old Celery) and the renderer will infer a pair.
  console.log(
    "[server] walls:",
    walls.map((w) => `${w.wall_id}:${w.width_in}in`),
    "wallCombo:",
    body.wallCombo || "MISSING (will infer)",
  );

  const bWall = walls.find((w) => w.wall_id === "B") ?? walls[0];
  const sideWall = walls.find((w) => ["A", "C"].includes(w.wall_id));
  const projDist = (parseFloat(projectionDistance) || 0) * 12;

  const roof = {
    style: roofStyle,
    width_in: bWall?.width_in ?? 0,
    depth_in: sideWall?.width_in ?? projDist,
    wall_height_in: bWall?.height_in ?? 0,
    mount_height_in: (parseFloat(mountHeight) || 0) * 12,
  };

  return { walls, roof, frameColour: wallColor, wallSystem };
}

// ─── PnP dimensions extractor ─────────────────────────────────────────────────

function getPnPDims(spec, combo) {
  // Wall dims for a GIVEN combo. AB → side wall A + front wall B; BC → side B +
  // front C. sideWall sits at X=0 (its width is the depth, wallW_B); frontWall
  // faces the camera (wallW_C).
  const w = spec.walls;
  const pick = (id, idx) => w.find((x) => x.wall_id === id) || w[idx];
  const sideWall = combo === "AB" ? pick("A", 0) : pick("B", 0);
  const frontWall = combo === "AB" ? pick("B", 1) : pick("C", 1);
  return {
    wallW_B: (sideWall?.width_in || 216) / 12,
    wallW_C: (frontWall?.width_in || 120) / 12,
    wallH: (sideWall?.height_in || 96) / 12,
  };
}

// Resolve WHICH two walls the camera saw + the camera pose, in one step.
//   1. Explicit combo from the app → trust it, solve once.
//   2. No combo but the wall set implies it (A without C → AB; no A → BC) →
//      solve once.
//   3. Ambiguous (a 3-wall room, A+B+C all present, combo lost — e.g. stale
//      frontend bundle or an old draft) → GEOMETRIC AUTO-DETECT: solve the
//      camera under BOTH mappings and keep whichever reprojects the captured
//      5 points better. The wrong mapping fits visibly worse (e.g. 30px vs
//      18px on a real capture), so the photo itself tells us the answer.
function resolvePose(spec, wallCombo, pts, photoW, photoH) {
  const ids = new Set(spec.walls.map((x) => x.wall_id));
  let combo = wallCombo === "AB" || wallCombo === "BC" ? wallCombo : null;
  let how = "explicit";
  if (!combo) {
    if (ids.has("A") && !ids.has("C")) {
      combo = "AB";
      how = "implied by wall set";
    } else if (!ids.has("A")) {
      combo = "BC";
      how = "implied by wall set";
    }
  }
  if (!combo) {
    // Ambiguous — try both mappings (configured dims), keep the better fit.
    const camAB = solveCameraAutoHeight(pts, getPnPDims(spec, "AB"), photoW, photoH);
    const camBC = solveCameraAutoHeight(pts, getPnPDims(spec, "BC"), photoW, photoH);
    const errAB = reprojectionError(camAB);
    const errBC = reprojectionError(camBC);
    combo = errAB < errBC ? "AB" : "BC";
    how = `auto-detected (fit AB=${errAB.toFixed(1)}px vs BC=${errBC.toFixed(1)}px)`;
  }
  // Final solve for the chosen combo, with footprint auto-fit: if the
  // CONFIGURED wall widths don't match the structure in the photo, no camera
  // can align the box — it warps/leans instead. Auto-fit sizes the DRAWN
  // footprint to the capture (pricing keeps the configured dims).
  const dims = getPnPDims(spec, combo);
  const camParams = solveCameraAutoFit(pts, dims, photoW, photoH);
  if (camParams.fittedDims) {
    dims.wallW_B = camParams.fittedDims.wallW_B;
    dims.wallW_C = camParams.fittedDims.wallW_C;
  }
  console.log(`[render] combo=${combo} (${how})`);
  return { combo, dims, camParams };
}

// ─── Puppeteer pool (single instance, reused across requests) ─────────────────

let browser = null;

// Puppeteer changed the connection check: <=v21 used browser.isConnected()
// (a method), v22+ uses browser.connected (a getter). Support both.
function browserConnected(b) {
  if (!b) return false;
  if (typeof b.isConnected === "function") return b.isConnected();
  if (typeof b.connected === "boolean") return b.connected;
  return true; // can't tell — assume it's alive
}

async function getBrowser() {
  if (!browserConnected(browser)) {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        // Software WebGL (no GPU) — works headless on any machine/Railway.
        // Newer Chrome deprecated --use-gl=swiftshader and now gates software
        // WebGL behind --enable-unsafe-swiftshader, routed through ANGLE.
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
      ],
    });
  }
  return browser;
}

// ─── Core render function ─────────────────────────────────────────────────────

async function render3D(body) {
  const { photoBase64, photoW, photoH } = body;
  let { pts } = body;
  const spec = parseConfig(body);

  // Under-existing captures trace the existing roofline, and its interior
  // vertex nearest (in x) to the front-corner GROUND marker is the front
  // corner's TOP — a free 6th correspondence that pins the corner height.
  // Without it the pose family is ambiguous exactly there and the drawn
  // corner droops below the traced one.
  if (Array.isArray(body.roofline) && body.roofline.length >= 2 && pts?.length === 5) {
    const cornerX = pts[4][0];
    let bestV = null;
    for (const v of body.roofline) {
      if (!bestV || Math.abs(v[0] - cornerX) < Math.abs(bestV[0] - cornerX)) bestV = v;
    }
    if (bestV && Math.abs(bestV[0] - cornerX) < 0.08) {
      pts = [...pts, bestV];
      console.log(
        `[render] corner-top from roofline trace: (${bestV[0].toFixed(3)}, ${bestV[1].toFixed(3)}) — using as 6th solve point`,
      );
    }
  }

  // Resolve which two walls are visible (combo) + solve the camera. When the
  // combo is missing on an ambiguous 3-wall payload this auto-detects it from
  // the capture geometry; camera height is auto-fitted so the structure seats
  // on the patio either way.
  const { combo, dims, camParams } = resolvePose(spec, body.wallCombo, pts, photoW, photoH);

  // Footprint auto-fit: if the solve adopted photo-implied wall widths, the
  // DRAWN walls must use them too (scene.html reads the spec widths). Pricing
  // is untouched — this only affects the render.
  if (camParams.fittedDims) {
    const sideWall = combo === "AB"
      ? spec.walls.find((w) => w.wall_id === "A") || spec.walls[0]
      : spec.walls.find((w) => w.wall_id === "B") || spec.walls[0];
    const frontWall = combo === "AB"
      ? spec.walls.find((w) => w.wall_id === "B") || spec.walls[1]
      : spec.walls.find((w) => w.wall_id === "C") || spec.walls[1];
    // Scale the wall frame AND its panel units by the same factor — the units
    // carry absolute widths from the config, and leaving them unscaled makes
    // the panels overflow past the resized frame.
    const rescale = (wall, newWidthIn) => {
      if (!wall || !wall.width_in) return;
      const f = newWidthIn / wall.width_in;
      wall.width_in = newWidthIn;
      for (const u of wall.units || []) u.width_in *= f;
    };
    rescale(sideWall, dims.wallW_B * 12);
    rescale(frontWall, dims.wallW_C * 12);
  }

  const reproErr = reprojectionError(camParams);
  console.log(`[render] reprojection error: ${reproErr.toFixed(1)}px`);
  console.log("Camera payload:", JSON.stringify(camParams, null, 2));

  // Warn if error is high — result may look skewed. The assumed-K Euclidean PnP
  // floors around ~16px on hand-clicked markers, so only flag clearly bad solves.
  if (reproErr > 30) {
    console.warn(
      `[render] WARNING: high reprojection error (${reproErr.toFixed(1)}px) — config dimensions may not match photo, or markers were mis-clicked`,
    );
  }
  // Cheirality failure means the pose put geometry behind the camera — it won't
  // rasterize cleanly. Should not happen now that PnP enforces it, but surface it.
  if (camParams.cheirality === false) {
    console.warn(
      `[render] WARNING: cheirality failed — PnP could not place all markers in front of the camera`,
    );
  }

  // Build payload for scene.html
  const payload = {
    photoDataUrl: `data:image/jpeg;base64,${photoBase64}`,
    camera: camParams,
    walls: spec.walls,
    roof: spec.roof,
    frameColour: spec.frameColour,
    shingleRGB: null, // sampled inside browser
    photoW,
    photoH,
    // Debug overlay (clicked-marker dots + spheres) — off unless the caller
    // opts in OR RENDER_DEBUG=1 is set on the renderer, so it never ends up
    // baked into a composite that goes to the AI repaint step.
    debug: body.debug === true || process.env.RENDER_DEBUG === "1",
    // Manual vertical nudge (feet) to seat the structure on the ground.
    dropFt: parseFloat(body.dropFt) || 0,
    // Under-existing: traced existing-roof underside polyline (normalized image
    // coords, left->right). The renderer clips walls to this line and draws a
    // header beam instead of a new roof. Null/absent for all other roof styles.
    roofline: Array.isArray(body.roofline) ? body.roofline : null,
    // Under-existing: false = "walls only" (keep the existing gable above, run the
    // walls up to it as a plain glass continuation); true/absent = add a new
    // gable/wing accent above the header. No effect on other roof styles.
    includeGableWings: body.includeGableWings !== false,
    // Which two walls to draw (AB → A+B, BC → B+C) — the RESOLVED combo (explicit,
    // implied, or geometrically auto-detected), so scene.html always matches the
    // camera solve above.
    wallCombo: combo,
    // Screen rooms (2_inch): structure-wide kneewall / chairrail / handrail.
    // These span whole walls rather than individual units, so they arrive
    // alongside wallData rather than inside it. Null for every other line.
    screenOptions:
      body.screenOptions && typeof body.screenOptions === "object"
        ? body.screenOptions
        : null,
    // True when the walls are insect screen rather than glass. Drives the panel
    // material: matte dark mesh, no sky sheen, no clearcoat.
    isScreenRoom: spec.wallSystem === "2_inch",
  };

  // A nonzero dropFt is the ONLY thing that shifts the structure vertically in
  // world space — a negative value lifts it off the ground (floats). Surface it
  // so a stray .env value can't silently float the whole structure.
  console.log(
    `[render] dropFt=${payload.dropFt} (negative lifts the structure UP), ` +
      `solvedHeight=${camParams.solvedHeight}ft`,
  );

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sceneFile = path.resolve(__dirname, "scene.html");
  const sceneURL = `file://${sceneFile}?config=${encodeURIComponent(payloadB64)}`;

  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({
      width: photoW,
      height: photoH,
      deviceScaleFactor: 1,
    });

    // Inject shingle sampler before scene script runs
    await page.evaluateOnNewDocument(() => {
      window.__shingleSampler = true;
    });

    page.on("console", (msg) => console.log("[browser]", msg.text()));
    await page.goto(sceneURL, { waitUntil: "networkidle0", timeout: 30000 });

    // The scene sets window.__result = { composite, mask } when both render
    // passes finish, or window.__error on failure.
    await page
      .waitForFunction(
        () => window.__result !== undefined || window.__error !== undefined,
        { timeout: 20000 },
      )
      .catch(() => {});

    const renderError = await page.evaluate(() => window.__error);
    if (renderError) throw new Error(`Scene error: ${renderError}`);

    const result = await page.evaluate(() => window.__result);
    if (!result || !result.composite) throw new Error("No result from scene");

    // Strip data-URL prefixes → raw base64 strings.
    const strip = (d) => (d ? d.replace(/^data:image\/\w+;base64,/, "") : null);
    return { composite: strip(result.composite), mask: strip(result.mask), combo };
  } finally {
    // Closing a page on a browser that already died throws — never let that
    // rejection escape and crash the process.
    await page.close().catch(() => {});
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_, res) => res.json({ status: "ok" }));

app.post("/render", async (req, res) => {
  const start = Date.now();
  try {
    const { pts, photoBase64, photoW, photoH } = req.body;

    if (!pts || pts.length < 5)
      return res.status(400).json({ error: "Need 5 pts" });
    if (!photoBase64)
      return res.status(400).json({ error: "Need photoBase64" });
    if (!photoW || !photoH)
      return res.status(400).json({ error: "Need photoW and photoH" });

    // If a render fails because the Puppeteer browser died mid-request, relaunch
    // a fresh one and try ONCE more before giving up. Otherwise a single browser
    // crash would fail the whole request and force the Python fallback.
    let composite, mask, combo;
    try {
      ({ composite, mask, combo } = await render3D(req.body));
    } catch (firstErr) {
      console.warn(
        `[render] first attempt failed (${firstErr.message}) — relaunching browser and retrying`,
      );
      try {
        if (browser) await browser.close().catch(() => {});
      } catch {}
      browser = null;
      ({ composite, mask, combo } = await render3D(req.body));
    }

    console.log(
      `[render] completed in ${Date.now() - start}ms ` +
        `(composite ${composite.length}b, mask ${mask ? mask.length + "b" : "none"})`,
    );
    // JSON: the composite, the exact structure mask, and the RESOLVED wall
    // combo (explicit / inferred / geometrically auto-detected). The backend
    // MUST build the AI prompt with this combo � if the prompt describes one
    // wall pair while the composite shows the other, FLUX repaints a scrambled
    // patchwork of panels trying to satisfy both.
    res.json({ composite, mask, combo });
  } catch (err) {
    console.error("[render] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`[server] 3D renderer listening on :${PORT}`);
  // Warm up browser
  try {
    await getBrowser();
    console.log("[server] Puppeteer browser ready");
  } catch (err) {
    console.error("[server] Browser warmup failed:", err.message);
  }
});

module.exports = { parseConfig, getPnPDims };
