// Shared by WallBuilder's and ScreenRoomBuilder's live-scale canvas preview.
// Only the pure box-fitting algorithm lives here — each caller keeps its own
// tuned constants (max width/height, min width), so this extraction cannot
// change either system's rendered proportions, only where the formula lives.
//
// Fits a wall's TRUE aspect ratio inside a max box, shrinking width (never
// stretching height past its cap) once the height limit is hit — pinning
// width and only flexing height used to draw tall walls far wider than they
// are (see the WallBuilder/ScreenRoomBuilder comments this replaced).
export function fitCanvasToBox(
  aspectRatio: number,
  maxWidth: number,
  maxHeight: number,
  minWidth: number,
): { width: number; height: number } {
  let width = maxWidth;
  let height = Math.round(maxWidth / aspectRatio);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.max(minWidth, Math.round(maxHeight * aspectRatio));
  }
  return { width, height };
}
