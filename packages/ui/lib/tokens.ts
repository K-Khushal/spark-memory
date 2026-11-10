// Spark design tokens: the single source of truth for values that every
// client shares (web dashboard, extension popup, later Expo). styles.css
// mirrors these as CSS custom properties; tests/tokens.test.ts keeps the two
// in step and checks contrast. Hex only, so native clients can read them.

export const THEMES = {
  light: {
    canvas: "#F2F3EF",
    surface: "#FFFFFF",
    sunken: "#E8EAE4",
    ink: "#151714",
    "ink-muted": "#585D56",
    line: "#DDE0D8",
    "line-strong": "#8A8F87",
    ring: "#151714",
    spark: "#E4F04A",
    "on-spark": "#151714",
    danger: "#B42D1A",
    indexing: "#8A5A00",
    searchable: "#2D7048",
  },
  dark: {
    canvas: "#13161B",
    surface: "#1B1F26",
    sunken: "#0E1014",
    ink: "#ECEEE8",
    "ink-muted": "#A3A8A0",
    line: "#2A2F37",
    "line-strong": "#6B727D",
    ring: "#ECEEE8",
    spark: "#E4F04A",
    "on-spark": "#151714",
    danger: "#FF8A73",
    indexing: "#F0B85C",
    searchable: "#74CF95",
  },
} as const;

export type ThemeName = keyof typeof THEMES;
export type ColorToken = keyof (typeof THEMES)["light"];

/** Colours offered as search filters, named the way people say them. */
export const FILTER_COLOURS = [
  { name: "Red", hex: "#D8352A" },
  { name: "Orange", hex: "#EE7A1C" },
  { name: "Yellow", hex: "#F2C824" },
  { name: "Green", hex: "#3E9B4F" },
  { name: "Teal", hex: "#1C9C9C" },
  { name: "Blue", hex: "#2F6FE0" },
  { name: "Purple", hex: "#7B4FD6" },
  { name: "Pink", hex: "#E25C9E" },
  { name: "Brown", hex: "#8B5A35" },
  { name: "Black", hex: "#1A1A1A" },
  { name: "Grey", hex: "#9A9A9A" },
  { name: "White", hex: "#F7F7F5" },
] as const;

/** Durations in ms. See DESIGN.md → Motion for when each applies. */
export const DURATION = { press: 120, small: 180, panel: 260 } as const;

/** Cubic-bézier control points. Never ease-in for UI. */
export const EASING = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const;

/** Motion springs: critically damped unless a gesture carried momentum. */
export const SPRING = {
  settle: { type: "spring", bounce: 0, visualDuration: 0.3 },
  fling: { type: "spring", bounce: 0.2, visualDuration: 0.35 },
} as const;

/** Radius in px, by hierarchy: smaller things get smaller corners. */
export const RADIUS = { chip: 6, control: 8, tile: 12, panel: 16 } as const;

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two #RRGGBB colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
