import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { THEMES } from "@spark/ui/tokens";
import { selectRegion } from "../lib/region";
import { selectionCapture, videoSource } from "../lib/capture";
import { imageStore } from "../lib/image-store";
import { fetchImage, prepareCapture } from "../lib/image";
import { LinkCapture, PageExtract, SCREENSHOT_MAX_BYTES } from "@spark/core";
import { captureClient, ApiError, type SavedMemory } from "../lib/client";
import { API_ORIGIN } from "../lib/config";
import {
  createOutbox,
  type PendingCapture,
  type OutboxState,
} from "../lib/outbox";

type Result =
  | { state: "saved" | "duplicate"; memory: SavedMemory; owner: string }
  | { state: "queued" | "signed-out" | "error"; label?: string };
export default defineBackground(() => {
  const api = captureClient(API_ORIGIN);
  const images = imageStore();
  const playback = new Map<number, number>();
  const pending = new Map<
    number,
    { url: string; resolve(page: PageExtract | undefined): void }
  >();
  async function syncAlarm(rows: PendingCapture[]) {
    if (!rows.length) await browser.alarms.clear("outbox");
    else if (!(await browser.alarms.get("outbox")))
      await browser.alarms.create("outbox", { periodInMinutes: 1 });
  }
  const box = createOutbox({
    read: async (): Promise<OutboxState> => {
      const stored = await browser.storage.local.get<{
        outbox?: PendingCapture[];
        outboxRefusal?: number | null;
      }>(["outbox", "outboxRefusal"]);
      return {
        rows: await Promise.all(
          (stored.outbox ?? []).map(async (row) =>
            "mime" in row.capture
              ? { ...row, image: await images.get(row.capture.id!) }
              : row
          )
        ),
        refused: stored.outboxRefusal ?? undefined,
      };
    },
    write: async ({ rows, refused }) => {
      for (const row of rows)
        if (row.image) await images.put(row.capture.id!, row.image);
      await browser.storage.local.set({
        outbox: rows.map(({ image: _, ...row }) => row),
        outboxRefusal: refused ?? null,
      });
      await images.retain(
        rows
          .filter((row) => "mime" in row.capture)
          .map((row) => row.capture.id!)
      );
      await syncAlarm(rows);
    },
    send: async (row) => {
      if ("mime" in row.capture && !row.image) throw new ApiError(400);
      const memory = await api.save(row.owner, row.capture, row.image);
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
  if (browser.storage.local.setAccessLevel)
    void browser.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  const identity = async () => {
    const me = await api.me();
    await box.useOwner(me.id);
    await browser.storage.local.set({ owner: me.id });
    return me.id;
  };
  async function retry() {
    if (!(await box.reconcile())) return;
    try {
      await box.flush(await identity());
    } catch {
      /* Retain until explicit retry/sign-in. */
    }
  }
  browser.alarms.onAlarm.addListener(() => retry());
  browser.runtime.onStartup.addListener(() => retry());
  browser.runtime.onInstalled.addListener(async () => {
    await browser.contextMenus.removeAll();
    for (const [id, title, contexts] of [
      ["page", "Save Page", ["page"]],
      ["selection", "Save Selection", ["selection"]],
      ["image", "Save Image", ["image"]],
      ["region", "Save Region", ["page"]],
    ] as const)
      browser.contextMenus.create({ id, title, contexts: [...contexts] });
    await retry();
  });

  function failed(error: unknown, offline: "queued" | "error"): Result {
    if (error instanceof ApiError && error.status === 401)
      return { state: "signed-out" };
    return {
      state: offline,
      ...(offline === "error" && {
        label:
          error instanceof Error && error.message === "Outbox Full"
            ? "Outbox Full"
            : "Try Again",
      }),
    };
  }
  async function present(
    result: Result
  ): Promise<Result & { hasRows: boolean }> {
    const { hasRows, refused } = await box.takeStatus(
      result.state !== "signed-out"
    );
    return {
      ...(refused !== undefined &&
      result.state !== "saved" &&
      result.state !== "duplicate"
        ? { state: "error", label: "Capture Refused" }
        : result),
      hasRows,
    };
  }
  let running: Promise<Awaited<ReturnType<typeof present>>> | undefined;
  function dispatch(mode: string, imageUrl?: string, tabId?: number) {
    if (running) return;
    running = capture(mode, imageUrl, tabId)
      .catch((error) => failed(error, "error"))
      .then(present)
      .then(async (result) => {
        const label =
          result.state === "saved"
            ? "Saved"
            : result.state === "duplicate"
              ? "Already in Your Library"
              : result.state === "queued"
                ? "Waiting to Send"
                : result.state === "signed-out"
                  ? "Sign In"
                  : (("label" in result ? result.label : undefined) ??
                    "Try Again");
        await browser.action.setBadgeText({
          text:
            result.state === "saved" || result.state === "duplicate"
              ? "✓"
              : "!",
        });
        await browser.action.setTitle({ title: label });
        return result;
      })
      .finally(() => {
        running = undefined;
      });
  }
  browser.commands.onCommand.addListener((command) =>
    dispatch(command.replace("save-", ""))
  );
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "image" && info.srcUrl) {
      let origin: string;
      try {
        origin = new URL(info.srcUrl).origin;
      } catch {
        return;
      }
      if (!/^https?:/.test(origin)) return;
      // Request the exact image host only in direct response to this gesture.
      void browser.permissions
        .request({ origins: [origin + "/*"] })
        .then((granted) => {
          if (granted) dispatch("image", info.srcUrl, tab?.id);
        });
    } else dispatch(String(info.menuItemId), undefined, tab?.id);
  });
  async function capture(
    mode = "page",
    imageUrl?: string,
    targetTab?: number
  ): Promise<Result> {
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
    if (targetTab !== undefined && tab.id !== targetTab)
      return { state: "error", label: "Try Again" };
    const tabId = tab.id;
    const url = tab.url;
    const complete = async (row: PendingCapture): Promise<Result> => {
      const sent = await box.submit(row);
      return sent
        ? {
            state: sent.id === row.capture.id ? "saved" : "duplicate",
            memory: sent,
            owner,
          }
        : { state: "queued" };
    };
    if (mode === "selection") {
      const [result] = await browser.scripting.executeScript({
        target: { tabId },
        func: () => {
          const selection = window.getSelection();
          return {
            text: selection?.toString() ?? "",
            context:
              selection?.anchorNode?.parentElement?.textContent?.slice(
                0,
                2000
              ) ?? "",
            title: document.title.slice(0, 500),
            url: location.href,
          };
        },
      });
      if (!result?.result?.text || result.result.url !== url)
        return { state: "error", label: "Select Text" };
      return complete({
        owner,
        capture: selectionCapture(
          url,
          result.result.text,
          result.result.context,
          result.result.title
        ),
        addedAt: Date.now(),
      });
    }
    if (mode === "image" || mode === "region") {
      let blob: Blob;
      let region;
      if (mode === "image") blob = await fetchImage(imageUrl!);
      else {
        const [result] = await browser.scripting.executeScript({
          target: { tabId },
          func: selectRegion,
          args: [THEMES],
        });
        region = result?.result;
        if (!region) return { state: "error", label: "Cancelled" };
        const [before] = await browser.tabs.query({
          active: true,
          windowId: tab.windowId,
        });
        if (before?.id !== tabId || before.url !== url)
          return { state: "error", label: "Try Again" };
        const data = await browser.tabs.captureVisibleTab(tab.windowId, {
          format: "png",
        });
        const [after] = await browser.tabs.query({
          active: true,
          windowId: tab.windowId,
        });
        if (after?.id !== tabId || after.url !== url)
          return { state: "error", label: "Try Again" };
        blob = await (
          await fetch(data, { signal: AbortSignal.timeout(5000) })
        ).blob();
      }
      const prepared = await prepareCapture(blob, region);
      return complete({ owner, ...prepared, addedAt: Date.now() });
    }
    playback.delete(tabId);
    const page = await new Promise<PageExtract | undefined>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(tabId);
        resolve(undefined);
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
          resolve(undefined);
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
    const sent = await box.submit({
      owner,
      capture: LinkCapture.parse({
        id,
        url: videoSource(url, playback.get(tabId)),
        page,
      }),
      screenshot,
      addedAt: Date.now(),
    });
    return sent
      ? {
          state: sent.id === id ? "saved" : "duplicate",
          memory: sent,
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
        (message.failed === true || parsed.success)
      ) {
        if (typeof message.time === "number" && Number.isFinite(message.time))
          playback.set(sender.tab.id, message.time);
        else playback.delete(sender.tab.id);
        job.resolve(parsed.success ? parsed.data : undefined);
      }
      return;
    }
    if (sender.url !== browser.runtime.getURL("/popup.html")) return;
    if (["capture", "selection", "region"].includes(message?.type)) {
      running ??= capture(message.type === "capture" ? "page" : message.type)
        .catch((error) => failed(error, "error"))
        .then(present)
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
        .then(async (owner): Promise<Result> => {
          const results = await box.flush(owner);
          const last = results.at(-1);
          return last
            ? { state: "saved", memory: last.memory, owner }
            : { state: "queued" };
        })
        .catch((error) => failed(error, "queued"))
        .then(present);
    if (message?.type === "clear") return box.clear();
  });
});
