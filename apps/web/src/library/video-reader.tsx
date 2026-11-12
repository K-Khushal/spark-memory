import { useState } from "react";
import { formatTimestamp, videoTimestamp, youtubeId } from "@spark/core";
import { Button } from "@spark/ui";
import type { Memory } from "./use-library";

/** A public video stays Reference Only; the player loads only after Play. */
export function VideoReader({
  memory,
  seconds,
}: {
  memory: Pick<Memory, "sourceUrl" | "video" | "description">;
  seconds?: number;
}) {
  const [moment, setMoment] = useState(
    seconds ?? videoTimestamp(memory.sourceUrl ?? "")
  );
  const [playing, setPlaying] = useState(false);
  const id = youtubeId(memory.sourceUrl ?? "");
  const transcript = memory.video?.transcript ?? [];
  const source =
    memory.sourceUrl && /^https?:\/\//i.test(memory.sourceUrl)
      ? memory.sourceUrl
      : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {id &&
        (playing ? (
          <iframe
            title="YouTube Player"
            key={moment}
            src={`https://www.youtube-nocookie.com/embed/${id}?start=${Math.floor(moment)}`}
            className="aspect-video w-full shrink-0 rounded-control border-0"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        ) : (
          <Button
            variant="quiet"
            className="aspect-video h-auto w-full shrink-0 bg-sunken"
            onClick={() => setPlaying(true)}
          >
            Play at {formatTimestamp(moment)}
          </Button>
        ))}
      {source && (
        <a
          href={
            id
              ? `https://www.youtube.com/watch?v=${id}&t=${Math.floor(moment)}s`
              : source
          }
          target="_blank"
          rel="noopener noreferrer nofollow"
          referrerPolicy="no-referrer"
          className="self-start rounded-chip text-sm text-ink-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          Open Source<span className="sr-only">, Opens in New Tab</span>
        </a>
      )}
      {transcript.length ? (
        <ol aria-label="Transcript" className="space-y-3">
          {transcript.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-3 [content-visibility:auto] [contain-intrinsic-size:auto_4rem]"
            >
              <button
                type="button"
                aria-label={`Play at ${formatTimestamp(s.seconds)}`}
                onClick={() => {
                  setMoment(s.seconds);
                  setPlaying(true);
                }}
                className="shrink-0 rounded-chip px-1 py-1 text-sm text-ink-muted tabular-nums focus-visible:outline-2 focus-visible:outline-ring"
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
          <p className="text-sm text-ink-muted">
            {memory.video?.transcriptState === "over_allowance"
              ? "Over 60 Minutes"
              : "Transcript Unavailable"}
          </p>
          {memory.description && (
            <p dir="auto" className="text-base wrap-anywhere">
              {memory.description}
            </p>
          )}
        </>
      )}
    </div>
  );
}
