import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LoaderIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogTitle } from "@spark/ui";
import { api } from "../api";

type Entry = {
  id: string;
  tool: string;
  occurredAt: string;
  resultCount: number;
  memory: { id: string; title: string | null } | null;
};
type Log =
  | { phase: "loading"; entries: Entry[]; next: string | null }
  | { phase: "ready"; entries: Entry[]; next: string | null }
  | { phase: "failed"; entries: Entry[]; next: string | null };

type Page = { activity: Entry[]; next: string | null };
async function readActivity(assistant: string, before?: string) {
  const res = await api.api.assistants.activity.$get(
    { query: before ? { assistant, before } : { assistant } },
    { init: { signal: AbortSignal.timeout(20_000) } }
  );
  if (!res.ok) throw new Error("activity unavailable");
  return (await res.json()) satisfies Page;
}

const when = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const TOOLS: Record<string, string> = {
  search_memories: "Searched",
  get_memory: "Opened Memory",
  find_similar: "Found Similar",
};
const results = (n: number) =>
  n === 0 ? "No Results" : n === 1 ? "1 Result" : `${n} Results`;

/** What one assistant did: tool, time and result count. Never what it asked. */
export function ActivityDialog({
  assistant,
  onClose,
}: {
  assistant: { id: string; name: string };
  onClose: () => void;
}) {
  const [log, setLog] = useState<Log>({
    phase: "loading",
    entries: [],
    next: null,
  });
  const show = (before?: string) => (page: Page) =>
    setLog((l) => ({
      phase: "ready",
      entries: before ? [...l.entries, ...page.activity] : page.activity,
      next: page.next,
    }));
  const fail = () => setLog((l) => ({ ...l, phase: "failed" }));
  /** From a button: show loading at once, then fetch the page after `before`. */
  const more = (before?: string) => {
    setLog((l) => ({ ...l, phase: "loading" }));
    void readActivity(assistant.id, before).then(show(before), fail);
  };
  useEffect(() => {
    let active = true;
    void readActivity(assistant.id).then(
      (page) => active && show()(page),
      () => active && fail()
    );
    return () => {
      active = false;
    };
  }, [assistant.id]);
  const loading = log.phase === "loading";
  return (
    <Dialog open onOpenChange={(open) => open || onClose()}>
      <DialogContent
        className="flex max-h-[85dvh] max-w-xl flex-col gap-4 overflow-y-auto p-6"
        aria-describedby={undefined}
      >
        <DialogTitle className="pr-8 wrap-anywhere" dir="auto">
          {assistant.name} Activity
        </DialogTitle>
        {log.entries.length > 0 && (
          <ul aria-label="Activity" className="flex flex-col">
            {log.entries.map((e) => (
              <li
                key={e.id}
                className="flex min-h-12 items-center gap-3 border-b border-line py-2 text-sm last:border-b-0"
              >
                <span className="min-w-0 flex-1 wrap-anywhere">
                  {TOOLS[e.tool] ?? "Other Request"}
                  {e.memory && (
                    <>
                      {" "}
                      <Link
                        to="/"
                        search={{ memory: e.memory.id }}
                        dir="auto"
                        className="underline underline-offset-2"
                      >
                        {e.memory.title?.trim() || "Untitled"}
                      </Link>
                    </>
                  )}
                </span>
                <span className="shrink-0 text-right text-xs text-ink-muted tabular">
                  <span className="block">{results(e.resultCount)}</span>
                  <time dateTime={e.occurredAt}>
                    {when.format(new Date(e.occurredAt))}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        )}
        {log.phase === "ready" && log.entries.length === 0 && (
          <p className="text-sm text-ink-muted">No Activity</p>
        )}
        {log.phase === "failed" && (
          <div className="flex items-center gap-3">
            <p role="alert" className="text-sm">
              Could Not Load Activity
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => more(log.next ?? undefined)}
            >
              Try Again
            </Button>
          </div>
        )}
        {log.phase !== "failed" && log.next && (
          <div>
            <Button
              variant="outline"
              aria-disabled={loading}
              onClick={() => loading || more(log.next!)}
            >
              {loading && (
                <LoaderIcon
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              )}
              Load More
            </Button>
          </div>
        )}
        {loading && log.entries.length === 0 && (
          <span role="status" className="sr-only">
            Loading
          </span>
        )}
      </DialogContent>
    </Dialog>
  );
}
