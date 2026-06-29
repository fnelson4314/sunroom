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
  wall_corners?: string;
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
