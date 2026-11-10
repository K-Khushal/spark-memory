import {
  ArchiveIcon,
  ExternalLinkIcon,
  LinkIcon,
  SparklesIcon,
} from "lucide-react";
import {
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  cn,
} from "@spark/ui";
import { LOOK_LABEL, capturedLabel, sourceLabel } from "./fake-library";
import { Highlighted, IndexStateBadge, MemoryVisual } from "./memory-visual";
import type { LiveMemory } from "./use-library";

/** Everything Spark knows about one Memory. Used by the preview dialog and Desk's pane. */
export function MemoryDetails({
  memory,
  query = "",
  why = [],
  className,
}: {
  memory: LiveMemory;
  query?: string;
  why?: string[];
  className?: string;
}) {
  const facts: [string, string][] = [
    ["Source", sourceLabel(memory)],
    ["Captured", capturedLabel(memory.daysAgo)],
    [
      "Preservation",
      memory.preservation === "preserved" ? "Preserved" : "Reference only",
    ],
  ];
  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      {why.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Why it matched">
          {why.map((w) => (
            <li key={w} className="max-w-full">
              <Chip>
                <span>{w}</span>
              </Chip>
            </li>
          ))}
        </ul>
      )}
      {memory.captureNote && (
        <p className="text-base text-ink">“{memory.captureNote}”</p>
      )}
      {memory.excerpt && memory.look !== "text" && (
        <p className="max-w-[65ch] text-base text-ink-muted" dir="auto">
          <Highlighted text={memory.excerpt} query={query} />
        </p>
      )}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="min-w-0 truncate text-ink">{v}</dd>
          </div>
        ))}
        {memory.categories.length > 0 && (
          <div className="contents">
            <dt className="text-ink-muted">Categories</dt>
            <dd className="text-ink">{memory.categories.join(", ")}</dd>
          </div>
        )}
        {memory.tags.length > 0 && (
          <div className="contents">
            <dt className="text-ink-muted">Tags</dt>
            <dd className="text-ink">{memory.tags.join(", ")}</dd>
          </div>
        )}
      </dl>
      <IndexStateBadge
        memory={memory}
        className="self-start shadow-none ring-1 ring-line"
      />
      <div className="flex flex-wrap gap-2">
        {memory.source && (
          <Button variant="primary" size="sm">
            <ExternalLinkIcon aria-hidden /> Open Source
          </Button>
        )}
        <Button variant="outline" size="sm">
          <SparklesIcon aria-hidden /> More like this
        </Button>
        {memory.preservation === "preserved" ? (
          <Button variant="outline" size="sm">
            <ArchiveIcon aria-hidden /> Preserved copy
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <LinkIcon aria-hidden /> Reference only
          </Button>
        )}
      </div>
    </div>
  );
}

/** Quick preview (Space). Opacity only, no movement: it is keyboard-driven. */
export function QuickPreview({
  memory,
  query,
  why,
  onClose,
}: {
  memory: LiveMemory | undefined;
  query?: string;
  why?: string[];
  onClose: () => void;
}) {
  return (
    <Dialog open={!!memory} onOpenChange={(open) => !open && onClose()}>
      {memory && (
        <DialogContent className="grid max-h-[90dvh] max-w-5xl overflow-hidden md:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
          <div className="max-h-[50dvh] bg-sunken md:max-h-[90dvh]">
            <div
              className="mx-auto h-full max-h-[inherit]"
              style={{ aspectRatio: memory.aspect }}
            >
              <MemoryVisual memory={memory} query={query} />
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6">
            <div className="space-y-1 pr-8">
              <DialogTitle className="leading-snug break-words" dir="auto">
                {memory.title}
              </DialogTitle>
              <DialogDescription>{LOOK_LABEL[memory.look]}</DialogDescription>
            </div>
            <MemoryDetails memory={memory} query={query} why={why} />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
