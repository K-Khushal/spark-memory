// Spark design tokens: the single source of truth for values that every
// client shares (web dashboard, extension popup, later Expo). styles.css
// mirrors these as CSS custom properties; tests/tokens.test.ts keeps the two
// in step and checks contrast. Hex only, so native clients can read them.

export const THEMES = {
  light: {
    canvas: "#FFFFFF",
    surface: "#FFFFFF",
    sunken: "#F4F5F7",
    ink: "#111214",
    "ink-muted": "#5E6066",
    line: "#E5E6EA",
    "line-strong": "#898B91",
    ring: "#111214",
    spark: "#FFE15A",
    "on-spark": "#111214",
    danger: "#C4321C",
    indexing: "#8F5B00",
    searchable: "#24774A",
  },
  dark: {
    canvas: "#0F1012",
    surface: "#1A1B1E",
    sunken: "#151619",
    ink: "#EDEEF0",
    "ink-muted": "#9D9FA5",
    line: "#26282C",
    "line-strong": "#696B71",
    ring: "#EDEEF0",
    spark: "#FFE15A",
    "on-spark": "#111214",
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
  { name: "White", hex: "#F5F6F8" },
] as const;

/** Durations in ms. See DESIGN.md → Motion for when each applies. */
export const DURATION = {
  press: 120,
  /** Opacity-only fades: Quick preview, confirm feedback, skeleton exit. */
  preview: 150,
  small: 180,
  panel: 260,
} as const;

/** Touch target in px: coarse pointers get this, icons stay 16px. */
export const TOUCH_TARGET = 44;

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

/**
 * Type scale in px (size and line height); DESIGN.md → Typography. Steps from
 * 22px up also track -0.02em.
 */
export const TYPE_SCALE = {
  "2xs": { size: 11, leading: 16 },
  xs: { size: 12, leading: 16 },
  sm: { size: 13, leading: 20 },
  base: { size: 15, leading: 24 },
  md: { size: 17, leading: 26 },
  lg: { size: 22, leading: 30, tracking: -0.02 },
  xl: { size: 28, leading: 34, tracking: -0.02 },
  "2xl": { size: 40, leading: 44, tracking: -0.02 },
  "3xl": { size: 56, leading: 58, tracking: -0.02 },
} as const;

/** Surfaces, text and lines: the tokens that must stay neutral. */
export const NEUTRAL_TOKENS = [
  "canvas",
  "surface",
  "sunken",
  "ink",
  "ink-muted",
  "line",
  "line-strong",
  "ring",
] as const satisfies readonly ColorToken[];

function linear(hex: string): [number, number, number] {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return [r, g, b];
}

/** OKLCH lightness (0–1), chroma and hue (degrees) of a #RRGGBB colour. */
export function oklch(hex: string): { l: number; c: number; h: number } {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

function luminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two #RRGGBB colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
