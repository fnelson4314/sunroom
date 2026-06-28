# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This repo has three sub-projects:
- **`sunroom-app/`** — React Native / Expo mobile + web frontend
- **`sunroom-backend/`** — FastAPI backend with Celery async task queue
- **`sunroom-backend/sunroom-3d/`** — Node.js / Express headless renderer (Three.js via Puppeteer, port 3001)

## Dev Commands

### Frontend (`sunroom-app/`)
```bash
npm start          # Expo dev server
npm run android    # Android emulator
npm run ios        # iOS simulator
npm run web        # Web browser
```

### Backend (`sunroom-backend/`)
```bash
# API server
python -m uvicorn app.main:app --reload

# Celery worker (required for AI generation)
celery -A app.worker worker --loglevel=info

# 3D renderer service
node sunroom-3d/server.js
```

No formal test suite exists. Manual API testing hits `http://localhost:8000` directly.

## Environment Setup

**Backend** — create `sunroom-backend/.env`:
```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
REPLICATE_API_TOKEN=
REDIS_URL=redis://127.0.0.1:6379
API_KEY=dev-key-123
LORA_SCALE=0.85
RENDERER_3D_URL=http://localhost:3001
NUM_VARIATIONS=1   # 1 = single render (default, no extra credits); set e.g. 5 for parallel variations
```

**Frontend** — copy `sunroom-app/services/config.example.ts` → `sunroom-app/services/config.ts` and fill in:
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
API_KEY=dev-key-123
```

## Architecture

### Data Flow (Happy Path)

1. User photographs their house with 4–5 perspective marker points captured in `camera.tsx`
2. Photo uploads directly to Supabase Storage (bypasses backend)
3. Multi-step configurator (`configure.tsx`) collects wall system, dimensions, materials, roof style, doors, options
4. `POST /generate/` enqueues a Celery task and returns immediately
5. Celery task calls the 3D renderer service → gets a preview composite + structure mask → runs the AI repaint (FLUX). The shared setup (prompt, resize, composite, mask) runs once, then the AI repaint is **fanned out into `NUM_VARIATIONS` parallel passes** (distinct seeds) → stores the list in `configurations.render_urls` (and the first in `render_url`)
6. Frontend polls `GET /generate/status/{session_id}` every 4 seconds (`generate.tsx`); status returns `render_urls`
7. Completed renders shown in `editor.tsx` as a swipe + thumbnail gallery (the selected one flows to the quote); pricing summary in `quote.tsx`

> **Parallel variations:** `NUM_VARIATIONS` (backend `.env`, default `1`) is both the feature flag and the count — `1` = single render / no extra credits, `5` = five variations in parallel (~5× inference credits, ≈ same wall-clock). Requires a one-time migration: `ALTER TABLE configurations ADD COLUMN render_urls jsonb;` (the code degrades gracefully to single-render if the column is missing).

### Backend Routers (`sunroom-backend/app/routers/`)

| Router | Prefix | Responsibility |
|--------|--------|----------------|
| `catalog.py` | `/catalog` | Product lines, options, dimensions (read-only) |
| `sessions.py` | `/sessions` | CRUD sessions and drafts |
| `generate.py` | `/generate` | Start generation, poll status, cancel |

Key services:
- `tasks.py` — Celery task `generate_sunroom` orchestrates the full pipeline
- `replicate_service.py` — FLUX Fill API wrapper + LoRA weight management
- `prompt_builder.py` — Converts selected product options → AI prompt fragments
- `database.py` — Supabase client singleton
- `auth.py` — `X-API-Key` header validation (simple key check)

### Frontend Routing (`sunroom-app/app/`)

File-based routing via Expo Router v6. Key screens:

| File | Purpose |
|------|---------|
| `(tabs)/index.tsx` | Session list / home |
| `camera.tsx` | Capture house photo + perspective markers |
| `configure.tsx` | 9-step product configurator |
| `generate.tsx` | Polling screen during AI generation |
| `editor.tsx` | View and share renders |
| `quote.tsx` | Final pricing quote |
| `session/[id].tsx` | Session detail |

State for the configurator lives in the `useConfigureState` hook (multi-step form managing wall systems A/B/C, roof style, materials, doors, line items).

### Database (Supabase / PostgreSQL)

Key tables:
- **`configurations`** — sessions and saved drafts (`status`: `"active"` | `"saved_draft"` | `"completed"`)
- **`product_lines`** — wall systems (`2_inch`, `4_inch`, `6_inch`) with base prices
- **`options`** — upgrades/features; each has a `prompt_fragment` used by `prompt_builder.py`
- **`dimensions`** — size constraints per product line

House photos and rendered output are stored in the Supabase Storage bucket `renders`.

### Auth

All backend requests require `X-API-Key: dev-key-123` header. The frontend always sends this via the Axios wrapper at `sunroom-app/services/api.ts`. The backend validates it in `auth.py`.

### 3D Renderer (`sunroom-backend/sunroom-3d/`)

Express server wrapping a Puppeteer-driven Three.js scene (`scene.html`). Accepts a JSON config + base64 house photo, returns a JPEG with the sunroom overlaid. Called internally by the Celery task — not exposed to the frontend directly.

### AI / LoRA

- Model: Replicate FLUX Fill (inpainting)
- Custom LoRA weights are trained via `start_lora_training.py` using Replicate's `ostris/flux-dev-lora-trainer`
- `LORA_SCALE` env var controls LoRA influence at inference time
- `replicate_service.py` fetches the latest trainer version dynamically before training
