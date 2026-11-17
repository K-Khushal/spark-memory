import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PlayIcon } from "lucide-react";
import {
  FREE_ALLOWANCE,
  formatTimestamp,
  sourceHost,
  videoTimestamp,
  youtubeId,
} from "@spark/core";
import { SourceLink } from "./source-link";
import type { Memory } from "./use-library";

/** A public video stays Reference Only; the player loads only after Play. */
export function VideoReader({
  memory,
  seconds,
}: {
  memory: Pick<Memory, "sourceUrl" | "video" | "description"> &
    Partial<Pick<Memory, "image">>;
  seconds?: number;
}) {
  const [moment, setMoment] = useState(
    seconds ?? videoTimestamp(memory.sourceUrl ?? "")
  );
  const [playing, setPlaying] = useState(false);
  // One Tab stop for the whole transcript; arrow keys move along it.
  const [stop, setStop] = useState(0);
  const stamps = useRef<(HTMLButtonElement | null)[]>([]);
  const id = youtubeId(memory.sourceUrl ?? "");
  const transcript = memory.video?.transcript ?? [];
  const source =
    memory.sourceUrl && /^https?:\/\//i.test(memory.sourceUrl)
      ? memory.sourceUrl
      : undefined;
  const sourceHref = id
    ? `https://www.youtube.com/watch?v=${id}&t=${Math.floor(moment)}s`
    : source;
  const along = (event: KeyboardEvent) => {
    const last = transcript.length - 1;
    const to =
      event.key === "ArrowDown"
        ? Math.min(last, stop + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, stop - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (to === undefined) return;
    event.preventDefault();
    setStop(to);
    stamps.current[to]?.focus();
  };
  return (
    // Reads inside Memory detail's one scrolling body.
    <div className="flex flex-col gap-3">
      {id &&
        (playing ? (
          <iframe
            title="YouTube Player"
            key={moment}
            src={`https://www.youtube-nocookie.com/embed/${id}?start=${Math.floor(moment)}`}
            className="aspect-video w-full shrink-0 rounded-control border-0"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        ) : (
          <PlayPanel
            poster={memory.image?.thumbnailUrl}
            host={sourceHost(source ?? "") ?? ""}
            sourceHref={sourceHref}
            onClick={() => setPlaying(true)}
          >
            Play From {formatTimestamp(moment)}
          </PlayPanel>
        ))}
      {source && (!id || playing) && (
        <SourceLink href={sourceHref!} host={sourceHost(source) ?? source} />
      )}
      {transcript.length ? (
        <ol aria-label="Transcript" onKeyDown={along} className="space-y-3">
          {transcript.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-3 [content-visibility:auto] [contain-intrinsic-size:auto_4rem]"
            >
              <button
                type="button"
                ref={(el) => {
                  stamps.current[i] = el;
                }}
                tabIndex={i === stop ? 0 : -1}
                onFocus={() => setStop(i)}
                aria-label={`Play From ${formatTimestamp(s.seconds)}`}
                onClick={() => {
                  setMoment(s.seconds);
                  setPlaying(true);
                }}
                className="min-h-6 shrink-0 rounded-chip px-1 py-1 text-sm text-ink-muted tabular-nums transition-colors duration-(--duration-press) hover:text-ink focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-(--size-touch) pointer-coarse:min-w-(--size-touch)"
              >
                {formatTimestamp(s.seconds)}
              </button>
              <p dir="auto" className="min-w-0 pt-1 text-base wrap-anywhere">
                {s.text}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <>
          <p
            role="status"
            className="flex flex-wrap gap-2 text-sm text-ink-muted"
          >
            <StatusChip>Transcript Unavailable</StatusChip>
            {memory.video?.transcriptState === "over_allowance" && (
              <StatusChip>
                Over {FREE_ALLOWANCE.videoTranscriptMaxMinutes} Minutes
              </StatusChip>
            )}
          </p>
          {memory.description && (
            <p dir="auto" className="max-w-[65ch] text-base wrap-anywhere">
              {memory.description}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** A compact status: a sunken chip, so two of them read as two facts. */
function StatusChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-chip bg-sunken px-2 py-0.5 text-sm text-ink-muted">
      {children}
    </span>
  );
}

/**
 * Where the player will be: the preserved poster when there is one, else a
 * compact Play row. Both remain explicit actions before the player loads.
 * The poster is Spark's own preserved copy: nothing from YouTube loads yet.
 */
function PlayPanel({
  poster,
  host,
  sourceHref,
  onClick,
  children,
}: {
  poster: string | undefined;
  host: string;
  sourceHref: string | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const showing = poster && !broken;
  if (!showing)
    return (
      <div className="flex min-h-16 w-full shrink-0 items-center rounded-control border border-line hover:bg-sunken">
        <button
          type="button"
          onClick={onClick}
          className="flex min-h-16 min-w-0 flex-1 items-center gap-2 rounded-control px-3 py-2 text-start text-sm font-medium text-ink transition-transform duration-(--duration-press) ease-out active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-(--size-touch)"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-canvas">
            <PlayIcon className="size-4" aria-hidden />
          </span>
          {children}
        </button>
        {sourceHref && (
          <div className="max-w-[35%] min-w-0 pr-3">
            <SourceLink href={sourceHref} host={host} />
          </div>
        )}
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onClick}
        className="relative flex aspect-video w-full shrink-0 items-center justify-center gap-2 overflow-hidden rounded-tile bg-sunken text-sm font-medium text-ink transition-[background-color,transform] duration-(--duration-press) ease-out hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] pointer-coarse:min-h-(--size-touch)"
      >
        <img
          src={poster}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-cover"
        />
        <span
          data-theme="dark"
          className="relative inline-flex items-center gap-2 rounded-control bg-canvas px-3 py-2 text-ink"
        >
          <PlayIcon className="size-4" aria-hidden />
          {children}
        </span>
      </button>
      {sourceHref && <SourceLink href={sourceHref} host={host} />}
    </div>
  );
}
