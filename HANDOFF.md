# HANDOFF — AB-wall render saga (state as of 2026-07-07, end of session 2)

For a fresh Claude session (or a human) picking this up. Everything below is
**uncommitted working-tree changes**; nothing has been pushed.

## The goal
User captures a house photo with 5 perspective markers, configures a sunroom
(1/2/3 walls priced), and the pipeline renders a 3D composite + AI repaint of
the sunroom onto the photo.

**Design rule (user-confirmed):** wall count (1/2/3) = how many walls are
DESIGNED & PRICED. The **AB/BC combo** = which TWO walls are RENDERED (camera
perspective). AB → draw A (left, receding side) + B (right, gable end facing
camera). BC → draw B (left side, gable) + C (front). A 3-wall room prices
A+B+C but renders only the chosen pair.

**The user's actual capture flow is UNDER-EXISTING + AB.** They place the 5
markers, then trace the existing roofline with orange taps: tap 1 = the TOP of
the shared corner post, tap 2 = the existing gable peak. This matters — see
"corner-top" below. It took ~10 iterations to learn this; don't assume a
plain-gable capture.

## Current state: what works (all verified against the user's real capture data)
- **Renderer draws the right pair**: `scene.html` + `server.js` pick walls by
  combo; AB gets a mirrored Z-ridge gable roof (gable faces camera). Verified
  both combos, 2- and 3-wall.
- **Combo auto-detect** (`server.js resolvePose()`): when the app doesn't send
  the combo, solve the camera under both mappings and keep the better geometric
  fit. Needed because the frontend bundle has repeatedly been stale.
- **Footprint auto-fit** (`pnp.js solveCameraAutoFit`): root cause of the long
  "leaning structure" saga — configured dims (10×18ft) didn't match the
  structure in the photo (~10×12.6ft). No camera can align a wrong-sized box, so
  the solver rolled ~6° trying, and everything leaned. Auto-fit sweeps footprint
  scales when configured dims fit poorly, adopts only a decisive improvement,
  and rescales the DRAWN wall widths **and their panel units** (`server.js`).
  **Pricing always keeps configured dims.** The AB/BC auto-detect intentionally
  still uses CONFIGURED dims — the detect margin comes from config asymmetry;
  auto-fitted dims fit both mappings equally and erase it.
- **Plausibility scoring** (`pnp.js plausibilityPenalty`) — the "drooping
  corner" fix. Pure reprojection crowned a physically absurd camera: **14.5° fov,
  30ft up, 65ft away, 16° roll, 1.9px fit**, beating the real pose (47° fov,
  6.4ft high, 2.5px) by 0.6px. Auto-fit's tiny errors made the ambiguity valley
  dead flat. The absurd pose mis-projects the *interior* geometry you never
  click — hence the shared corner drooping. Fix: soft pixel penalties for
  fov <35°/>85°, eye above 2.2×wallH or below 1ft, roll >6°; added to fit error
  in `betterGround`, auto-height, auto-fit, and the AB/BC comparison. Exposed as
  `camera.plausibility`.
- **Corner-top as a 6th solve point** (`server.js` + `pnp.js`) — the *decisive*
  fix for the drooping corner. The 5 markers never pin the shared corner's TOP;
  the solve guessed it, and guessed low. But under-existing captures already
  trace it: the roofline vertex nearest (in x) the front-corner GROUND marker
  IS the corner top. `server.js` extracts it and appends it as a 6th
  correspondence; `pnp.js` maps it to world `(0, wallH, wallW_B)`, weights it
  like a ground marker, and excludes it from the groundErr average (indices
  2..4 only). Log line: `corner-top from roofline trace: (x, y) — using as 6th
  solve point`. **Note: `camera.tsx` is unchanged** — no new capture step; the
  data was already there and simply unused.
