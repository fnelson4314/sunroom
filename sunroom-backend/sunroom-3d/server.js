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
const { solveCameraAutoHeight, reprojectionError } = require("./pnp");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "20mb" }));

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
  console.log(
    "[server] walls:",
    walls.map((w) => `${w.wall_id}:${w.width_in}in`),
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

function getPnPDims(spec) {
  const bWall = spec.walls.find((w) => w.wall_id === "B");
  const cWall = spec.walls.find((w) => w.wall_id === "C");
  return {
    wallW_B: (bWall?.width_in || 216) / 12,
    wallW_C: (cWall?.width_in || 120) / 12,
    wallH: (bWall?.height_in || 96) / 12,
  };
}

// ─── Puppeteer pool (single instance, reused across requests) ─────────────────

let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu", // software render on Railway
        "--enable-webgl",
        "--use-gl=swiftshader", // software WebGL
      ],
    });
  }
  return browser;
}

// ─── Core render function ─────────────────────────────────────────────────────

async function render3D(body) {
  const { photoBase64, photoW, photoH, pts } = body;
  const spec = parseConfig(body);
  const dims = getPnPDims(spec);

  // Solve camera, auto-fitting the height so the structure seats on the patio
  // (the configured height usually doesn't match what the markers imply).
  const camParams = solveCameraAutoHeight(pts, dims, photoW, photoH);
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
    // Marker spheres are debug-only — off unless the caller opts in, so they
    // never end up baked into a composite that goes to the AI repaint step.
    debug: body.debug === true,
    // Manual vertical nudge (feet) to seat the structure on the ground.
    dropFt: parseFloat(body.dropFt) || 0,
  };

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
    return { composite: strip(result.composite), mask: strip(result.mask) };
  } finally {
    await page.close();
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

    const { composite, mask } = await render3D(req.body);

    console.log(
      `[render] completed in ${Date.now() - start}ms ` +
        `(composite ${composite.length}b, mask ${mask ? mask.length + "b" : "none"})`,
    );
    // JSON: both the composite and the exact structure mask, base64-encoded.
    res.json({ composite, mask });
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
