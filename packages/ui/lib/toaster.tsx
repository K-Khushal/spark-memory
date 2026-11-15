import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { toastOffset, useBottomObstructionHeight } from "./obstruction";

// shadcn/ui Sonner wrapper, restyled from the tokens: an overlay surface with
// the faint edge ring, ink text and an ink action with a canvas label, so
// Undo is the most visible thing on it in both themes. It stacks above
// anything that registered with `useBottomObstruction`. Spark has no
// next-themes; pass the resolved `theme` in.
export function Toaster(props: ToasterProps) {
  const bottom = toastOffset(useBottomObstructionHeight());
  const offset = { bottom, left: 16, right: 16, top: 16 };
  return (
    <Sonner
      position="bottom-center"
      offset={offset}
      mobileOffset={offset}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--ink)",
          "--normal-border": "transparent",
          "--border-radius": "var(--radius-tile)",
          fontFamily: "var(--font-sans)",
          // An open dialog turns pointer events off outside itself; toast
          // actions (Undo, Restore Your Edit) must still take a click.
          pointerEvents: "auto",
        } as CSSProperties
      }
      toastOptions={{
        // Sonner sizes its text in px; rem keeps a toast in step with larger text.
        classNames: {
          toast: "!text-sm !shadow-overlay",
          actionButton:
            "!bg-ink !text-canvas !text-sm !font-medium !rounded-chip !h-7 !px-2.5",
        },
      }}
      {...props}
    />
  );
}

export { toast } from "sonner";
