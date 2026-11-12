import type { THEMES } from "@spark/ui/tokens";
/** Runs entirely in the isolated page world. The page never receives pixels. */
export async function selectRegion(themes: typeof THEMES) {
  const theme =
    themes[
      matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    ];
  const previous = document.activeElement;
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  const layer = document.createElement("div");
  layer.tabIndex = 0;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute(
    "aria-label",
    "Select Region. Arrow Keys Resize. Control Arrow Keys Move. Enter Captures. Escape Cancels."
  );
  layer.style.cssText = `position:fixed;inset:0;cursor:crosshair;touch-action:none;outline:2px solid ${theme.ring};outline-offset:-2px`;
  const box = document.createElement("div");
  box.style.cssText = `position:absolute;pointer-events:none;background:${theme.spark};opacity:.25;transform-origin:top left;width:1px;height:1px;display:none`;
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.style.cssText = `position:absolute;right:16px;top:16px;min-width:80px;min-height:44px;border:2px solid ${theme["line-strong"]};border-radius:8px;background:${theme.surface};color:${theme.ink};font:500 15px system-ui;cursor:pointer`;
  layer.append(box, cancel);
  root.append(layer);
  document.documentElement.append(host);
  layer.focus();
  return new Promise<
    | {
        a: { x: number; y: number };
        b: { x: number; y: number };
        width: number;
        height: number;
      }
    | undefined
  >((resolve) => {
    let a: { x: number; y: number } | undefined;
    const width = innerWidth,
      height = innerHeight,
      scroll = [scrollX, scrollY];
    let finished = false;
    const finish = (b?: { x: number; y: number }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener("resize", invalidated);
      window.removeEventListener("scroll", invalidated, true);
      host.remove();
      if (previous instanceof HTMLElement)
        previous.focus({ preventScroll: true });
      const complete = () =>
        resolve(
          a &&
            b &&
            innerWidth === width &&
            innerHeight === height &&
            scroll[0] === scrollX &&
            scroll[1] === scrollY
            ? { a, b, width, height }
            : undefined
        );
      // Cancellation and hidden tabs must release the background dispatcher
      // without relying on animation frames, which hidden documents suspend.
      if (!a || !b || document.hidden) {
        complete();
        return;
      }
      let painted = false;
      let frame: number;
      const deadline = setTimeout(settle, 100);
      function settle() {
        if (painted) return;
        painted = true;
        clearTimeout(deadline);
        cancelAnimationFrame(frame);
        complete();
      }
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(settle);
      });
    };
    const invalidated = () => finish();
    const timer = setTimeout(() => finish(), 60_000);
    window.addEventListener("resize", invalidated);
    window.addEventListener("scroll", invalidated, true);
    cancel.onclick = () => finish();
    let keyboard = { x: Math.min(200, width), y: Math.min(200, height) };
    const draw = (b: { x: number; y: number }) => {
      if (!a) return;
      box.style.display = "block";
      box.style.left = Math.min(a.x, b.x) + "px";
      box.style.top = Math.min(a.y, b.y) + "px";
      box.style.transform = `scale(${Math.abs(b.x - a.x)},${Math.abs(b.y - a.y)})`;
    };
    layer.onkeydown = (event) => {
      if (event.key.startsWith("Arrow") && event.target !== cancel) {
        event.preventDefault();
        event.stopPropagation();
        a ??= { x: Math.min(100, width / 4), y: Math.min(100, height / 4) };
        const step = event.shiftKey ? 1 : 10;
        if (event.ctrlKey || event.metaKey) {
          const dx = Math.max(
            -Math.min(a.x, keyboard.x),
            Math.min(
              width - Math.max(a.x, keyboard.x),
              event.key === "ArrowRight"
                ? step
                : event.key === "ArrowLeft"
                  ? -step
                  : 0
            )
          );
          const dy = Math.max(
            -Math.min(a.y, keyboard.y),
            Math.min(
              height - Math.max(a.y, keyboard.y),
              event.key === "ArrowDown"
                ? step
                : event.key === "ArrowUp"
                  ? -step
                  : 0
            )
          );
          a = { x: a.x + dx, y: a.y + dy };
          keyboard = { x: keyboard.x + dx, y: keyboard.y + dy };
          draw(keyboard);
          return;
        }
        keyboard = {
          x: Math.max(
            0,
            Math.min(
              width,
              keyboard.x +
                (event.key === "ArrowRight"
                  ? step
                  : event.key === "ArrowLeft"
                    ? -step
                    : 0)
            )
          ),
          y: Math.max(
            0,
            Math.min(
              height,
              keyboard.y +
                (event.key === "ArrowDown"
                  ? step
                  : event.key === "ArrowUp"
                    ? -step
                    : 0)
            )
          ),
        };
        draw(keyboard);
      }
      if (event.key === "Enter" && event.target !== cancel && a) {
        event.preventDefault();
        finish(keyboard);
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        (root.activeElement === cancel ? layer : cancel).focus();
      }
    };
    layer.onpointerdown = (event) => {
      if (event.target === cancel || event.button !== 0) return;
      a = { x: event.clientX, y: event.clientY };
      layer.setPointerCapture(event.pointerId);
    };
    layer.onpointermove = (event) => {
      if (!a) return;
      draw({ x: event.clientX, y: event.clientY });
    };
    layer.onpointerup = (event) => {
      if (a && event.target !== cancel)
        finish({ x: event.clientX, y: event.clientY });
    };
    layer.onpointercancel = () => finish();
  });
}
