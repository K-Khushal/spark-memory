import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { Button, Chip, Dialog, DialogContent, DialogTitle } from "@spark/ui";
import { capturedLabel, sourceLabel, type Result } from "./fake-library";
import { Highlighted, IndexStateBadge, MemoryVisual } from "./memory-visual";

/** Quick preview (Space or Enter): the Memory large, with what Spark knows. */
export function QuickPreview({
  result,
  query,
  onClose,
}: {
  result: Result | undefined;
  query: string;
  onClose: () => void;
}) {
  const memory = result?.memory;
  const facts: [string, string][] = memory
    ? [
        ["Source", sourceLabel(memory)],
        ["Captured", capturedLabel(memory.daysAgo)],
        ["Categories", memory.categories.join(", ")],
        ["Tags", memory.tags.join(", ")],
        [
          "Preservation",
          memory.preservation === "preserved" ? "Preserved" : "Reference Only",
        ],
      ]
    : [];

  return (
    <Dialog open={!!memory} onOpenChange={(open) => !open && onClose()}>
      {memory && (
        <DialogContent
          aria-describedby={undefined}
          className="grid max-h-[90dvh] max-w-5xl overflow-hidden md:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]"
        >
          <div className="max-h-[50dvh] bg-sunken md:max-h-[90dvh]">
            <div
              className="mx-auto h-full max-h-[inherit]"
              style={{ aspectRatio: memory.aspect }}
            >
              <MemoryVisual memory={memory} query={query} />
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-6">
            <DialogTitle className="pr-8 leading-snug break-words" dir="auto">
              {memory.title}
            </DialogTitle>
            {result.why.length > 0 && (
              <ul
                className="flex flex-wrap gap-1.5"
                aria-label="Why It Matched"
              >
                {result.why.map((w) => (
                  <li key={w} className="max-w-full">
                    <Chip>
                      <span>{w}</span>
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
            {memory.captureNote && <p>“{memory.captureNote}”</p>}
            {memory.excerpt && memory.kind !== "text" && (
              <p className="max-w-[65ch] text-ink-muted" dir="auto">
                <Highlighted text={memory.excerpt} query={query} />
              </p>
            )}
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
              {facts
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </div>
                ))}
            </dl>
            <IndexStateBadge memory={memory} className="self-start" />
            <div className="mt-auto flex flex-wrap gap-2">
              {memory.source && (
                <Button variant="primary" size="sm">
                  <ExternalLinkIcon aria-hidden /> Open Source
                </Button>
              )}
              <Button variant="outline" size="sm">
                <SparklesIcon aria-hidden /> More Like This
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
