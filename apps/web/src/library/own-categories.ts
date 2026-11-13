import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CategoryNameProblem } from "@spark/core";
import { api } from "../api";

/** A person's own Category and how many Memories have it. */
export type OwnCategory = { id: string; name: string; memories: number };
/** How far the newest Category's re-categorising has got. */
export type CategoryRun = { done: number; total: number };
export type CategoriesState = { categories: OwnCategory[]; run?: CategoryRun };

/** Why a name was not accepted; `failed` is the network or the server. */
export type CategoryProblem = CategoryNameProblem | "limit" | "failed";

/** What a person reads for each problem: short Title Case, no punctuation. */
export const PROBLEM_LABELS: Record<CategoryProblem, string> = {
  empty: "Name Needed",
  long: "Too Long",
  characters: "Invalid Characters",
  case: "Use Title Case",
  duplicate: "Already Exists",
  limit: "Limit Reached",
  failed: "Not Saved",
};

/** How often the progress is asked for while a run is under way. */
export const RUN_POLL_MS = 3000;

/** The owner's own Category names, for the pickers on a Memory. */
export const OwnCategoryNames = createContext<readonly string[]>([]);
export const useOwnCategoryNames = () => useContext(OwnCategoryNames);

type Answer = CategoriesState | { problem: CategoryProblem };
const failed = { problem: "failed" } as const;

async function answer(request: Promise<Response>): Promise<Answer> {
  try {
    const res = await request;
    if (res.ok) return (await res.json()) as CategoriesState;
    if (res.status === 400) {
      const body = (await res.json()) as { problem?: CategoryProblem };
      return { problem: body.problem ?? "failed" };
    }
  } catch {
    // Offline: the same as a refusal that says nothing.
  }
  return failed;
}

const transport = {
  read: () => answer(api.api.categories.$get()),
  create: (name: string) =>
    answer(api.api.categories.$post({ json: { name } })),
  rename: (id: string, name: string) =>
    answer(api.api.categories[":id"].$patch({ param: { id }, json: { name } })),
  remove: (id: string) =>
    answer(api.api.categories[":id"].$delete({ param: { id } })),
};

/**
 * The person's own Categories: the list, and the progress of the newest
 * one's re-categorising, asked after every few seconds while it runs.
 *
 * Answers are applied in the order their requests began, so a slow poll
 * never undoes the change made after it. `onRenamed` and `onRemoved` let the
 * wall follow at once; `onFinished` is called when a run ends, once, so the
 * wall can read the Categories it chose.
 */
export function useOwnCategories(handlers: {
  onRenamed: (from: string, to: string) => void;
  onRemoved: (name: string) => void;
  onFinished: () => void;
}) {
  const [state, setState] = useState<CategoriesState>();
  const began = useRef(0);
  const applied = useRef(0);
  const run = useRef<CategoryRun>(undefined);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  /** Applies an answer unless a later request has already been applied. */
  const apply = useCallback((seq: number, next: CategoriesState) => {
    if (seq < applied.current) return;
    applied.current = seq;
    if (run.current && !next.run) latest.current.onFinished();
    run.current = next.run;
    setState(next);
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++began.current;
    const next = await transport.read();
    if (!("problem" in next)) apply(seq, next);
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = !!state?.run;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const change = useCallback(
    async (
      request: () => Promise<Answer>,
      after?: (next: CategoriesState) => void
    ) => {
      const seq = ++began.current;
      const next = await request();
      if ("problem" in next) return next.problem;
      apply(seq, next);
      after?.(next);
      return undefined;
    },
    [apply]
  );

  return {
    state,
    /** A problem, or undefined once it is made. */
    create: (name: string) => change(() => transport.create(name)),
    rename: (category: OwnCategory, name: string) =>
      change(
        () => transport.rename(category.id, name),
        (next) => {
          // The name the server kept (trimmed, spaces made one).
          const kept = next.categories.find((c) => c.id === category.id);
          if (kept) latest.current.onRenamed(category.name, kept.name);
        }
      ),
    remove: (category: OwnCategory) =>
      change(
        () => transport.remove(category.id),
        () => latest.current.onRemoved(category.name)
      ),
  };
}
