let modalityTracked = false;

/** How the last interaction arrived, as `<html data-input>` says. */
export function inputModality(): "pointer" | "keyboard" {
  return typeof document !== "undefined" &&
    document.documentElement.dataset.input === "keyboard"
    ? "keyboard"
    : "pointer";
}

/**
 * Marks `<html data-input>` with how the last interaction arrived, "pointer"
 * or "keyboard", so a dialog can enter the way it was asked for. Call once at
 * start-up. Returns a function that stops tracking.
 */
export function trackInputModality(): () => void {
  if (modalityTracked || typeof document === "undefined") return () => {};
  modalityTracked = true;
  const root = document.documentElement;
  const set = (value: "pointer" | "keyboard") => () => {
    root.dataset.input = value;
  };
  const pointer = set("pointer");
  const keyboard = (event: KeyboardEvent) => {
    // A bare modifier is not a request for anything.
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key))
      root.dataset.input = "keyboard";
  };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    modalityTracked = false;
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
  };
}
