import { DURATION, EASING, THEMES, RADIUS, TYPE_SCALE } from "@spark/ui/tokens";
const scheme = matchMedia("(prefers-color-scheme: dark)");
const root = document.documentElement.style;
// The system theme can change while the popup is open: follow it.
const apply = () => {
  for (const [key, value] of Object.entries(
    THEMES[scheme.matches ? "dark" : "light"]
  ))
    root.setProperty(`--${key}`, value);
};
apply();
scheme.addEventListener("change", apply);
root.setProperty("--radius", `${RADIUS.control}px`);
root.setProperty("--font-size", `${TYPE_SCALE.sm.size}px`);
root.setProperty("--leading", `${TYPE_SCALE.sm.leading}px`);
root.setProperty("--duration-press", `${DURATION.press}ms`);
root.setProperty("--ease-out", `cubic-bezier(${EASING.out.join(",")})`);

root.setProperty("--font-md", `${TYPE_SCALE.md.size}px`);
root.setProperty("--font-base", `${TYPE_SCALE.base.size}px`);
