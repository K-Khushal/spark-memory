import type { ComponentProps } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "./cn";

// shadcn/ui Dialog, restyled. Opacity only, no zoom: Quick preview opens from
// the keyboard (Space) dozens of times a day, so it must feel instant.
export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;

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

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-ink-muted", className)}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  closeLabel = "Close",
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
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-3 right-3 grid size-8 place-items-center rounded-control bg-surface/80 text-ink-muted transition-colors duration-[120ms] hover:bg-sunken hover:text-ink"
          aria-label={closeLabel}
        >
          <XIcon className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
