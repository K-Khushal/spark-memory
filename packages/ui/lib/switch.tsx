import type { ComponentProps } from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "./cn";

/**
 * An on/off switch (shadcn/ui on Radix), restyled from DESIGN.md: control
 * radius, not a pill; the thumb slides on `transform` only, 120ms ease-out.
 * Label it with a <label htmlFor> or aria-label.
 */
export function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-5 w-8 shrink-0 items-center rounded-chip bg-line-strong p-0.5 transition-[background-color] duration-(--duration-press) ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 data-[state=checked]:bg-ink before:absolute before:-inset-2.5",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-[4px] bg-canvas shadow-raised transition-transform duration-(--duration-press) ease-out data-[state=checked]:translate-x-3" />
    </SwitchPrimitive.Root>
  );
}
