// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImportSection } from "./import-section";

vi.mock("@spark/api-client", () => ({
  createApiClient: () => ({
    api: {
      imports: {
        latest: {
          $get: async () =>
            Response.json({
              job: {
                id: "10000000-0000-4000-8000-000000000001",
                state: "paused",
                total: 10000,
                loaded: 10000,
                done: 9998,
                skipped: 1,
                spread: true,
                availableAt: "2020-01-01T00:00:00.000Z",
              },
            }),
        },
      },
    },
  }),
}));
vi.mock("../library/use-library", () => ({ importImageTransport: () => ({}) }));

it("announces state changes without announcing the progress counter", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ImportSection userId="reader" />));
    const state = [...host.querySelectorAll("span")].find(
      (span) => span.textContent === "Paused"
    )!;
    const counter = [...host.querySelectorAll("span")].find((span) =>
      span.textContent?.includes("Done /")
    )!;
    expect(state.closest('[aria-live="polite"]')).not.toBeNull();
    expect(counter.closest("[aria-live]")).toBeNull();
    expect(host.querySelector("progress")?.closest("[aria-live]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
