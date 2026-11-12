import { afterEach, beforeEach, expect, it, vi } from "vitest";
import background from "../entrypoints/background";

const browser = vi.hoisted(() => ({
  storage: { local: { get: vi.fn(), set: vi.fn(), setAccessLevel: vi.fn() } },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    get: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  runtime: {
    id: "spark",
    getURL: (path: string) => `chrome-extension://spark${path}`,
    onMessage: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
  },
  tabs: { query: vi.fn(), captureVisibleTab: vi.fn() },
  scripting: { executeScript: vi.fn() },
}));
vi.mock("wxt/browser", () => ({ browser }));
let stored: Record<string, unknown>;
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  stored = { outbox: [], owner: "ana" };
  browser.storage.local.get.mockImplementation(async () =>
    structuredClone(stored)
  );
  browser.storage.local.set.mockImplementation(async (value) => {
    Object.assign(stored, structuredClone(value));
  });
  browser.alarms.get.mockResolvedValue(undefined);
  browser.alarms.clear.mockResolvedValue(true);
  request = vi
    .fn()
    .mockImplementation(async (url: string) =>
      url.endsWith("/me")
        ? Response.json({ id: "ana" })
        : Response.json({ id: "memory", revision: 1 })
    );
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const alarm = () => browser.alarms.onAlarm.addListener.mock.calls[0]![0]();
const message = (type: string) =>
  browser.runtime.onMessage.addListener.mock.calls[0]![0](
    { type },
    { id: "spark", url: "chrome-extension://spark/popup.html" }
  );
it("never refreshes a session or creates a retry alarm for an empty outbox", async () => {
  background.main();
  await alarm();
  expect(request).not.toHaveBeenCalled();
  expect(browser.alarms.create).not.toHaveBeenCalled();
  expect(browser.alarms.clear).toHaveBeenCalledWith("outbox");
});
it("clears the retry alarm when the last queued Capture sends", async () => {
  stored.outbox = [
    { owner: "ana", capture: { id: "capture", url: "https://garden.test" } },
  ];
  background.main();
  await alarm();
  expect(request).toHaveBeenCalledTimes(2);
  expect(stored.outbox).toEqual([]);
  expect(browser.alarms.clear).toHaveBeenCalledWith("outbox");
});
const tab = {
  id: 1,
  windowId: 1,
  url: "https://garden.test/basil",
  title: "Basil",
};
function captureTab() {
  browser.tabs.query.mockResolvedValue([tab]);
  browser.tabs.captureVisibleTab.mockResolvedValue(undefined);
}
it("omits page data when injection fails so the server can gather", async () => {
  captureTab();
  browser.scripting.executeScript.mockRejectedValue(new Error("restricted"));
  background.main();
  await message("capture");
  const save = request.mock.calls.find(([url]) => url.endsWith("/links"));
  expect(JSON.parse(save![1].body)).not.toHaveProperty("page");
});
it("uses the paste fallback immediately when the extractor reports failure", async () => {
  vi.useFakeTimers();
  captureTab();
  browser.scripting.executeScript.mockImplementation(async () => {
    browser.runtime.onMessage.addListener.mock.calls[0]![0](
      { type: "extracted", url: tab.url, failed: true },
      { id: "spark", tab, frameId: 0, url: tab.url }
    );
  });
  background.main();
  await message("capture");
  expect(
    JSON.parse(
      request.mock.calls.find(([url]) => url.endsWith("/links"))![1].body
    )
  ).not.toHaveProperty("page");
});
it("keeps an offline retry queued instead of claiming the session expired", async () => {
  stored.outbox = [{ owner: "ana", capture: { id: "capture", url: tab.url } }];
  request.mockRejectedValue(new TypeError("offline"));
  background.main();
  expect(await message("retry")).toMatchObject({
    state: "queued",
    hasRows: true,
  });
});
it("returns the Sign In state without an error label when capture receives 401", async () => {
  captureTab();
  browser.scripting.executeScript.mockRejectedValue(new Error("restricted"));
  request.mockImplementation(async (url: string) =>
    url.endsWith("/me")
      ? Response.json({ id: "ana" })
      : new Response(null, { status: 401 })
  );
  background.main();
  const result = await message("capture");
  expect(result).toMatchObject({ state: "signed-out", hasRows: true });
  expect(result).not.toHaveProperty("label");
});
it("reports a permanent refusal once even when it occurred during an alarm", async () => {
  stored.outbox = [{ owner: "ana", capture: { id: "capture", url: tab.url } }];
  request.mockImplementation(async (url: string) =>
    url.endsWith("/me")
      ? Response.json({ id: "ana" })
      : new Response(null, { status: 400 })
  );
  background.main();
  await alarm();
  expect(await message("status")).toEqual({ hasRows: false, refused: 400 });
  expect(await message("status")).toEqual({ hasRows: false });
});
it("creates the retry alarm only after adding an offline Capture", async () => {
  captureTab();
  browser.scripting.executeScript.mockRejectedValue(new Error("restricted"));
  request.mockImplementation(async (url: string) => {
    if (url.endsWith("/me")) return Response.json({ id: "ana" });
    throw new TypeError("offline");
  });
  background.main();
  expect(browser.alarms.create).not.toHaveBeenCalled();
  expect(await message("capture")).toMatchObject({
    state: "queued",
    hasRows: true,
  });
  expect(browser.alarms.create).toHaveBeenCalledWith("outbox", {
    periodInMinutes: 1,
  });
  await message("clear");
  expect(browser.alarms.clear).toHaveBeenCalledWith("outbox");
});
it("drops the previous account's queued page after /me confirms a different owner", async () => {
  stored.outbox = [
    {
      owner: "ben",
      capture: { id: "private", url: tab.url },
      screenshot: "private bytes",
    },
  ];
  background.main();
  await alarm();
  expect(stored.outbox).toEqual([]);
  expect(request).toHaveBeenCalledTimes(1);
});
it("does not lose a refusal notice while showing Sign In", async () => {
  stored.outboxRefusal = 400;
  request.mockResolvedValue(new Response(null, { status: 401 }));
  background.main();
  expect(await message("capture")).toMatchObject({ state: "signed-out" });
  expect(await message("status")).toEqual({ hasRows: false, refused: 400 });
});
it("cannot clear a newly queued alarm using an earlier empty snapshot", async () => {
  let release!: (value: Record<string, unknown>) => void;
  let scheduled = false;
  browser.storage.local.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  browser.alarms.create.mockImplementation(async () => {
    scheduled = true;
  });
  browser.alarms.clear.mockImplementation(async () => {
    scheduled = false;
    return true;
  });
  captureTab();
  browser.scripting.executeScript.mockRejectedValue(new Error("restricted"));
  request.mockImplementation(async (url: string) => {
    if (url.endsWith("/me")) return Response.json({ id: "ana" });
    throw new TypeError("offline");
  });
  background.main();
  const tick = alarm();
  const saving = message("capture");
  await new Promise((resolve) => setTimeout(resolve, 0));
  release({ outbox: [] });
  await Promise.all([tick, saving]);
  expect(stored.outbox).toHaveLength(1);
  expect(scheduled).toBe(true);
});
