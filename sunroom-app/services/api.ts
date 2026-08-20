import axios from "axios";
import { API_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

// const BASE_URL = "https://sunroom-backend-production.up.railway.app";
const BASE_URL = "http://localhost:8000";

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  },
});

// ─── Catalog ─────────────────────────────────────────────

let catalogCache: any = null;

export async function deleteSession(sessionId: string): Promise<void> {
  // Use fetch directly to avoid axios redirect behavior that can change DELETE to GET
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { "X-API-Key": API_KEY },
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export const getFullCatalog = async () => {
  if (catalogCache) return catalogCache;
  const response = await api.get("/catalog/full");
  catalogCache = response.data;
  return catalogCache;
};

export const getProductLines = async () => {
  const response = await api.get("/catalog/products");
  return response.data;
};

export const getOptions = async (category?: string) => {
  const response = await api.get("/catalog/options", {
    params: { category },
  });
  return response.data;
};

// ─── Sessions ────────────────────────────────────────────

export const createSession = async (data: {
  product_line_id: string;
  selected_options: string[];
  width_ft?: number;
  depth_ft?: number;
  height_ft?: number;
  total_price?: number;
  customer_name?: string;
  customer_email?: string;
  salesperson_id?: string;
  notes?: string;
  house_photo_url?: string;
}) => {
  const response = await api.post("/sessions/", data);
  return response.data;
};

export const getSession = async (sessionId: string) => {
  const response = await api.get(`/sessions/${sessionId}`);
  return response.data;
};

export const updateSession = async (sessionId: string, data: object) => {
  const response = await api.patch(`/sessions/${sessionId}`, data);
  return response.data;
};

export const getSessionsBySalesperson = async (salespersonId: string) => {
  const response = await api.get(`/sessions/salesperson/${salespersonId}`);
  return response.data;
};

// ─── Draft sessions ───────────────────────────────────────

export const saveDraft = async (data: {
  session_name: string;
  salesperson_id: string;
  draft_state: Record<string, unknown>;
}): Promise<{ id: string; status: string; session_name: string }> => {
  const response = await api.post("/sessions/draft/save", data);
  return response.data;
};

export const updateDraft = async (
  draftId: string,
  data: {
    session_name?: string;
    draft_state?: Record<string, unknown>;
  },
): Promise<{ id: string }> => {
  const response = await api.patch(`/sessions/draft/save/${draftId}`, data);
  return response.data;
};

export const loadDraft = async (
  draftId: string,
): Promise<{
  id: string;
  session_name: string;
  draft_state: Record<string, unknown>;
}> => {
  const response = await api.get(`/sessions/draft/load/${draftId}`);
  return response.data;
};

// ─── Generation ──────────────────────────────────────────

export const startGeneration = async (data: {
  session_id: string;
  house_photo_url: string;
  selected_options: string[];
  box_x1: number;
  box_y1: number;
  box_x2: number;
  box_y2: number;
  wall_data?: string;
  wall_system?: string;
  roof_style?: string;
  wall_color?: string;
  mount_height?: string;
  projection_distance?: string;
  roof_only_sub_style?: string | null;
  under_existing_shape?: string | null;
  include_gable_wings?: boolean;
  wall_combo?: string | null;
  wall_corners?: string;
  // Screen rooms (2_inch) only: structure-wide kneewall / chairrail / handrail.
  // JSON string; "" for every other product line.
  screen_options?: string;
}) => {
  try {
    const response = await api.post("/generate/", data);
    return response.data;
  } catch (err: any) {
    console.error(
      "startGeneration error:",
      JSON.stringify(err?.response?.data, null, 2),
    );
    throw err;
  }
};

/**
 * 3D composite only — no AI, no credits. Used by the pre-generation preview so
 * the salesperson can confirm the configured structure sits correctly on the
 * house before spending a generation. Synchronous: resolves with the image URL.
 */
// How well the CONFIGURED structure fits the plotted markers. reprojErr is in
// photo pixels — the PnP solve floors around ~16px on hand-clicked markers, so
// a high value means no camera can align the box and the render comes out
// tilted. drawnFt differs from configuredFt when the renderer overrode the
// footprint to fit the photo.
export type PreviewFit = {
  reprojErr: number;
  groundErr: number;
  configuredHeightFt: number;
  solvedHeightFt: number;
  configuredFt: { side: number; front: number };
  drawnFt: { side: number; front: number };
};

export type PreviewResult = { url: string; fit: PreviewFit | null };

export const previewComposite = async (data: {
  house_photo_url: string;
  box_x1: number;
  box_y1: number;
  box_x2: number;
  box_y2: number;
  wall_data?: string;
  wall_system?: string;
  roof_style?: string;
  wall_color?: string;
  mount_height?: string;
  projection_distance?: string;
  include_gable_wings?: boolean;
  wall_combo?: string | null;
  wall_corners?: string;
  screen_options?: string;
}): Promise<PreviewResult> => {
  // session_id/selected_options are required by the shared request model but
  // unused by the preview (it writes no session row).
  const response = await api.post(
    "/generate/preview",
    {
      session_id: "00000000-0000-0000-0000-000000000000",
      selected_options: [],
      ...data,
    },
    // The only SYNCHRONOUS endpoint: mask prep, a Puppeteer render (which the
    // backend itself allows 90s for, and which pays a browser cold-start on the
    // first call) and two Supabase uploads all happen before it answers. The
    // 30s default aborted the client while the render went on to succeed —
    // "timeout of 30000ms exceeded" on a composite that was fine. Sit outside
    // the backend's own budget so a real failure surfaces as a real error.
    { timeout: 120000 },
  );
  return { url: response.data.composite_url, fit: response.data.fit ?? null };
};

export const getGenerationStatus = async (sessionId: string) => {
  const response = await api.get(`/generate/status/${sessionId}`);
  return response.data;
};

export const cancelGeneration = async (sessionId: string): Promise<void> => {
  await api.post(`/generate/cancel/${sessionId}`);
};

// ─── Storage ─────────────────────────────────────────────

export const uploadHousePhoto = async (
  localUri: string,
  sessionId: string,
): Promise<string> => {
  const response = await fetch(localUri);
  const blob = await response.blob();

  const filename = `house-photos/${sessionId}.jpg`;

  const uploadResponse = await fetch(
    `${SUPABASE_URL}/storage/v1/object/renders/${filename}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "image/jpeg",
        "x-upsert": "true",
      },
      body: blob,
    },
  );

  if (!uploadResponse.ok) {
    const err = await uploadResponse.text();
    throw new Error(`Photo upload failed: ${err}`);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/renders/${filename}`;
};
