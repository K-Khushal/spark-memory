import type { ComponentProps } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "./cn";

// shadcn/ui Dialog, restyled. Opacity only, no zoom: Quick preview opens from
// the keyboard (Space) dozens of times a day, so it must feel instant.
export const Dialog = DialogPrimitive.Root;

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

export function DialogContent({
  className,
  children,
  closeLabel = "Close",
  onInteractOutside,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-1/2 overscroll-contain rounded-panel bg-surface text-ink shadow-overlay duration-150 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
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
          className="absolute top-3 right-3 grid size-8 place-items-center rounded-control bg-surface/80 text-ink-muted transition-[background-color,color,transform] duration-[120ms] ease-out hover:bg-sunken hover:text-ink active:scale-[0.97]"
          aria-label={closeLabel}
        >
          <XIcon className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
