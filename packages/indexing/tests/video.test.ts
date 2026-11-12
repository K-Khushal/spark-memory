import { expect, it } from "vitest";
import { createGatherer, embeddingInputs } from "../index";
const url = "https://www.youtube.com/watch?v=abcdefghijk";
const caption = "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en";
const player = (duration: string) =>
  `<script>var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { lengthSeconds: duration }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: caption, languageCode: "en" }] } } })};</script>`;
it("keeps public captions as timestamped video text, never page navigation", async () => {
  const seen: string[] = [];
  const gatherer = createGatherer({
    resolve: async () => ["93.184.215.14"],
    fetch: async (input) => {
      const u = String(input);
      seen.push(u);
      return u.includes("timedtext")
        ? Response.json({
            events: [
              { tStartMs: 760000, segs: [{ utf8: "Plants need sunlight." }] },
            ],
          })
        : new Response(player("3600"), {
            headers: { "content-type": "text/html" },
          });
    },
  });
  const found = await gatherer.gather(url);
  expect(found.text).toBe("Plants need sunlight.");
  expect(found.metadata.video).toMatchObject({
    transcriptState: "available",
    transcript: [{ seconds: 760, text: "Plants need sunlight." }],
  });
  expect(seen.some((u) => u.includes("timedtext"))).toBe(true);
});
it("does not request captions above the allowance or with unknown duration", async () => {
  for (const duration of ["3601", "bad"]) {
    const seen: string[] = [];
    const g = createGatherer({
      resolve: async () => ["93.184.215.14"],
      fetch: async (input) => {
        seen.push(String(input));
        return new Response(player(duration), {
          headers: { "content-type": "text/html" },
        });
      },
    });
    const result = await g.gather(url);
    expect(result.text).toBeNull();
    expect(seen.some((u) => u.includes("timedtext"))).toBe(false);
  }
});
it("Passage vectors retain the spoken moment", () => {
  const result = embeddingInputs({
    title: null,
    captureNote: null,
    body: "Plants need sunlight.",
    transcript: [{ seconds: 760, text: "Plants need sunlight." }],
    found: {
      title: "Plants",
      description: "Gardening",
      ocrText: "",
      tags: [],
      entities: [],
    },
  });
  expect(result.parts[1]).toMatchObject({
    kind: "passage",
    anchor: { field: "body", start: 0, end: 21, seconds: 760 },
  });
});

it("stops caption requests if permission changes during DNS", async () => {
  let allowed = true;
  let lookups = 0;
  const seen: string[] = [];
  const g = createGatherer({
    resolve: async () => {
      if (++lookups === 2) allowed = false;
      return ["93.184.215.14"];
    },
    fetch: async (input) => {
      seen.push(String(input));
      return new Response(player("60"), {
        headers: { "content-type": "text/html" },
      });
    },
  });
  const found = await g.gather(url, { thirdParty: async () => allowed });
  expect(seen).toEqual([url]);
  expect(found.metadata.video?.transcriptState).toBe("unavailable");
});

it("rejects caption URLs outside the public YouTube timedtext endpoint", async () => {
  const seen: string[] = [];
  const g = createGatherer({
    resolve: async () => ["93.184.215.14"],
    fetch: async (input) => {
      seen.push(String(input));
      return new Response(
        player("60").replaceAll(
          "https://www.youtube.com/api/timedtext",
          "https://evil.test/private"
        ),
        { headers: { "content-type": "text/html" } }
      );
    },
  });
  const found = await g.gather(url);
  expect(found.metadata.video?.transcriptState).toBe("unavailable");
  expect(seen.some((u) => u.includes("evil.test"))).toBe(false);
});

it("embeds the end of a full allowance transcript even with frequent paragraph boundaries", () => {
  const text = ("x".repeat(1000) + "\n\n").repeat(99);
  const result = embeddingInputs({
    title: null,
    captureNote: null,
    body: text,
    transcript: [{ seconds: 0, text }],
    found: {
      title: "Film",
      description: "",
      ocrText: "",
      tags: [],
      entities: [],
    },
  });
  expect(result.parts.at(-1)).toMatchObject({
    kind: "passage",
    anchor: { end: text.length },
  });
});
