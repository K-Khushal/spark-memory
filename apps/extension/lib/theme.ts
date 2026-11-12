import { THEMES, RADIUS, TYPE_SCALE } from "@spark/ui/tokens";
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
for (const [key, value] of Object.entries(THEMES[dark ? "dark" : "light"]))
  document.documentElement.style.setProperty(`--${key}`, value);
document.documentElement.style.setProperty("--radius", `${RADIUS.control}px`);
document.documentElement.style.setProperty(
  "--font-size",
  `${TYPE_SCALE.sm.size}px`
);
document.documentElement.style.setProperty(
  "--leading",
  `${TYPE_SCALE.sm.leading}px`
);
