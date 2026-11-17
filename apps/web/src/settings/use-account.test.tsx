// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useAccount } from "./use-account";
const { getExport } = vi.hoisted(() => ({ getExport: vi.fn() }));
vi.mock("../api", () => ({
  api: {
    api: {
      account: {
        sessions: { $get: async () => Response.json({ sessions: [] }) },
        export: { $get: getExport },
      },
      usage: { $get: async () => Response.json({}) },
    },
  },
}));
vi.mock("../auth", () => ({ endSession: vi.fn() }));
it("stops an export poll held across unmount and does not stack loops on remount", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const building = () =>
    Response.json({ export: { state: "building", requestedAt: "2026-11-17" } });
  let resolve!: (response: Response) => void;
  getExport
    .mockImplementationOnce(async () => building())
    .mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        })
    );
  function Probe() {
    useAccount();
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    await act(async () => root.unmount());
    expect(getExport.mock.calls[1]![1].init.signal.aborted).toBe(true);
    await act(async () => resolve(building()));
    expect(vi.getTimerCount()).toBe(0);
    getExport.mockImplementation(async () => building());
    const next = createRoot(host);
    await act(async () => next.render(<Probe />));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => next.unmount());
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
