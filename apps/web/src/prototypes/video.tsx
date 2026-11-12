import { useState } from "react";
import { Button } from "@spark/ui";
import { VideoReader } from "../library/video-reader";

const states = ["Demo", "Worst Case", "Empty", "One", "1,000 Rows"] as const;
/** Development-only break-ui harness for the actual transcript reader. */
export default function VideoPrototype() {
  const [state, setState] = useState<(typeof states)[number]>("Demo");
  const rows =
    state === "Empty"
      ? []
      : state === "Worst Case"
        ? [
            { seconds: 0, text: "अंतरिक्ष में पौधे 🌱 👩🏽‍💻" },
            {
              seconds: 3599,
              text: "نور الهدى عبد الرحمن " + "longunbrokenword".repeat(100),
            },
            {
              seconds: 760,
              text: "<script>alert(1)</script> &amp; literal transcript",
            },
          ]
        : state === "1,000 Rows"
          ? Array.from({ length: 1000 }, (_, i) => ({
              seconds: i * 3,
              text: `Segment ${i + 1}: Plants turn towards sunlight.`,
            }))
          : [{ seconds: 760, text: "Plants turn towards sunlight." }];
  return (
    <main className="min-h-dvh bg-canvas p-4 text-ink">
      <section className="mx-auto flex h-[80dvh] max-w-2xl flex-col rounded-panel bg-surface p-4 shadow-overlay">
        <VideoReader
          key={state}
          memory={{
            sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk&t=760",
            description: "Garden Film",
            video: {
              transcript: rows,
              transcriptState: rows.length ? "available" : "unavailable",
            },
          }}
        />
      </section>
      <nav
        aria-label="Demo Data"
        className="fixed inset-x-0 bottom-4 flex flex-wrap justify-center gap-2 bg-sunken p-2"
      >
        {states.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === state ? "primary" : "quiet"}
            onClick={() => setState(s)}
          >
            {s}
          </Button>
        ))}
      </nav>
    </main>
  );
}
