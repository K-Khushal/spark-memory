import type { ComponentProps } from "react";
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
