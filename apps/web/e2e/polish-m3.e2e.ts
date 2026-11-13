import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";
import type { Memory } from "../src/library/use-library";

// #23: a long transcript is one Tab stop, and Capture Note shows its focus ring.
test("video Memory detail is keyboard-reachable end to end", async ({
  page,
}) => {
  await signIn(page);
  const headers = { origin: new URL(page.url()).origin };
  await page.request.post("/api/memories", {
    headers,
    data: { id: crypto.randomUUID(), body: "base", captureNote: null },
  });
  const {
    memories: [base],
  } = (await (await page.request.get("/api/memories")).json()) as {
    memories: Memory[];
  };
  const video = {
    ...base!,
    kind: "video",
    title: "Garden Film",
    body: null,
    sourceUrl: "https://youtu.be/abcdefghijk",
    video: {
      transcriptState: "available",
      transcript: Array.from({ length: 60 }, (_, i) => ({
        seconds: i * 37,
        text: `Segment ${i}`,
      })),
    },
  } as Memory;
  await page.route("**/api/memories", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { memories: [video], unfinished: [] } })
      : route.fallback()
  );
  await page.reload();
  await page.getByRole("listitem", { name: "Garden Film" }).click();

  const transcript = page.getByRole("list", { name: "Transcript" });
  const stops = transcript.locator("button:not([tabindex='-1'])");
  await expect(stops).toHaveCount(1);
  await stops.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    transcript.getByRole("button", { name: "Play at 0:37" })
  ).toBeFocused();
  // One Tab leaves the transcript for the Capture Note, ring showing.
  await page.keyboard.press("Tab");
  const note = page.getByRole("textbox", { name: "Capture Note" });
  await expect(note).toBeFocused();
  await expect(note).toHaveCSS("outline-style", "solid");
});
