import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// shadcn/ui Sonner wrapper, restyled from the tokens: an ink toast with a
// canvas-coloured action, so Undo is the most visible thing on it. Spark has
// no next-themes; pass the resolved `theme` in.
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      style={
        {
          "--normal-bg": "var(--ink)",
          "--normal-text": "var(--canvas)",
          "--normal-border": "transparent",
          "--border-radius": "var(--radius-tile)",
          fontFamily: "var(--font-sans)",
          // An open dialog turns pointer events off outside itself; toast
          // actions (Undo, Restore Your Edit) must still take a click.
          pointerEvents: "auto",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          actionButton:
            "!bg-canvas !text-ink !font-medium !rounded-chip !h-7 !px-2.5",
        },
      }}
      {...props}
    />
  );
}

export { toast } from "sonner";
