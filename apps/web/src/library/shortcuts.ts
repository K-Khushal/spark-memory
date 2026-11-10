import { useEffect, useRef } from "react";

/** The modifier key as this platform writes it: ⌘ on Apple, Ctrl elsewhere. */
export const MOD =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘"
    : "Ctrl ";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The Library's global shortcuts (DESIGN.md → Interaction baseline):
 * ⌘K or Ctrl K toggles Search, `/` opens it; ⌘V outside a text field Captures.
 */
export function useLibraryShortcuts(handlers: {
  onSearch: () => void;
  onToggleSearch: () => void;
  onPaste: (data: DataTransfer) => void;
}) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const k =
        event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (k) {
        event.preventDefault();
        latest.current.onToggleSearch();
      } else if (event.key === "/" && !isTyping(event.target)) {
        event.preventDefault();
        latest.current.onSearch();
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isTyping(event.target) || !event.clipboardData) return;
      event.preventDefault();
      latest.current.onPaste(event.clipboardData);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
}
