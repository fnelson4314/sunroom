import { Colors } from "./Colors";

// One status vocabulary shared by every screen that shows a session's status
// (home list, session detail, ...). Previously two independently-maintained
// copies existed with different key sets — `saved_draft` was missing from one,
// so those sessions silently fell back to a raw status string with no color.
export const STATUS_COLORS: Record<string, string> = {
  complete: Colors.status.complete,
  failed: Colors.status.failed,
  generating: Colors.status.generating,
  queued: Colors.status.generating,
  draft: Colors.status.draft,
  saved_draft: Colors.primary,
};

export const STATUS_LABELS: Record<string, string> = {
  complete: "Complete",
  failed: "Failed",
  generating: "Generating",
  queued: "Queued",
  draft: "Draft",
  saved_draft: "Saved Draft",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? Colors.text.tertiary;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
