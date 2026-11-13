import { useEffect, useRef, useState } from "react";

const hasFiles = (event: DragEvent) =>
  event.dataTransfer?.types.includes("Files") ?? false;

/**
 * Files dropped anywhere on the page are Captured. Returns whether files are
 * being dragged over the page, for the drop highlight.
 */
export function useFileDrop(onDrop: (files: File[]) => void) {
  const latest = useRef(onDrop);
  useEffect(() => {
    latest.current = onDrop;
  });
  const [over, setOver] = useState(false);

  useEffect(() => {
    // dragenter and dragleave fire for every child crossed: count them.
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Leaving the window (no relatedTarget) ends it, whatever the count.
      depth = e.relatedTarget ? Math.max(0, depth - 1) : 0;
      if (!depth) setOver(false);
    };
    const end = () => {
      depth = 0;
      setOver(false);
    };
    const overPage = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      const handled = e.defaultPrevented;
      e.preventDefault();
      depth = 0;
      setOver(false);
      if (handled) return;
      latest.current([...e.dataTransfer!.files]);
    };
    const events = [
      ["dragenter", enter],
      ["dragleave", leave],
      ["dragover", overPage],
      ["drop", drop],
      ["dragend", end],
    ] as const;
    for (const [name, handler] of events)
      window.addEventListener(name, handler);
    return () => {
      for (const [name, handler] of events)
        window.removeEventListener(name, handler);
    };
  }, []);
  return over;
}

/** The modifier key as this platform writes it: ⌘ on Apple, Ctrl elsewhere. */
export const MOD =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘"
    : "Ctrl ";

/** In a text field, or inside an open dialog, where ⌘V and `/` belong to it. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
    target.closest('[role="dialog"]') !== null);

/**
 * Desk shortcuts (DESIGN.md → Interaction baseline), registered once by the
 * sidebar so Settings and Admin share them with the Library: ⌘K or Ctrl K
 * toggles Search, `/` opens it. On the Library, ⌘V outside a text field
 * Captures. Off the Library, ⌘K is ignored in a text field or dialog.
 */
export function useLibraryShortcuts(handlers: {
  onSearch: () => void;
  onToggleSearch: () => void;
  /** Absent off the Library, so a paste there is left alone. */
  onPaste?: (data: DataTransfer) => void;
  /** Settings and Admin: ⌘K stays in a text field or an open dialog. */
  keepTyping?: boolean;
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
        if (latest.current.keepTyping && isTyping(event.target)) return;
        event.preventDefault();
        latest.current.onToggleSearch();
      } else if (event.key === "/" && !isTyping(event.target)) {
        event.preventDefault();
        latest.current.onSearch();
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const paste = latest.current.onPaste;
      if (!paste || isTyping(event.target) || !event.clipboardData) return;
      event.preventDefault();
      paste(event.clipboardData);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
}
