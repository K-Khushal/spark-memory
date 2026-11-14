import { useState } from "react";
import { Button } from "@spark/ui";
import {
  ImageQueryControls,
  SearchByImage,
  memoryImageQuery,
  useImageQuery,
} from "../library/image-query";
import type { Memory } from "../library/use-library";

const titles = [
  "Q3 Board Deck — FINAL (revised) v12 [approved by legal].png",
  "https://example.com/workspaces/northwind-industries-holdings/projects/international-enterprise-onboarding/design-references/notification-preferences-and-permissions/reviews/2026/quarter-four/approved-by-security-and-legal/board-deck-final-revised-version-12/settings-and-account-preferences-mobile-web.png".slice(
    0,
    300
  ),
  "王秀英 👩🏽‍💻 — نور الهدى عبد الرحمن",
  "",
  "J",
];
const memory = (title: string, index: number): Memory => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  sample: false,
  hasVectors: true,
  kind: "image",
  title,
  body: null,
  captureNote: null,
  preservation: "preserved",
  indexState: "searchable",
  revision: 1,
  categories: [],
  categoriesLocked: false,
  categoriesVersion: null,
  deepFetch: null,
  aiOptOut: false,
  indexError: null,
  indexTitle: null,
  capturedAt: "2026-11-13T00:00:00Z",
  lastSavedAt: "2026-11-13T00:00:00Z",
  updatedAt: "2026-11-13T00:00:00Z",
  sourceUrl: null,
  video: null,
  pageTitle: null,
  description: null,
  pages: null,
  image: {
    url: "/favicon.svg",
    thumbnailUrl: "/favicon.svg",
    mime: "image/png",
    bytes: 100,
    width: 100,
    height: 100,
    thumbhash: "",
  },
});

/** Dev-only break-ui fixture: the same controls and props as the Library. */
export default function ImageQueryPrototype() {
  const states = ["Demo Data", "Worst Case", "Empty", "One", "1,000 Memories"];
  const [state, setState] = useState(() => {
    const saved = new URLSearchParams(location.search).get("queryData");
    return saved && states.includes(saved) ? saved : "Demo Data";
  });
  const query = useImageQuery();
  const names =
    state === "Empty"
      ? []
      : state === "One"
        ? ["J"]
        : state === "1,000 Memories"
          ? Array.from({ length: 1000 }, (_, i) => titles[i % titles.length]!)
          : state === "Worst Case"
            ? titles
            : ["Blue Dashboard", "Holiday Photo"];
  return (
    <main className="min-h-dvh bg-canvas p-4 text-ink">
      <div className="mx-auto max-w-xl rounded-control border border-line">
        <ImageQueryControls
          value={query.value}
          busy={query.busy}
          onChange={query.change}
          onFile={query.choose}
        />
      </div>
      <ul className="mx-auto max-h-[60dvh] max-w-xl overflow-auto">
        {names.map((name, index) => (
          <li key={index} className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {name || "Memory"}
            </span>
            <SearchByImage
              memory={memory(name, index)}
              onSelect={(m) => query.change(memoryImageQuery(m))}
            />
          </li>
        ))}
      </ul>
      <div className="fixed inset-x-0 bottom-4 flex flex-wrap justify-center gap-2 bg-canvas">
        {states.map((label) => (
          <Button
            key={label}
            variant={state === label ? "primary" : "quiet"}
            onClick={() => {
              const url = new URL(location.href);
              url.searchParams.set("queryData", label);
              history.replaceState(history.state, "", url);
              setState(label);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
    </main>
  );
}
