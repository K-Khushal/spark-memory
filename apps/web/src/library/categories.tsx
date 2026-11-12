import { useState } from "react";
import { CATEGORY_NAMES, MAX_CATEGORIES, type Category } from "@spark/core";
import { ChevronDownIcon } from "lucide-react";
import { Button, cn, FilterChip } from "@spark/ui";
import type { Memory } from "./use-library";

export type CategoryEdit = (
  memory: Memory,
  categories: Category[]
) => Promise<boolean>;

type Filter = {
  selected?: Category;
  onChange: (category?: Category) => void;
};

/** The sidebar's Categories: one at a time, the selected one raised like the current page. */
export function CategoryList({ selected, onChange }: Filter) {
  return (
    <nav
      aria-label="Categories"
      className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
    >
      <ul className="flex flex-col gap-1">
        {CATEGORY_NAMES.map((name) => (
          <li key={name}>
            <button
              type="button"
              aria-pressed={selected === name}
              onClick={() => onChange(selected === name ? undefined : name)}
              className={cn(
                "flex h-8 w-full items-center rounded-control px-2 text-left text-sm transition-[color] duration-(--duration-press) ease-out focus-visible:outline-2 focus-visible:outline-ring",
                selected === name
                  ? "bg-surface font-medium text-ink shadow-raised"
                  : "text-ink-muted hover:text-ink"
              )}
            >
              {name}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** On a phone, one scrolling row under the top bar. */
export function CategoryRow({ selected, onChange }: Filter) {
  return (
    <div
      role="group"
      aria-label="Categories"
      className="flex gap-2 overflow-x-auto px-4 pb-2"
    >
      {CATEGORY_NAMES.map((name) => (
        <FilterChip
          key={name}
          aria-pressed={selected === name}
          onClick={() => onChange(selected === name ? undefined : name)}
        >
          {name}
        </FilterChip>
      ))}
    </div>
  );
}

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
  const [selected, setSelected] = useState<Category[]>(memory.categories);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  if (!onSave) return null;
  const toggle = (name: Category) =>
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
        {CATEGORY_NAMES.map((name) => (
          <FilterChip
            key={name}
            aria-pressed={selected.includes(name)}
            aria-disabled={
              !selected.includes(name) && selected.length >= MAX_CATEGORIES
            }
            disabled={state === "saving"}
            className="aria-disabled:opacity-50"
            onClick={() => toggle(name)}
          >
            {name}
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