- **Mirrored front-wall gotcha** (`scene.html`) — the front wall (`wallC`, which
  carries the gable in AB) is built with `rotation.y = π` + `scale.x = -1`. That
  composite is a **z-flip**: local `(x,y,z)` → world `(x,y,-z)`, so **local +z
  points AWAY from the camera there**. Frame members given a small positive
  local-z "proud" offset sink BEHIND their own tinted glass (symptom: gable/fill
  mullions look faint, frames don't continue up from the units). **Rule: center
  frame members on the glass plane and make them deeper than it**, so they stand
  proud on BOTH faces and the code is orientation-independent. Applied to the
  under-existing fill posts, header beam, and `buildGable` mullions (depth 0.16,
  centred).
- **Prompt/renderer single source of truth**: the renderer returns the combo it
  actually drew in the `/render` JSON; `tasks.py` rebuilds the FLUX prompt with
  it if it differs from the request. Before this the renderer could draw AB
  while the prompt described BC (+ a hidden 3rd wall) — FLUX reconciled by
  painting a scrambled solid/glass panel patchwork ("dismembered" renders).
  `prompt_builder.build_wall_description` is combo-aware and describes ONLY the
  two rendered walls.
- **Crash hardening**: `server.js` has unhandledRejection/uncaughtException
  guards + browser-relaunch retry. A renderer crash used to silently fall back
  to the Python renderer (which has NO combo logic) — that fallback produced
  several of the "wrong" renders during debugging. Watch the backend log for
  `falling back to Python renderer` = the 3D renderer was not used.

### PnP dead ends — do NOT retry
- Strong roll prior (`ROLL_WEIGHT=300`): sinks the camera below the eave, roof
  renders from underneath and slices across the gable ("gable disconnected").
  The surviving gentle value is **80**.
- Level-everywhere search (roll removed from the whole parameterization):
  converges to degenerate fits; `betterGround` selection makes it worse.
- Frozen-pose leveling re-aim: breaks ground seating (~17px) AND flips the
  AB/BC auto-detect.
- The surviving leveling is a trust-region refit (`lmSolveLevel`, warm-started,
  basin/seating guards) which in practice usually keeps the free pose.

## Open items
1. **Frontend bundle staleness — the biggest operational thorn.** The app has
   repeatedly NOT sent `wallCombo` (renderer logs `wallCombo: MISSING`). The
   Expo dev server was once a hung 5-day zombie (held :8081, never responded —
   probe `http://localhost:8081/status`, expect `packager-status:running`; `/`
   always times out). **Tell:** in configurator step 1 with 3 walls, the new
   bundle shows "Walls to Render" ("All 3 walls are priced; choose which 2 the
   camera sees"); the old bundle says "Wall Position". Auto-detect +
   prompt-rebuild make a missing combo harmless for asymmetric rooms, but
   near-square rooms can't be auto-detected — the app must send it eventually.
2. **AI repaint quality** (the layer above geometry): LoRA is OFF (`.env` flags
   `FLUX_*_USE_LORA`). 8 per-category training zips are ready in
   `C:/Users/fnels/Downloads/lora_packages/` (README inside; train via
   `start_lora_training.py --zip ... --dest ...`, paste weight URLs into
   `app/lora_config.py`).
3. Older follow-ups: sliding-door render fidelity, pricing SQL
   (`price_update_2026.sql` may not have been run), `NUM_VARIATIONS` in `.env`,
   under-existing real-photo test. See Claude memory files
   (`~/.claude/projects/C--Users-fnels-sunroom/memory/`) — they carry the full
   reasoning for the PnP work.

## Restart matrix (critical — much of the debugging pain was stale processes)
| Component | Reload behavior |
|---|---|
| `sunroom-3d/scene.html` | reloaded EVERY render — edits apply instantly, no restart |
| `sunroom-3d/server.js`, `pnp.js` | loaded at process start — RESTART renderer (`node --watch server.js` auto-restarts) |
| `app/tasks.py`, `prompt_builder.py`, routers | RESTART Celery worker (no autoreload) |
| FastAPI (`uvicorn --reload`) | self-reloads; verify via `http://localhost:8000/openapi.json` (check `wall_combo` in `GenerateRequest`) |
| Frontend | Metro fast-refresh unreliable here — full app reload + check the "Walls to Render" tell |

The renderer must be run by the USER — a Claude background process dies when the
session ends: `cd sunroom-backend/sunroom-3d && node --watch server.js`.
Redis runs as an automatic Windows **service** (not a terminal). Celery on
Windows needs `--pool=solo`, module `app.worker.celery_app`.

## How to debug a bad render (in order)
1. **Renderer terminal** — per render it logs: walls + received combo
   (`wallCombo: AB|BC|MISSING`), the `combo=` resolution line, `corner-top from
   roofline trace` if the 6th point engaged, `auto-fit:` if the footprint was
   resized, and `reprojection error:` (≤5px great, ~15px ok, 30px+ = dims or
   markers wrong). Also check the `Camera payload`: **fovY under ~30° or eye.y
   over ~2×wallH means a suspect pose** even if the fit looks good.
2. **Celery log**: `DEBUG 3D composite: <url>` — open it. Clean composite +
   scrambled final ⇒ AI layer (prompt / LoRA / strength). Broken composite ⇒
   geometry (renderer / pnp). This single check ends most arguments.
3. `Built prompt positive:` in the Celery log — confirm it describes the same
   wall pair the renderer drew.
4. Renderer-only iteration: POST directly to `:3001/render` with a synthetic
   photo. See `sunroom-3d/test_under_existing.py` for the payload shape; a
   scratch harness that replays the user's exact points/config lived in the
   session scratchpad (`autodetect_test.py`, `ue_ab_test.py`).

## Key files changed (all uncommitted)
- `sunroom-backend/sunroom-3d/pnp.js` — `solveCameraAutoFit`,
  `plausibilityPenalty`, optional 6th (corner-top) correspondence + groundErr
  index fix, gentle roll regularizer (80), trust-region leveling, `betterScore`
- `sunroom-backend/sunroom-3d/server.js` — combo resolve/auto-detect, corner-top
  extraction from the roofline trace, footprint auto-fit application (+ unit
  rescale), resolved combo in the `/render` response, crash guards + retry
- `sunroom-backend/sunroom-3d/scene.html` — combo-based wall pick, mirrored AB
  gable roof (`gableOnFront`), under-existing walls-only mode, frame members
  centred on the glass plane (mirrored-wall fix)
- `sunroom-backend/app/tasks.py` — passes `wall_combo` / `include_gable_wings`,
  rebuilds the prompt with the renderer-resolved combo
- `sunroom-backend/app/prompt_builder.py` — combo-aware wall descriptions
  (describes only the two rendered walls)
- `sunroom-backend/app/routers/generate.py` — `wall_combo`,
  `include_gable_wings` fields
- `sunroom-app/hooks/useConfigureState.ts` — combo semantics (3-wall keeps all
  walls), `includeGableWings`, sends `wallCombo`
- `sunroom-app/app/configure.tsx` — "Walls to Render" UI (2- and 3-wall),
  gable/wings toggle, label/hint spacing fix, FontSize refactor
- `sunroom-app/app/generate.tsx`, `services/api.ts` — pass-through fields
- `sunroom-app/constants/Typography.ts` — central FontSize scale (whole app
  refactored onto it)
- `CLAUDE.md` — corrected Celery command (`app.worker.celery_app`,
  `--pool=solo`), renderer restart rule
- `sunroom-app/app/camera.tsx` — **unchanged** (noted here because a 6th capture
  point was tried and reverted; the corner-top comes from the roofline trace)

## Last verified state
The composite geometry is correct on the user's exact capture: gable on the
right facing the camera, structure upright and seated, shared corner pinned at
the traced point (no droop), roof from above, frames running continuously from
the wall units up through the gable. Remaining visual complaints, if any, should
be triaged with step 2 above (composite vs final) before touching geometry.
