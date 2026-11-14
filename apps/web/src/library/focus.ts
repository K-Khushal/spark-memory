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
    ) ?? document.querySelector<HTMLElement>('main h2[tabindex="-1"]');
  target?.focus({ preventScroll });
  return !!target;
}

/** Dialogs opened by shortcuts have no Radix trigger to return focus to.
 * A deleted tile or a closed Search row is also gone. Restore to the wall's
 * roving tab stop, else the results heading, else Capture, after the closing focus scope exits.
 */
export function restoreLibraryFocus(event: Event) {
  event.preventDefault();
  requestAnimationFrame(() => {
    // Search can hand directly to Memory detail or Capture. Its closing
    // scope must leave the new dialog's focus trap in charge.
    if (document.querySelector('[role="dialog"][data-state="open"]')) return;
    const active = document.activeElement;
    // A route handoff may already have restored its own control. Do not
    // replace that focus with the Library fallback when this scope exits.
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.isConnected &&
      !active.closest('[role="dialog"]')
    )
      return;
    if (!focusWall()) focusDeskControl("capture");
  });
}
