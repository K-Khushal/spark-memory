import { focusDeskControl } from "../shell";

/** Dialogs opened by shortcuts have no Radix trigger to return focus to.
 * A deleted tile or a closed Search row is also gone. Restore to the wall's
 * roving tab stop, or Capture when empty, after the closing focus scope exits.
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
    const tile = document.querySelector<HTMLElement>(
      'main [role="listitem"][tabindex="0"]'
    );
    if (tile) tile.focus();
    else focusDeskControl("capture");
  });
}
