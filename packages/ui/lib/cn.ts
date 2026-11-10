import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge Spark's custom scales so `text-sm text-ink` keep both.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["2xs", "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl"] },
      ],
      rounded: [{ rounded: ["chip", "control", "tile", "panel", "full"] }],
      shadow: [{ shadow: ["raised", "overlay"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
