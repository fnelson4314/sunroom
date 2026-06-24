// Champion-inspired brand palette: deep Champion blue + signature red on a
// clean light surface. Existing keys are preserved (so every screen keeps
// working); new keys (accent, *Dark, surfaceAlt, text.onPrimary) are available
// for selective red CTAs and emphasis as screens are polished.
//
// Accessibility note: secondary/tertiary text were lightened greys (#6B7280 /
// #9CA3AF) that read poorly on light backgrounds. They're darkened here so small
// labels are legible (WCAG AA against the light surface).
export const Colors = {
  primary: "#0A4A9F", // Champion blue — primary buttons, active states, tabs
  primaryDark: "#063A7E", // pressed/hover, header bars
  primaryTint: "#E7EFFA", // light blue wash for selected chips / active fills

  accent: "#E1251B", // Champion red — key CTAs, emphasis, active highlights
  accentDark: "#B81B14", // pressed red
  accentTint: "#FCE9E8", // light red wash

  background: "#F4F6F9", // clean light cool-grey backdrop
  surface: "#FFFFFF", // cards and panels
  surfaceAlt: "#EEF2F8", // subtle blue-tinted inset panels
  border: "#D7DEE7", // light grey-blue border

  text: {
    primary: "#16202E", // near-black navy
    secondary: "#465364", // darkened for legible small text (was #6B7280)
    tertiary: "#6B7280", // darkened for legible hints (was #9CA3AF)
    onPrimary: "#FFFFFF", // text/icons on blue or red fills
  },

  status: {
    complete: "#057A55", // green
    failed: "#E1251B", // Champion red (doubles as error)
    generating: "#C2410C", // amber-orange
    draft: "#6B7280", // grey
    queued: "#0A4A9F", // Champion blue
  },

  white: "#FFFFFF",
};
