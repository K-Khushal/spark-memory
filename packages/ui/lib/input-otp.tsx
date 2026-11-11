import { useContext, type ComponentProps } from "react";
import { OTPInput, OTPInputContext } from "input-otp";
import { cn } from "./cn";

// shadcn/ui InputOTP, restyled: separate slots with the control edge, the
// focus ring on the active slot, tabular digits.
export function InputOTP({
  className,
  containerClassName,
  ...props
}: ComponentProps<typeof OTPInput> & { containerClassName?: string }) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        "flex items-center gap-2 has-disabled:opacity-50",
        containerClassName
      )}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  );
}

export function InputOTPGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props} />
  );
}

export function InputOTPSlot({
  index,
  className,
  ...props
}: ComponentProps<"div"> & { index: number }) {
  const slot = useContext(OTPInputContext)?.slots[index];
  return (
    <div
      data-slot="input-otp-slot"
      data-active={slot?.isActive}
      className={cn(
        "relative flex h-12 max-w-12 min-w-0 flex-1 items-center justify-center rounded-control border border-line-strong bg-surface text-md font-medium text-ink tabular transition-[border-color] duration-(--duration-press) ease-out data-[active=true]:outline-2 data-[active=true]:outline-offset-2 data-[active=true]:outline-ring aria-invalid:border-danger",
        className
      )}
      {...props}
    >
      {slot?.char}
      {slot?.hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-caret-blink bg-ink" />
        </div>
      )}
    </div>
  );
}
