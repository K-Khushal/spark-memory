import { useState } from "react";
import { Button, Masonry } from "@spark/ui";
import {
  emptySelection,
  select,
  type SelectionAction,
} from "../library/selection";
import { SelectionBar } from "../library/selection-bar";

const states = [
  "Demo",
  "Worst Case",
  "Empty",
  "One",
  "1,000 Rows",
  "10,000 Rows",
] as const;
const titles = [
  "J",
  "दादी की रेसिपी 🌿",
  "وصفات الجدة",
  "Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf",
  "https://example.com/workspaces/garden/projects/summer-planting-calendar",
];
/** Development-only stress fixture for the production selection surface. */
export default function SelectionPrototype() {
  const [state, setState] = useState<(typeof states)[number]>("Demo");
  const [selection, setSelection] = useState(emptySelection);
  const count =
    state === "Empty"
      ? 0
      : state === "One"
        ? 1
        : state === "10,000 Rows"
          ? 10_000
          : state === "1,000 Rows"
            ? 1000
            : 8;
  const rows = Array.from({ length: count }, (_, n) => ({
    id: String(n),
    title:
      state === "Worst Case" ? titles[n % titles.length]! : `Memory ${n + 1}`,
  }));
  const order = rows.map((m) => m.id);
  const dispatch = (action: SelectionAction) =>
    setSelection((s) => select(s, order, action));
  return (
    <main className="min-h-dvh bg-canvas p-4 pb-40 text-ink">
      <Masonry
        label="Selection Memories"
        items={rows}
        getKey={(m) => m.id}
        getLabel={(m) => m.title}
        getAspect={() => 1}
        selection={{
          ids: selection.ids,
          choose: (id, type) => dispatch({ type, id }),
          all: () => dispatch({ type: "all" }),
          clear: () => dispatch({ type: "clear" }),
          marquee: (ids, additive) =>
            dispatch({
              type: "marquee",
              ids,
              additive: additive ? selection.ids : [],
            }),
        }}
        renderItem={(m) => (
          <div className="flex h-full items-end overflow-hidden rounded-tile border border-line bg-sunken p-4">
            <span className="truncate" title={m.title} dir="auto">
              {m.title}
            </span>
          </div>
        )}
      />
      {!!selection.ids.length && (
        <SelectionBar
          count={selection.ids.length}
          ownNames={
            state === "Worst Case"
              ? [
                  "An Unreasonably Long Category Name Here",
                  "وصفات الجدة",
                  "दादी की रेसिपी",
                ]
              : []
          }
          onClear={() => dispatch({ type: "clear" })}
          onDelete={() => dispatch({ type: "clear" })}
          onCategories={() => dispatch({ type: "clear" })}
        />
      )}
      <nav
        aria-label="Demo Data"
        className="fixed inset-x-0 top-0 z-40 flex flex-wrap justify-center gap-2 bg-sunken p-2"
      >
        {states.map((s) => (
          <Button
            key={s}
            variant={s === state ? "primary" : "quiet"}
            onClick={() => {
              setState(s);
              setSelection(emptySelection);
            }}
          >
            {s}
          </Button>
        ))}
      </nav>
    </main>
  );
}
