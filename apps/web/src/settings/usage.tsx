import { useId, useRef, useState } from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@spark/ui";
import {
  formatSize,
  type AllowanceUsage,
  type MemoryKind,
  type Meter,
  sourceHost,
} from "@spark/core";

/** A Memory that takes storage, as `GET /api/usage` names it. */
export type Heaviest = {
  id: string;
  kind: MemoryKind;
  title: string | null;
  sourceUrl: string | null;
  bytes: number;
};
export type Usage = AllowanceUsage & { largest: Heaviest[] };

/** From here, Settings lists what takes the most storage, to delete. */
export const NEARLY_FULL = 0.8;

const time = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** A Memory's name for a list: its title, else its Source's host, else its kind. */
export function nameOf({ title, sourceUrl, kind }: Heaviest) {
  if (title?.trim()) return title.trim();
  const host = sourceUrl && sourceHost(sourceUrl);
  if (host) return host;
  return kind === "pdf" ? "PDF" : kind === "image" ? "Image" : "Memory";
}

const share = ({ used, limit }: Meter) =>
  limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;

/** Storage, Captures Today and Deep Fetches Today, and when today's start again. */
export function UsageSection({
  usage,
  onDelete,
}: {
  usage: Usage;
  /** Deletes a Memory for good; true once it is gone. */
  onDelete: (id: string) => Promise<boolean>;
}) {
  const resets = `Resets at ${time.format(new Date(usage.resetsAt))}`;
  return (
    <div className="flex flex-col">
      <Gauge
        label="Storage"
        meter={usage.storage}
        text={(m) => `${formatSize(m.used)} of ${formatSize(m.limit)}`}
      />
      {share(usage.storage) >= NEARLY_FULL && usage.largest.length > 0 && (
        <Largest rows={usage.largest} onDelete={onDelete} />
      )}
      <Gauge
        label="Captures Today"
        meter={usage.captures}
        text={(m) => `${m.used} of ${m.limit}`}
        detail={resets}
      />
      <Gauge
        label="Deep Fetches Today"
        meter={usage.deepFetches}
        text={(m) => `${m.used} of ${m.limit}`}
        detail={resets}
      />
    </div>
  );
}

/**
 * One counted limit: its name, how much is used, and a bar. The bar is the
 * accessible meter; `detail` (when it resets) is read with it, not shown.
 */
function Gauge({
  label,
  meter,
  text,
  detail,
}: {
  label: string;
  meter: Meter;
  text: (meter: Meter) => string;
  detail?: string;
}) {
  const id = useId();
  const value = text(meter);
  return (
    <div className="flex min-h-12 flex-col justify-center gap-2 border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span id={id} className="text-sm">
          {label}
        </span>
        <span aria-hidden className="text-sm text-ink-muted tabular">
          {value}
        </span>
      </div>
      <div
        role="meter"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={meter.limit}
        aria-valuenow={Math.min(meter.used, meter.limit)}
        aria-valuetext={detail ? `${value}. ${detail}` : value}
        className="h-1 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full rounded-full bg-ink"
          style={{ width: `${Math.round(share(meter) * 10_000) / 100}%` }}
        />
      </div>
    </div>
  );
}

function Largest({
  rows,
  onDelete,
}: {
  rows: Heaviest[];
  onDelete: (id: string) => Promise<boolean>;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [asked, setAsked] = useState<Heaviest>();
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (!asked || pending) return;
    setPending(true);
    const gone = await onDelete(asked.id);
    setPending(false);
    if (gone) setAsked(undefined);
  };

  return (
    <>
      <ul ref={list} aria-label="Largest Memories" className="flex flex-col">
        {rows.map((row) => {
          const name = nameOf(row);
          const size = formatSize(row.bytes);
          return (
            <li
              key={row.id}
              className="flex min-h-12 items-center gap-3 border-b border-line py-1 last:border-b-0"
            >
              <span dir="auto" className="min-w-0 flex-1 wrap-anywhere text-sm">
                {name}
              </span>
              <span className="text-sm text-ink-muted tabular">{size}</span>
              <Button
                variant="quiet"
                size="icon"
                className="md:-mr-2"
                aria-label={`Delete ${name}, ${size}`}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setAsked(row);
                }}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
      <Dialog
        open={!!asked}
        onOpenChange={(open) => {
          if (!open && !pending) setAsked(undefined);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => {
              const next = trigger.current?.isConnected
                ? trigger.current
                : list.current?.querySelector<HTMLButtonElement>("button");
              (next ?? document.getElementById("content"))?.focus();
            });
          }}
          presentation="sheet"
          className="flex max-h-[calc(100dvh-2rem)] max-w-md flex-col overflow-hidden"
          aria-describedby={undefined}
        >
          <div className="flex min-h-0 flex-col">
            <DialogBody className="p-0 sm:px-0">
              <DialogHeader>
                <DialogTitle className="wrap-anywhere">
                  {asked ? `Delete ${nameOf(asked)}?` : "Delete?"}
                </DialogTitle>
              </DialogHeader>
            </DialogBody>
            <DialogFooter>
              <Button
                wrap
                variant="quiet"
                disabled={pending}
                onClick={() => setAsked(undefined)}
              >
                Cancel
              </Button>
              <Button
                wrap
                variant="primary"
                className="min-w-24"
                disabled={pending}
                onClick={() => void confirm()}
              >
                {pending && (
                  <Loader2Icon
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                )}
                <span className={pending ? "sr-only" : undefined}>Delete</span>
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
