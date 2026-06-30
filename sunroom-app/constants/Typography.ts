/**
 * Central text-size scale.
 *
 * Use a named `FontSize` token instead of a raw `fontSize: <number>` in styles,
 * so type sizing stays consistent and can be tuned in ONE place (important for
 * accessibility / legibility passes).
 *
 *   import { FontSize } from "@/constants/Typography";
 *   label: { fontSize: FontSize.body }
 *
 * Values are React Native points (px). This scale covers the app's body and
 * heading range. A few bespoke one-off sizes — large status icons, the splash
 * number, PDF/print sizes above ~30px — are intentionally left as literals at
 * their call sites; they are not part of the reusable text scale.
 */
export const FontSize = {
  micro: 11, //        smallest incidental text (rare)
  tiny: 12, //         dense secondary text
  caption: 13, //      hints, captions, pill / badge labels
  small: 14, //        secondary labels, helper text
  body: 15, //         default body text and most field labels
  callout: 16, //      slightly emphasized body / text inputs
  label: 17, //        strong labels, selected options, row prices
  subhead: 18, //      small headings
  heading: 19, //      card / sub-section headings
  title: 20, //        step + screen titles
  sectionTitle: 22, // large section titles
  largeTitle: 24, //   big totals / hero numbers
  display: 30, //      large display heading
  displayLarge: 32, // oversized display number (e.g. wall-count cards)
  icon: 48, //         glyph icons rendered as text (status ✓ / ✕)
} as const;

export type FontSizeToken = keyof typeof FontSize;

/**
 * Standard font weights (React Native expects these as strings). Provided for
 * consistency when adding new text; existing styles set weights inline.
 */
export const FontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  heavy: "800",
} as const;
