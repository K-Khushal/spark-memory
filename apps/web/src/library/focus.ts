import { focusMasonryKey } from "@spark/ui";
import { focusDeskControl } from "../shell";

/**
 * Focus on the wall: its roving tab stop, else (a search that found nothing,
 * or failed) the results heading, so the next key reads what happened.
 * False when the wall has neither. With `onlyIfLost` it moves nothing unless
 * focus has fallen to the page itself (the control that held it is gone), and
 * never while a dialog is open or a field is being typed in.
 */
export function focusWall({ onlyIfLost = false, preventScroll = false } = {}) {
  if (onlyIfLost) {
    const active = document.activeElement;
    const typing =
      active instanceof HTMLElement &&
      (active.isContentEditable || /^(INPUT|TEXTAREA)$/.test(active.tagName));
    if (
      typing ||
      document.querySelector('[role="dialog"][data-state="open"]') ||
      (active && active !== document.body && active.isConnected)
    )
      return false;
  }
  const target =
    document.querySelector<HTMLElement>(
      'main [role="listitem"][tabindex="0"]'
    ) ??
    document.querySelector<HTMLElement>(
      'main h2[tabindex="-1"], main [data-search] [data-slot="state-block"] h2'
    );
  if (target && !target.hasAttribute("tabindex")) target.tabIndex = -1;
  target?.focus({ preventScroll });
  return !!target;
}

/** Dialogs opened by shortcuts have no Radix trigger to return focus to.
 * A deleted tile or a closed Search row is also gone. Restore to the wall's
 * roving tab stop, else the results heading, else Capture, after the closing focus scope exits.
 * Pass `memoryId` for a dialog that was opened on a Memory: focus goes to
 * that Memory's tile (scrolling to it if the wall moved while the dialog was
 * open), and only when it is gone to the fallback above.
 */
export function restoreLibraryFocus(event: Event, memoryId?: string) {
  event.preventDefault();
  const focusedAtClose = document.activeElement;
  requestAnimationFrame(() => {
    // Search can hand directly to Memory detail or Capture. Its closing
    // scope must leave the new dialog's focus trap in charge.
    if (document.querySelector('[role="dialog"][data-state="open"]')) return;
    const active = document.activeElement;
    // Closing must not override a Tab, click or another dialog's focus.
    if (active !== document.body && active !== focusedAtClose) return;
    // A route handoff may already have restored its own control before the
    // close callback ran. That focus belongs to the destination as well.
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.isConnected &&
      !active.closest('[role="dialog"]')
    )
      return;
    if (memoryId && focusMasonryKey(memoryId)) return;
    if (!focusWall()) focusDeskControl("capture");
  });
}
