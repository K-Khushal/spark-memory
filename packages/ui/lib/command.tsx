import type { ComponentProps } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { SearchIcon } from "lucide-react";
import { cn } from "./cn";

// shadcn/ui Command (cmdk), restyled. The ⌘K palette opens and closes with
// no animation (DESIGN.md → Motion: never animate a shortcut).
export function CommandDialog({
  title,
  children,
  className,
  shouldFilter,
  ...props
}: ComponentProps<typeof DialogPrimitive.Root> & {
  title: string;
  className?: string;
  shouldFilter?: boolean;
}) {
  return (
    <DialogPrimitive.Root {...props}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed top-[12vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-panel bg-surface text-ink shadow-overlay outline-none",
            className
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {title}
          </DialogPrimitive.Title>
          <CommandPrimitive loop shouldFilter={shouldFilter}>
            {children}
          </CommandPrimitive>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex h-14 items-center gap-3 border-b border-line px-4">
      <SearchIcon className="size-5 shrink-0 text-ink-muted" aria-hidden />
      <CommandPrimitive.Input
        className={cn(
          "h-full w-full bg-transparent text-md outline-none placeholder:text-ink-muted",
          className
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn(
        "max-h-[min(60vh,28rem)] scroll-py-2 overflow-y-auto overscroll-contain p-2",
        className
      )}
      {...props}
    />
  );
}

export function CommandEmpty(
  props: ComponentProps<typeof CommandPrimitive.Empty>
) {
  return (
    <CommandPrimitive.Empty
      className="px-3 py-8 text-center text-sm text-ink-muted"
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-muted",
        className
      )}
      {...props}
    />
  );
}

export function CommandItem({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "flex cursor-default items-center gap-3 rounded-control px-2 py-2 text-sm select-none data-[selected=true]:bg-sunken",
        className
      )}
      {...props}
    />
  );
}
