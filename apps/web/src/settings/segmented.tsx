import { useReducedMotion } from "motion/react";
import { useState } from "react";
import { DURATION, EASING } from "@spark/ui/tokens";
export function Segmented({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const reduced = useReducedMotion();
  const [pointer, setPointer] = useState(false);
  const choices = ["system", "light", "dark"];
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="@container inline-flex w-49 max-w-full rounded-control bg-sunken p-0.5"
    >
      <div className="relative flex w-full @max-[9rem]:flex-col">
        <span
          aria-hidden
          className="pointer-events-none absolute @max-[9rem]:hidden inset-y-0 left-0 w-1/3 rounded-control bg-surface shadow-raised motion-reduce:transition-none"
          style={{
            transform: `translateX(${choices.indexOf(value) * 100}%)`,
            transition:
              pointer && !reduced
                ? `transform ${DURATION.small}ms cubic-bezier(${EASING.out.join(",")})`
                : undefined,
          }}
        />
        {choices.map((choice, index) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={value === choice}
            tabIndex={value === choice ? 0 : -1}
            className={`relative h-7 w-16 min-w-0 flex-1 @max-[9rem]:w-full @max-[9rem]:flex-none rounded-control text-sm capitalize ${value === choice ? "text-ink @max-[9rem]:bg-surface @max-[9rem]:shadow-raised" : "text-ink-muted"}`}
            onPointerDown={() => setPointer(true)}
            onClick={() => onChange(choice)}
            onKeyDown={(event) => {
              setPointer(false);
              const offset =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!offset && event.key !== "Home" && event.key !== "End")
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 2
                    : (index + offset + 3) % 3;
              onChange(choices[next]!);
              (
                event.currentTarget.parentElement?.querySelectorAll("button")[
                  next
                ] as HTMLButtonElement
              )?.focus();
            }}
          >
            {choice[0]!.toUpperCase() + choice.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
