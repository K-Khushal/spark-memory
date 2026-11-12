import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import background from "../entrypoints/background";

const browser = vi.hoisted(() => ({
  action: { setBadgeText: vi.fn(), setTitle: vi.fn() },
  commands: { onCommand: { addListener: vi.fn() } },
  permissions: { request: vi.fn(), contains: vi.fn() },
  contextMenus: {
    removeAll: vi.fn(),
    create: vi.fn(),
    onClicked: { addListener: vi.fn() },
  },
  storage: {
    session: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    local: { get: vi.fn(), set: vi.fn(), setAccessLevel: vi.fn() },
  },
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
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn(),
    captureVisibleTab: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  scripting: { executeScript: vi.fn() },
}));
vi.mock("wxt/browser", () => ({ browser }));
let stored: Record<string, unknown>;
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("indexedDB", new IDBFactory());
  stored = { outbox: [], owner: "ana" };
  browser.storage.local.get.mockImplementation(async () =>
    structuredClone(stored)
  );
  browser.storage.local.set.mockImplementation(async (value) => {
    Object.assign(stored, structuredClone(value));
  });
  browser.storage.session.get.mockResolvedValue({});
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
  expect(await message("retry")).toMatchObject({
    state: "error",
    label: "Capture Refused",
  });
  expect(await message("retry")).toMatchObject({ state: "queued" });
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
  expect(stored.outboxRefusal).toBe(400);
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

it("does not let an old refusal replace a successful new Capture", async () => {
  stored.outboxRefusal = 400;
  captureTab();
  browser.scripting.executeScript.mockRejectedValue(new Error("restricted"));
  background.main();
  expect(await message("capture")).toMatchObject({ state: "duplicate" });
  expect(stored.outboxRefusal).toBeNull();
});
it("retries queued Captures on installation/update", async () => {
  stored.outbox = [{ owner: "ana", capture: { id: "capture", url: tab.url } }];
  background.main();
  await browser.runtime.onInstalled.addListener.mock.calls[0]![0]();
  expect(stored.outbox).toEqual([]);
});
it("dispatches selection Capture through the text API", async () => {
  captureTab();
  browser.scripting.executeScript.mockResolvedValue([
    {
      result: {
        text: "Basil",
        context: "Growing Basil indoors",
        title: "Garden",
        url: tab.url,
      },
    },
  ]);
  background.main();
  await message("selection");
  const saved = request.mock.calls.find(([url]) => url.endsWith("/memories"));
  expect(JSON.parse(saved![1].body)).toMatchObject({
    body: "Basil",
    source: {
      url: tab.url + "#:~:text=Basil",
      context: "Growing Basil indoors",
    },
  });
});
it("captures the context-menu frame's selection with its own Source", async () => {
  captureTab();
  browser.scripting.executeScript.mockResolvedValue([
    {
      result: {
        text: "Basil",
        context: "Growing Basil",
        title: "Frame",
        url: "https://garden.test/frame",
      },
    },
  ]);
  background.main();
  await browser.contextMenus.onClicked.addListener.mock.calls[0]![0](
    {
      menuItemId: "selection",
      frameId: 7,
      frameUrl: "https://garden.test/frame",
    },
    tab
  );
  expect(browser.scripting.executeScript).toHaveBeenCalledWith(
    expect.objectContaining({ target: { tabId: 1, frameIds: [7] } })
  );
  expect(
    JSON.parse(
      request.mock.calls.find(([url]) => url.endsWith("/memories"))![1].body
    )
  ).toMatchObject({
    source: { url: "https://garden.test/frame#:~:text=Basil" },
  });
});

it("offers a user-gesture permission page instead of requesting from the background", async () => {
  background.main();
  browser.permissions.contains.mockResolvedValue(false);
  await browser.contextMenus.onClicked.addListener.mock.calls[0]![0](
    {
      menuItemId: "image",
      srcUrl: "https://images.test/basil.png",
      frameId: 0,
    },
    tab
  );
  expect(browser.permissions.request).not.toHaveBeenCalled();
  expect(browser.storage.session.set).toHaveBeenCalledWith({
    permissionCapture: expect.objectContaining({
      origin: "https://images.test",
      tabId: 1,
    }),
  });
  expect(browser.tabs.create).toHaveBeenCalledWith({
    url: expect.stringContaining("/permission.html#"),
  });
  expect(browser.action.setTitle).toHaveBeenLastCalledWith({
    title: "Grant Access",
  });
});
it("handles a rejected permission check without an unhandled menu rejection", async () => {
  background.main();
  browser.permissions.contains.mockRejectedValue(
    new Error("permission unavailable")
  );
  await expect(
    browser.contextMenus.onClicked.addListener.mock.calls[0]![0](
      { menuItemId: "image", srcUrl: "https://images.test/basil.png" },
      tab
    )
  ).resolves.toMatchObject({ state: "error", label: "Try Again" });
  expect(browser.action.setTitle).toHaveBeenLastCalledWith({
    title: "Try Again",
  });
});
it("clears an old badge when the queued state is resolved by an alarm", async () => {
  stored.outbox = [{ owner: "ana", capture: { id: "capture", url: tab.url } }];
  background.main();
  await alarm();
  expect(browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
  expect(browser.action.setTitle).toHaveBeenLastCalledWith({ title: "Spark" });
});
it("clears stale failure feedback when the outbox is discarded", async () => {
  background.main();
  await message("capture");
  expect(browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: "!" });
  await message("clear");
  expect(browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
  expect(browser.action.setTitle).toHaveBeenLastCalledWith({ title: "Spark" });
});
it("resumes a pending frame Capture only after an explicit page grant", async () => {
  captureTab();
  browser.permissions.contains.mockResolvedValue(true);
  browser.storage.session.get.mockResolvedValue({
    permissionCapture: {
      id: "grant",
      mode: "selection",
      tabId: 1,
      frameId: 7,
      origin: "https://garden.test",
      expiresAt: Date.now() + 60_000,
    },
  });
  browser.scripting.executeScript.mockResolvedValue([
    {
      result: {
        text: "Basil",
        context: "Basil grows",
        title: "Garden",
        url: "https://garden.test/frame",
      },
    },
  ]);
  background.main();
  const result = await browser.runtime.onMessage.addListener.mock.calls[0]![0](
    { type: "permission-capture", id: "grant" },
    { id: "spark", url: "chrome-extension://spark/permission.html#grant" }
  );
  expect(result).toMatchObject({ state: "duplicate" });
  expect(browser.permissions.request).not.toHaveBeenCalled();
  expect(browser.tabs.update).toHaveBeenCalledWith(1, { active: true });
  expect(browser.storage.session.remove).toHaveBeenCalledWith(
    "permissionCapture"
  );
  expect(browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
});
