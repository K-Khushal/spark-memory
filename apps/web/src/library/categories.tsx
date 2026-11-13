import { useState } from "react";
import { CATEGORY_NAMES, MAX_CATEGORIES } from "@spark/core";
import { ChevronDownIcon } from "lucide-react";
import { Button, FilterChip } from "@spark/ui";
import { useOwnCategoryNames } from "./own-categories";
import type { Memory } from "./use-library";

export type CategoryEdit = (
  memory: Memory,
  categories: string[]
) => Promise<boolean>;

/**
 * A Memory's Categories, one to three, opening to change them. Apply is the
 * deliberate step that locks them against automatic changes; a failed save
 * keeps the choice for another try.
 */
export function CategoryEditor({
  memory,
  onSave,
}: {
  memory: Memory;
  onSave?: CategoryEdit;
}) {
  const [selected, setSelected] = useState<string[]>(memory.categories);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const own = useOwnCategoryNames();
  if (!onSave) return null;
  const toggle = (name: string) =>
    setSelected((now) =>
      now.includes(name)
        ? now.filter((c) => c !== name)
        : now.length < MAX_CATEGORIES
          ? [...now, name]
          : now
    );
  return (
    <details
      className="group shrink-0 rounded-control bg-sunken px-3 py-1 text-sm text-ink"
      onToggle={(e) => {
        if (e.currentTarget.open) {
          setSelected(memory.categories);
          setState("idle");
        }
      }}
    >
      <summary
        aria-label={`Categories: ${memory.categories.join(", ")}`}
        className="flex min-h-8 cursor-pointer items-center justify-between gap-2 rounded-chip focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="min-w-0">{memory.categories.join(", ")}</span>
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-ink-muted transition-transform duration-(--duration-press) group-open:rotate-180"
        />
      </summary>
      <div className="flex flex-wrap gap-2 py-2">
        {[...CATEGORY_NAMES, ...own].map((name) => (
          <FilterChip
            key={name}
            aria-pressed={selected.includes(name)}
            aria-disabled={
              !selected.includes(name) && selected.length >= MAX_CATEGORIES
            }
            disabled={state === "saving"}
            className="max-w-full aria-disabled:opacity-50"
            onClick={() => toggle(name)}
          >
            <span className="truncate" dir="auto">
              {name}
            </span>
          </FilterChip>
        ))}
      </div>
      <div className="flex items-center gap-3 pb-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!selected.length || state === "saving"}
          onClick={async (event) => {
            const details = event.currentTarget.closest("details");
            setState("saving");
            const saved = await onSave(memory, selected);
            setState(saved ? "idle" : "failed");
            if (saved && details) details.open = false;
          }}
        >
          {state === "failed" ? "Try Again" : "Apply"}
        </Button>
        {state === "failed" && (
          <span role="alert" className="text-ink-muted">
            Not Saved
          </span>
        )}
      </div>
    </details>
  );
}
