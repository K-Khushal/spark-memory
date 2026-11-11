import { useId } from "react";
import { cn, Switch } from "@spark/ui";
import type { Memory } from "./use-library";

/** AI opt-out (GLOSSARY.md): on, this Memory never reaches an AI provider. */
export function AiOptOutSwitch({
  memory,
  onChange,
  className,
}: {
  memory: Memory;
  onChange: (memory: Memory, on: boolean) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Switch
        id={id}
        checked={memory.aiOptOut}
        onCheckedChange={(on) => onChange(memory, on)}
      />
      <label htmlFor={id} className="text-sm text-ink select-none">
        AI Opt-Out
      </label>
    </div>
  );
}
