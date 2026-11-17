import { useEffect, useState, type CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  toastOffset,
  useBottomObstructionHeight,
  useOpenLayerCount,
} from "./obstruction";

/** Below this width a toast is one line at the edge of a phone (Tailwind `sm`). */
const PHONE = "(max-width: 639.98px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(PHONE).matches
  );
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

// shadcn/ui Sonner wrapper, restyled from the tokens: an overlay surface with
// the faint edge ring, ink text and an ink action with a canvas label, so
// Undo is the most visible thing on it in both themes. It stacks above
// anything that registered with `useBottomObstruction`. Below 640px, while a
// dialog or sheet is open, it moves to the top so it never covers the
// dialog's actions. One toast shows at a time on a phone or above a bar.
// Spark has no next-themes; pass the resolved `theme` in.
export function Toaster(props: ToasterProps) {
  const obstruction = useBottomObstructionHeight();
  const layers = useOpenLayerCount();
  const phone = usePhone();
  const top = phone && layers > 0;
  const topEdge = "calc(env(safe-area-inset-top) + 0.75rem)";
  const offset = {
    bottom: toastOffset(obstruction),
    left: 16,
    right: 16,
    top: topEdge,
  };
  return (
    <Sonner
      position={top ? "top-center" : "bottom-center"}
      offset={offset}
      mobileOffset={offset}
      visibleToasts={phone || obstruction > 0 ? 1 : 3}
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
          toast: "!max-w-[22rem] !text-sm !shadow-overlay",
          actionButton:
            "!bg-ink !text-canvas !text-sm !font-medium !rounded-chip !h-7 !px-2.5",
        },
      }}
      {...props}
    />
  );
}

export { toast } from "sonner";
