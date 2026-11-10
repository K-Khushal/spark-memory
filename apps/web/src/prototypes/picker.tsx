// The visual picker: flip between the three prototypes live (1, 2, 3) and
// toggle the theme (T). Throwaway, like the prototypes.
import { useEffect, useState, type ComponentType } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { Toaster, cn } from "@spark/ui";
import { Desk } from "./desk";
import { LightTable } from "./light-table";
import { Recall } from "./recall";
import { DATA_SETS, LibraryData, type DataSet } from "./use-library";

export const PROTOTYPES = [
  { id: "light-table", name: "Light table", component: LightTable },
  { id: "desk", name: "Desk", component: Desk },
  { id: "recall", name: "Recall", component: Recall },
] as const satisfies { id: string; name: string; component: ComponentType }[];

export type PrototypeId = (typeof PROTOTYPES)[number]["id"];

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const DATA_LABELS: Record<DataSet, string> = {
  library: "Worst-case Library",
  empty: "Empty",
  huge: "1,000 Memories",
};

export function Picker({
  active,
  data,
}: {
  active: PrototypeId;
  data: DataSet;
}) {
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const Prototype = PROTOTYPES.find((p) => p.id === active)!.component;

  const flipTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("spark-theme", next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    setTheme(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))
        return;
      if (document.querySelector("[role=dialog]")) return;
      const p = PROTOTYPES[Number(event.key) - 1];
      if (p) void navigate({ to: "/prototypes", search: { p: p.id, data } });
      if (event.key.toLowerCase() === "t") flipTheme();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <MotionConfig reducedMotion="user">
      <nav
        aria-label="Prototypes"
        className="flex h-10 items-center gap-1 border-b border-line bg-sunken px-2 text-sm sm:px-4"
      >
        <span className="mr-2 hidden text-ink-muted sm:inline">Prototype</span>
        {PROTOTYPES.map((p, i) => (
          <Link
            key={p.id}
            to="/prototypes"
            search={{ p: p.id, data }}
            aria-current={p.id === active ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-control px-2 whitespace-nowrap text-ink-muted transition-colors duration-[120ms] hover:text-ink",
              p.id === active && "bg-surface text-ink shadow-raised"
            )}
          >
            <span className="tabular text-xs text-ink-muted">{i + 1}</span>
            {p.name}
          </Link>
        ))}
        <div
          className="ml-auto flex items-center gap-1"
          role="group"
          aria-label="Fake data"
        >
          {DATA_SETS.map((d) => (
            <Link
              key={d}
              to="/prototypes"
              search={{ p: active, data: d }}
              aria-current={d === data ? "true" : undefined}
              className={cn(
                "hidden h-7 items-center rounded-control px-2 text-xs whitespace-nowrap text-ink-muted hover:text-ink md:inline-flex",
                d === data && "bg-surface text-ink shadow-raised"
              )}
            >
              {DATA_LABELS[d]}
            </Link>
          ))}
        </div>
        <button
          type="button"
          onClick={flipTheme}
          className=" grid size-8 place-items-center rounded-control text-ink-muted hover:bg-surface hover:text-ink"
          aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
        >
          {theme === "dark" ? (
            <SunIcon className="size-4" aria-hidden />
          ) : (
            <MoonIcon className="size-4" aria-hidden />
          )}
        </button>
      </nav>
      <LibraryData.Provider value={data}>
        <Prototype key={`${active}-${data}`} />
      </LibraryData.Provider>
      <Toaster theme={theme} />
    </MotionConfig>
  );
}
