import { PlayIcon, PlusIcon, RotateCwIcon } from "lucide-react";
import { Button, Kbd, cn } from "@spark/ui";
import { highlight, showsTitle, type FakeMemory } from "./fake-library";

/** A Memory's own visual, filling its parent. */
export function MemoryVisual({
  memory,
  query = "",
  className,
}: {
  memory: FakeMemory;
  query?: string;
  className?: string;
}) {
  const base = cn(
    "relative isolate h-full w-full overflow-hidden bg-sunken",
    className
  );

  if (memory.shot) {
    return (
      <div className={cn(base, "bg-surface")}>
        <ScreenshotMock shot={memory.shot} />
      </div>
    );
  }

  if (memory.kind === "pdf") {
    return (
      <div className={cn(base, "grid place-items-center bg-sunken p-[8%]")}>
        <div className="flex h-full w-full flex-col gap-2 overflow-hidden rounded-[3px] bg-[#fff] p-[10%] text-[#111214] shadow-raised">
          <p
            className="line-clamp-4 font-display text-sm leading-tight font-semibold break-words"
            dir="auto"
          >
            {memory.title}
          </p>
          <p
            className="line-clamp-6 text-[0.625rem] leading-snug text-[#5e6066]"
            dir="auto"
          >
            <Highlighted text={memory.excerpt ?? ""} query={query} />
          </p>
        </div>
      </div>
    );
  }

  if (showsTitle(memory)) {
    const note = memory.kind === "text";
    return (
      <div
        className={cn(
          base,
          "flex flex-col gap-2 p-4",
          note ? "bg-sunken" : "bg-surface"
        )}
      >
        {memory.image && (
          <img
            src={memory.image}
            alt=""
            loading="lazy"
            decoding="async"
            className="-mx-4 -mt-4 mb-1 aspect-[16/9] w-[calc(100%+2rem)] max-w-none object-cover"
          />
        )}
        <p
          className={cn(
            "font-medium break-words text-ink",
            memory.image ? "line-clamp-2" : "line-clamp-3",
            note ? "text-sm" : "font-display text-md leading-snug"
          )}
          dir="auto"
        >
          {memory.title}
        </p>
        {memory.excerpt && (
          <p
            className="min-h-0 flex-1 overflow-hidden text-sm text-ink-muted [mask-image:linear-gradient(black_65%,transparent)]"
            dir="auto"
          >
            <Highlighted text={memory.excerpt} query={query} />
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={base}>
      <img
        src={memory.image}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
      {memory.kind === "video" && (
        <span className="absolute bottom-2 left-2 inline-flex h-6 items-center gap-1 rounded-chip bg-[#111214]/75 px-1.5 text-xs font-medium text-[#fff] tabular">
          <PlayIcon className="size-3 fill-current" aria-hidden />
          {memory.duration}
        </span>
      )}
    </div>
  );
}

export function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((run, i) =>
        run.hit ? <mark key={i}>{run.text}</mark> : run.text
      )}
    </>
  );
}

/** Index state, shown only when it is not the normal Searchable. */
export function IndexStateBadge({
  memory,
  onRetry,
  className,
}: {
  memory: FakeMemory;
  onRetry?: () => void;
  className?: string;
}) {
  if (memory.indexState === "searchable") return null;
  const failed = memory.indexState === "failed";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-chip bg-surface px-2 text-xs font-medium shadow-raised",
        failed ? "text-danger" : "text-indexing",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          failed ? "bg-danger" : "bg-indexing"
        )}
      />
      {failed ? "Failed" : "Indexing"}
      {failed && onRetry && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          // Keep Enter and Space from also opening the Memory.
          onKeyDown={(e) => e.stopPropagation()}
          className="-mr-1 ml-0.5 grid size-5 place-items-center rounded-chip text-ink hover:bg-sunken"
          aria-label={`Retry Indexing ${memory.title}`}
        >
          <RotateCwIcon className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

function ScreenshotMock({ shot }: { shot: NonNullable<FakeMemory["shot"]> }) {
  const bar = (w: string, o = 0.12) => (
    <span
      className="block h-1.5 rounded-full bg-[#111214]"
      style={{ width: w, opacity: o }}
    />
  );
  if (shot.layout === "chat") {
    return (
      <div className="flex h-full bg-[#fff]">
        <div className="w-[28%] p-[6%]" style={{ background: shot.accent }}>
          <div className="space-y-2 opacity-70">
            {["70%", "50%", "60%", "40%", "55%"].map((w, i) => (
              <span
                key={i}
                className="block h-1.5 rounded-full bg-[#fff]"
                style={{ width: w }}
              />
            ))}
          </div>
        </div>
        <div className="flex-1 space-y-3 p-[6%]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-2">
              <span className="size-4 shrink-0 rounded bg-[#111214]/15" />
              <div className="flex-1 space-y-1">
                {bar(`${30 + ((i * 17) % 40)}%`, 0.35)}
                {bar(`${60 + ((i * 11) % 35)}%`)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (shot.layout === "settings") {
    return (
      <div className="h-full space-y-[6%] bg-[#fff] p-[8%]">
        {bar("40%", 0.5)}
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="flex-1 space-y-1">
              {bar(`${40 + ((i * 13) % 30)}%`, 0.4)}
              {bar(`${60 + ((i * 7) % 30)}%`)}
            </div>
            <span
              className="h-3 w-6 rounded-full"
              style={{
                background: i % 2 ? "#11121422" : shot.accent,
              }}
            />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex h-full bg-[#fafafa]">
      <div
        className="w-[22%] space-y-2 p-[4%]"
        style={{ background: shot.accent }}
      >
        {["80%", "60%", "70%", "50%", "65%"].map((w, i) => (
          <span
            key={i}
            className="block h-1.5 rounded-full bg-[#fff]/70"
            style={{ width: w }}
          />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-[5%] p-[4%]">
        {bar("30%", 0.5)}
        <div className="grid grid-cols-3 gap-[4%]">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="space-y-1 rounded bg-[#fff] p-[8%] shadow-raised"
            >
              {bar("50%")}
              <span
                className="block h-2.5 w-[70%] rounded-full"
                style={{ background: shot.accent, opacity: 0.8 - i * 0.2 }}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-1 items-end gap-[3%] rounded bg-[#fff] p-[4%] shadow-raised">
          {[40, 65, 50, 80, 70, 95, 60, 85].map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-sm"
              style={{
                height: `${h}%`,
                background: shot.accent,
                opacity: 0.35 + (i % 3) * 0.2,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The empty Library: one action, no explanation. */
export function EmptyLibrary({ onCapture }: { onCapture: () => void }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <h2 className="font-display text-lg font-semibold">No Memories Yet</h2>
        <Button variant="primary" onClick={onCapture}>
          <PlusIcon aria-hidden /> Capture
          <Kbd className="hidden border-transparent bg-canvas/15 text-canvas sm:inline-flex">
            ⌘V
          </Kbd>
        </Button>
      </div>
    </div>
  );
}
