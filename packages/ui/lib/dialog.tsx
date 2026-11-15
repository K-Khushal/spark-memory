import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "./cn";

// shadcn/ui Dialog, restyled. How it moves is in styles.css (DESIGN.md →
// Motion): a pointer-opened dialog fades and grows from .98, a keyboard-opened
// one (Quick preview) and a full-screen viewer only fade, and a phone sheet
// rises. The ⌘K menu is a separate component and does none of this.
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-display text-lg font-semibold", className)}
      {...props}
    />
  );
}

/**
 * The top of a dialog that reads in one scrolling body: it stays put while
 * the body scrolls. Leaves room for the Close button. 16px on a phone, 24px
 * from `sm`.
 */
export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex shrink-0 flex-col gap-1 px-4 pt-4 pr-14 pb-2 sm:px-6 sm:pt-6 sm:pb-3",
        className
      )}
      {...props}
    />
  );
}

/** The one scrolling region of a dialog laid out with header and footer. */
export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 sm:px-6",
        className
      )}
      {...props}
    />
  );
}

/**
 * Actions that stay visible while the body scrolls, 8px apart, wrapping at
 * large text. On a phone it clears the home indicator.
 */
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-4 sm:pb-6",
        className
      )}
      {...props}
    />
  );
}

/** A click on a toast is not a click outside the dialog: it stays open. */
const onToast = (event: {
  target: EventTarget | null;
  preventDefault(): void;
}) => {
  if (
    event.target instanceof Element &&
    event.target.closest("[data-sonner-toaster]")
  ) {
    event.preventDefault();
  }
};

/**
 * Keeps a bottom sheet above the on-screen keyboard: browsers that resize
 * only the visual viewport leave a fixed `bottom: 0` underneath it, so the
 * footer would hide. Sets `--keyboard-inset` (px) on the element.
 */
function useKeyboardInset(element: HTMLElement | null, enabled: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!element || !enabled || !viewport) return;
    const apply = () => {
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop
      );
      element.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
      element.style.setProperty(
        "--visual-height",
        `${Math.round(viewport.height)}px`
      );
    };
    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      element.style.removeProperty("--keyboard-inset");
      element.style.removeProperty("--visual-height");
    };
  }, [element, enabled]);
}

/** How a dialog stands. `sheet`: bottom-aligned below 640px, centred above. */
/** Opt-in presentations; leave it unset for the plain fade. */
export type DialogPresentation = "dialog" | "sheet" | "fullscreen";

export function DialogContent({
  className,
  children,
  closeLabel = "Close",
  closeClassName,
  onInteractOutside,
  presentation,
  ref,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  closeLabel?: string;
  /** For a dialog on a dark surface in both themes (the image viewer). */
  closeClassName?: string;
  /**
   * With none, the dialog only fades in 150ms (what the viewers have always
   * done). `dialog` opts in to the pointer entrance (grows from .98).
   * `sheet` opts in to the phone presentation: below 640px it is bottom
   * aligned, full width, at most 92dvh, with the top corners rounded and the
   * safe area cleared; compose it from DialogHeader, DialogBody and
   * DialogFooter so one region scrolls and the actions stay put. `fullscreen`
   * (the image and PDF viewers) only fades.
   */
  presentation?: DialogPresentation;
}) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const sheet = presentation === "sheet";
  useKeyboardInset(node, sheet);
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      setNode(element);
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    },
    [ref]
  );
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-scrim"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-presentation={presentation}
        ref={setRef}
        className={cn(
          "fixed inset-0 z-50 m-auto h-fit w-[calc(100%-2rem)] max-w-lg overscroll-contain rounded-panel bg-surface text-ink shadow-overlay outline-none",
          sheet &&
            "max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-(--keyboard-inset,0px) max-sm:m-0 max-sm:flex max-sm:max-h-[min(var(--size-sheet),var(--visual-height,100dvh))] max-sm:w-full max-sm:max-w-none max-sm:flex-col max-sm:rounded-b-none",
          className
        )}
        onInteractOutside={(event) => {
          onToast(event);
          onInteractOutside?.(event);
        }}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            "absolute top-3 right-3 grid size-8 place-items-center rounded-control bg-surface/80 text-ink-muted transition-[background-color,color,transform] duration-(--duration-press) ease-out hover:bg-sunken hover:text-ink active:scale-[0.97] pointer-coarse:size-(--size-touch)",
            closeClassName
          )}
          aria-label={closeLabel}
        >
          <XIcon className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
