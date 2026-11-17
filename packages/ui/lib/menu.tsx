import type { ComponentProps } from "react";
import { CheckIcon } from "lucide-react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { cn } from "./cn";

// A small menu (shadcn/ui DropdownMenu on Radix), restyled: an overlay
// surface, control-radius items, 44px rows on a coarse pointer. Opened by
// pointer it grows from .98 at its trigger in 180ms; opened from the keyboard
// it is immediate (styles.css → data-slot="menu-content").
export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({
  className,
  sideOffset = 8,
  align = "start",
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="menu-content"
        sideOffset={sideOffset}
        align={align}
        collisionPadding={16}
        className={cn(
          "z-50 min-w-48 rounded-tile bg-surface p-1 text-ink shadow-overlay outline-none",
          className
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-control px-2 text-sm outline-none select-none data-[highlighted]:bg-sunken aria-[current=page]:font-medium pointer-coarse:min-h-(--size-touch) [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  );
}

/**
 * A menu item that is on or off (AI Opt-Out in the viewers): a 16px check
 * slot at the start, the same row and touch target as `MenuItem`.
 */
export function MenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menu-item"
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-control px-2 text-sm outline-none select-none data-[highlighted]:bg-sunken pointer-coarse:min-h-(--size-touch) [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      <span className="grid size-4 shrink-0 place-items-center" aria-hidden>
        <MenuPrimitive.ItemIndicator>
          <CheckIcon aria-hidden />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

/** A hairline between groups of items. */
export function MenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="menu-separator"
      className={cn("my-1 h-px bg-line", className)}
      {...props}
    />
  );
}
