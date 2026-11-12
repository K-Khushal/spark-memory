import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { LinkCapture, PageExtract, SCREENSHOT_MAX_BYTES } from "@spark/core";
import { captureClient, ApiError, type SavedMemory } from "../lib/client";
import { API_ORIGIN } from "../lib/config";
import { createOutbox, type PendingCapture } from "../lib/outbox";

type Result =
  | { state: "saved" | "duplicate"; memory: SavedMemory; owner: string }
  | { state: "queued" | "signed-out" | "error"; label?: string };
export default defineBackground(() => {
  const api = captureClient(API_ORIGIN);
  const pending = new Map<
    number,
    { url: string; resolve(page: PageExtract): void }
  >();
  const box = createOutbox({
    read: async () =>
      (await browser.storage.local.get<{ outbox?: PendingCapture[] }>("outbox"))
        .outbox ?? [],
    write: async (outbox) => {
      await browser.storage.local.set({ outbox });
    },
    send: async (row) => {
      const memory = await api.save(row.owner, row.capture);
      if (row.screenshot) {
        try {
          await api.screenshot(row.owner, memory.id, row.screenshot);
        } catch (error) {
          // Storage allowance refuses the optional copy; the Source is saved.
          if (!(error instanceof ApiError) || error.status !== 413) throw error;
        }
      }
      return memory;
    },
  });
  // No content-script access to either cached identity or preserved page content.
  void browser.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const identity = async () => {
    const me = await api.me();
    await browser.storage.local.set({ owner: me.id });
    return me.id;
  };
  async function retry() {
    try {
      await box.flush(await identity());
    } catch {
      /* Retain until explicit retry/sign-in. */
    }
  }
  browser.alarms.create("outbox", { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener(() => retry());
  browser.runtime.onStartup.addListener(() => retry());

  let running: Promise<Result> | undefined;
  async function capture(): Promise<Result> {
    let owner: string | undefined;
    try {
      owner = await identity();
    } catch (error) {
      if (error instanceof ApiError && !error.retryable)
        return { state: "signed-out" };
      owner = (await browser.storage.local.get<{ owner?: string }>("owner"))
        .owner;
    }
    if (!owner) return { state: "signed-out" };
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (
      !tab?.id ||
      !tab.url ||
      !/^https?:\/\//.test(tab.url) ||
      new URL(tab.url).origin === API_ORIGIN
    ) {
      return { state: "error", label: "Open a Web Page" };
    }
    const tabId = tab.id;
    const url = tab.url;
    const page = await new Promise<PageExtract>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(tabId);
        resolve(PageExtract.parse({ title: tab.title?.slice(0, 300) }));
      }, 5000);
      pending.set(tabId, {
        url,
        resolve: (value) => {
          clearTimeout(timer);
          pending.delete(tabId);
          resolve(value);
        },
      });
      browser.scripting
        .executeScript({ target: { tabId }, files: ["/extract.js"] })
        .catch(() => {
          clearTimeout(timer);
          pending.delete(tabId);
          resolve(PageExtract.parse({ title: tab.title?.slice(0, 300) }));
        });
    });
    let screenshot: string | undefined;
    const [active] = await browser.tabs.query({
      active: true,
      windowId: tab.windowId,
    });
    if (active?.id === tabId && active.url === url) {
      const data = await browser.tabs
        .captureVisibleTab(tab.windowId, { format: "jpeg", quality: 35 })
        .catch(() => undefined);
      const [after] = await browser.tabs.query({
        active: true,
        windowId: tab.windowId,
      });
      if (
        after?.id === tabId &&
        after.url === url &&
        data &&
        data.length * 0.75 <= SCREENSHOT_MAX_BYTES
      )
        screenshot = data;
    }
    const id = crypto.randomUUID();
    await box.add({
      owner,
      capture: LinkCapture.parse({ id, url, page }),
      screenshot,
      addedAt: Date.now(),
    });
    const results = await box.flush(owner);
    const sent = results.find((row) => row.captureId === id);
    return sent
      ? {
          state: sent.memory.id === id ? "saved" : "duplicate",
          memory: sent.memory,
          owner,
        }
      : { state: "queued" };
  }
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return;
    if (
      message?.type === "extracted" &&
      sender.tab?.id &&
      sender.frameId === 0
    ) {
      const job = pending.get(sender.tab.id);
      const parsed = PageExtract.safeParse(message.page);
      if (
        job &&
        sender.url === job.url &&
        message.url === job.url &&
        parsed.success
      )
        job.resolve(parsed.data);
      return;
    }
    if (sender.url !== browser.runtime.getURL("/popup.html")) return;
    if (message?.type === "capture") {
      running ??= capture()
        .catch((error): Result => ({
          state:
            error instanceof ApiError && error.status === 401
              ? "signed-out"
              : "error",
          label:
            error instanceof Error && error.message === "Outbox Full"
              ? "Outbox Full"
              : "Try Again",
        }))
        .finally(() => {
          running = undefined;
        });
      return running;
    }
    if (
      message?.type === "note" &&
      typeof message.note === "string" &&
      message.note.length <= 500
    ) {
      return api
        .note(message.owner, message.memory, message.note)
        .then((memory) => ({ memory }))
        .catch(() => ({ error: true }));
    }
    if (message?.type === "retry")
      return identity()
        .then(async (owner) => {
          const results = await box.flush(owner);
          const last = results.at(-1);
          return last
            ? { state: "saved", memory: last.memory, owner }
            : { state: "queued" };
        })
        .catch(() => ({ state: "signed-out" }));
    if (message?.type === "clear") return box.clear();
  });
});
