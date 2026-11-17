// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImportSection } from "./import-section";
const state = vi.hoisted(() => ({
  pending: ["one", "two", "three"],
  failed: false,
  saved: [] as string[],
  deleted: [] as string[],
}));
vi.mock("@spark/api-client", () => ({
  createApiClient: () => ({
    api: {
      imports: {
        latest: {
          $get: async () =>
            Response.json({
              job: {
                id: "job",
                state: "running",
                total: 3,
                loaded: 3,
                done: 0,
                skipped: 0,
                spread: true,
              },
            }),
        },
        ":id": {
          images: {
            $get: async () => Response.json({ ids: [...state.pending] }),
          },
        },
      },
    },
  }),
}));
vi.mock("./import-files", () => ({
  clearImportFiles: vi.fn(),
  importFile: async (_user: string, key: string, value?: null) => {
    if (value === null) state.deleted.push(key);
    else return new File(["image"], "image.png");
  },
}));
vi.mock("../library/use-library", () => ({ importImageTransport: () => ({}) }));
vi.mock("../library/image-capture", () => ({
  imageCapture: (options: { onSaved: () => void }) => ({
    capture: async (_files: File[], ids: string[]) => {
      if (ids[0] === "one" && !state.failed) {
        state.failed = true;
      } else {
        state.saved.push(ids[0]!);
        state.pending = state.pending.filter((id) => id !== ids[0]);
        options.onSaved();
      }
    },
    outcome: async (id: string) =>
      state.saved.includes(id) ? "stored" : "failed",
    retry: (id: string) => {
      state.saved.push(id);
      state.pending = state.pending.filter((item) => item !== id);
      options.onSaved();
    },
    cancel: vi.fn(),
  }),
}));
it("retries the failed image and drains the remaining originals without navigation", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ImportSection userId="reader" />));
    expect(state.saved).toEqual([]);
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Try Again"
    )!;
    await act(async () => retry.click());
    expect(state.saved).toEqual(["one", "two", "three"]);
    expect(state.deleted).toEqual(["job/one", "job/two", "job/three"]);
  } finally {
    await act(async () => root.unmount());
  }
});
