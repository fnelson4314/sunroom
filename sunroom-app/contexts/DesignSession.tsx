import { createContext, useContext, useState, type ReactNode } from "react";

// One active design, shared across every screen so navigating between them never
// loses data. The DB draft row (draftId) is the persistent source of truth for
// the photo, plotted points, full config and customer info; this context holds
// the light cross-screen bits: which row we're on, how far the user has
// progressed (to gate the back-nav menu), and the last completed render.

// The ordered flow. index 0..n; "editor" is shown to the user as "Design".
// "generate" is a transient job screen, not a destination you jump back to —
// it's marked nonNavigable so the jump menu always shows it locked/inert.
export const FLOW_STEPS = [
  { route: "/camera", label: "Photo & Points" },
  { route: "/configure", label: "Configure" },
  { route: "/generate", label: "Generate", nonNavigable: true },
  { route: "/editor", label: "Design" },
  { route: "/quote", label: "Quote" },
] as const;

export type LastRender = {
  key: string;
  sessionId: string;
  renderUrls: string[];
} | null;

// The fields that determine the rendered image. Keep in sync with the
// startGeneration payload — if a field changes the picture it belongs here; if
// it only changes the quote/customer info it must not (so those edits reuse the
// render). Camera fields (photo/box/points) are included so re-plotting points
// invalidates the render, while wall config stays untouched.
const RENDER_KEY_FIELDS = [
  "photoUri",
  "box_x1",
  "box_y1",
  "box_x2",
  "box_y2",
  "productLineId",
  "wallSystem",
  "selectedOptions",
  "wallData",
  "screenOptions",
  "roofStyle",
  "roofOnlySubStyle",
  "underExistingShape",
  "wallCombo",
  "includeGableWings",
  "mountHeight",
  "wallColor",
  "projectionDistance",
  "wall_corners",
] as const;

export function renderKey(params: Record<string, unknown>): string {
  return RENDER_KEY_FIELDS.map((f) => String(params[f] ?? "")).join("|~|");
}

type DesignSessionValue = {
  draftId: string | null;
  setDraftId: (id: string | null) => void;
  // Furthest step reached (index into FLOW_STEPS). The back-nav menu only lets
  // you jump to steps <= this.
  furthestStep: number;
  // Advance progress to at least `step` (never moves backward).
  reachStep: (step: number) => void;
  lastRender: LastRender;
  setLastRender: (r: LastRender) => void;
  // Wipe everything when a brand-new design starts (Home → new capture).
  resetSession: (draftId?: string | null) => void;
};

const DesignSessionContext = createContext<DesignSessionValue>({
  draftId: null,
  setDraftId: () => {},
  furthestStep: 0,
  reachStep: () => {},
  lastRender: null,
  setLastRender: () => {},
  resetSession: () => {},
});

export function DesignSessionProvider({ children }: { children: ReactNode }) {
  const [draftId, setDraftId] = useState<string | null>(null);
  const [furthestStep, setFurthestStep] = useState(0);
  const [lastRender, setLastRender] = useState<LastRender>(null);

  const reachStep = (step: number) =>
    setFurthestStep((prev) => (step > prev ? step : prev));

  const resetSession = (id: string | null = null) => {
    setDraftId(id);
    setFurthestStep(0);
    setLastRender(null);
  };

  return (
    <DesignSessionContext.Provider
      value={{
        draftId,
        setDraftId,
        furthestStep,
        reachStep,
        lastRender,
        setLastRender,
        resetSession,
      }}
    >
      {children}
    </DesignSessionContext.Provider>
  );
}

export const useDesignSession = () => useContext(DesignSessionContext);
