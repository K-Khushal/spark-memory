import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { THEMES } from "@spark/ui/tokens";
import { selectRegion } from "../lib/region";
import { selectionCapture, videoSource } from "../lib/capture";
import type { PermissionCapture } from "../lib/permission";
import { imageStore } from "../lib/image-store";
import { fetchImage, prepareCapture } from "../lib/image";
import {
  FREE_ALLOWANCE,
  instagramReel,
  LinkCapture,
  PageExtract,
  REEL_COPY,
  SCREENSHOT_MAX_BYTES,
} from "@spark/core";
import { adapterFor } from "../lib/sites";
import { readReel, REEL_READ } from "../lib/sites/reel";
import { captureClient, ApiError, type SavedMemory } from "../lib/client";
import { API_ORIGIN } from "../lib/config";
import {
  createOutbox,
  type PendingCapture,
  type OutboxState,
} from "../lib/outbox";

const documentSource = (url: string) => {
  const hash = url.indexOf("#"),
    directive = hash < 0 ? -1 : url.indexOf(":~:", hash);
  return directive < 0 ? url : url.slice(0, directive).replace(/#$/, "");
};
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
  let feedback: Result["state"] | undefined;
  async function clearFeedback() {
    feedback = undefined;
    await browser.action.setBadgeText({ text: "" });
    await browser.action.setTitle({ title: "Spark" });
  }
  async function retry() {
    if (!(await box.reconcile())) return;
    try {
      const sent = await box.flush(await identity());
      if (
        sent.length &&
        !(await box.takeStatus(false)).hasRows &&
        (feedback === undefined ||
          feedback === "queued" ||
          feedback === "signed-out")
      )
        await clearFeedback();
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
  async function showFeedback(result: Awaited<ReturnType<typeof present>>) {
    if (result.state === "queued" && !result.hasRows) {
      await clearFeedback();
      return result;
    }
    feedback = result.state;
    const label =
      result.state === "saved"
        ? "Captured"
        : result.state === "duplicate"
          ? "Already in Your Library"
          : result.state === "queued"
            ? "Waiting to Send"
            : result.state === "signed-out"
              ? "Sign In"
              : (("label" in result ? result.label : undefined) ?? "Try Again");
    await browser.action.setBadgeText({
      text: result.state === "saved" || result.state === "duplicate" ? "" : "!",
    });
    await browser.action.setTitle({ title: label });
    return result;
  }
  let running: Promise<Awaited<ReturnType<typeof present>>> | undefined;
  function dispatch(
    mode: string,
    imageUrl?: string,
    tabId?: number,
    frameId = 0,
    failure?: Result
  ) {
    if (running) return running;
    running = (
      failure
        ? Promise.resolve(failure)
        : capture(mode, imageUrl, tabId, frameId)
    )
      .catch((error) => failed(error, "error"))
      .then(present)
      .then(showFeedback)
      .finally(() => {
        running = undefined;
      });
    return running;
  }
  browser.commands.onCommand.addListener((command) =>
    dispatch(command.replace("save-", ""))
  );
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (running) return running;
    try {
      const resource =
        info.menuItemId === "image"
          ? info.srcUrl
          : info.menuItemId === "selection" &&
              info.frameId !== 0 &&
              info.frameUrl &&
              new URL(info.frameUrl).origin !==
                new URL(tab?.url ?? info.frameUrl).origin
            ? info.frameUrl
            : undefined;
      if (resource) {
        const origin = new URL(resource).origin;
        if (!/^https?:/.test(origin) || tab?.id === undefined)
          throw new Error("Unsupported Source");
        if (
          !(await browser.permissions.contains({ origins: [origin + "/*"] }))
        ) {
          const job: PermissionCapture = {
            id: crypto.randomUUID(),
            mode: String(info.menuItemId),
            imageUrl: info.srcUrl,
            tabId: tab.id,
            frameId: info.frameId ?? 0,
            origin,
            expiresAt: Date.now() + 5 * 60_000,
          };
          await browser.storage.session.set({ permissionCapture: job });
          await browser.tabs.create({
            url: browser.runtime.getURL("/permission.html") + "#" + job.id,
          });
          return dispatch(job.mode, undefined, undefined, 0, {
            state: "error",
            label: "Grant Access",
          });
        }
      }
      return dispatch(
        String(info.menuItemId),
        info.srcUrl,
        tab?.id,
        info.frameId
      );
    } catch {
      return dispatch("page", undefined, undefined, 0, {
        state: "error",
        label: "Try Again",
      });
    }
  });
  /**
   * A reel's copy for Indexing (ADR-0010), read by the person's own browser
   * session in the tab and uploaded to storage. Never awaited by a Capture
   * and never fatal: anything that goes wrong leaves the reel saved as
   * Reference only. The bytes pass through memory here, never storage.
   */
  async function copyReel(
    owner: string,
    memoryId: string,
    tabId: number,
    code: string
  ) {
    try {
      // Before downloading up to 25 MB: would Spark use it?
      if (!(await api.copyWanted(owner, memoryId))) return;
      const [run] = await browser.scripting.executeScript({
        target: { tabId },
        func: readReel,
        args: [
          code,
          {
            appId: REEL_READ.appId,
            maxBytes: FREE_ALLOWANCE.maxUploadBytes,
            maxFrames: REEL_COPY.maxFrames,
            frameMaxBytes: REEL_COPY.frameMaxBytes,
            maxSeconds: FREE_ALLOWANCE.videoTranscriptMaxMinutes * 60,
          },
        ],
      });
      const read = run?.result;
      if (read?.ok) await api.copy(owner, memoryId, read);
    } catch {
      /* Reference only: the Memory is already saved. */
    }
  }
  async function capture(
    mode = "page",
    imageUrl?: string,
    targetTab?: number,
    frameId = 0
  ): Promise<Result> {
    // "page-plain": the person declined a site's host access; the generic reader.
    const plain = mode === "page-plain";
    if (plain) mode = "page";
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
            memory: { ...sent, title: sent.title ?? tab.title ?? null },
            owner,
          }
        : { state: "queued" };
    };
    if (mode === "selection") {
      const [result] = await browser.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: () => {
          const selection = window.getSelection();
          const range = selection?.rangeCount
            ? selection.getRangeAt(0)
            : undefined;
          let prefix = "",
            suffix = "";
          if (range && document.body) {
            const before = document.createRange(),
              after = document.createRange();
            before.selectNodeContents(document.body);
            before.setEnd(range.startContainer, range.startOffset);
            after.selectNodeContents(document.body);
            after.setStart(range.endContainer, range.endOffset);
            prefix =
              before
                .toString()
                .slice(-100)
                .match(/\s(.+)$/s)?.[1] ?? "";
            suffix =
              after
                .toString()
                .slice(0, 100)
                .match(/^(.+)\s/s)?.[1] ?? "";
          }
          const text = selection?.toString() ?? "";
          return {
            text,
            context: (prefix + text.slice(0, 1800) + suffix).slice(0, 2000),
            prefix,
            suffix,
            title: document.title.slice(0, 500),
            url: location.href,
          };
        },
      });
      if (
        !result?.result?.text ||
        (frameId === 0 &&
          documentSource(result.result.url) !== documentSource(url))
      )
        return { state: "error", label: "Select Text" };
      return complete({
        owner,
        capture: selectionCapture(
          result.result.url,
          result.result.text,
          result.result.context,
          result.result.title,
          {
            prefix: result.result.prefix ?? "",
            suffix: result.result.suffix ?? "",
          }
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
          args: [THEMES, browser.runtime.getURL("/fonts/instrument.woff2")],
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
      prepared.capture.sourceUrl = mode === "image" ? imageUrl : url;
      return complete({ owner, ...prepared, addedAt: Date.now() });
    }
    playback.delete(tabId);
    const adapter = plain ? undefined : adapterFor(url);
    if (
      adapter &&
      !(await browser.permissions.contains({
        origins: [adapter.origin + "/*"],
      }))
    ) {
      // First use of this site: its host, only on a click, never in the background.
      const job: PermissionCapture = {
        id: crypto.randomUUID(),
        mode: "page",
        adapter: true,
        tabId,
        frameId: 0,
        origin: adapter.origin,
        expiresAt: Date.now() + 5 * 60_000,
      };
      await browser.storage.session.set({ permissionCapture: job });
      await browser.tabs.create({
        url: browser.runtime.getURL("/permission.html") + "#" + job.id,
      });
      return { state: "error", label: "Grant Access" };
    }
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
        .executeScript({
          target: { tabId },
          files: [adapter ? "/extract-site.js" : "/extract.js"],
        })
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
    const reel = instagramReel(url);
    // Only the Capture that made the Memory: saving a reel again must not
    // download, upload and transcribe it again.
    if (sent && sent.id === id && adapter && reel)
      void copyReel(owner, sent.id, tabId, reel);
    return sent
      ? {
          state: sent.id === id ? "saved" : "duplicate",
          memory: {
            ...sent,
            title: sent.title ?? page?.title ?? tab.title ?? null,
          },
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
        documentSource(sender.url ?? "") === documentSource(job.url) &&
        documentSource(message.url ?? "") === documentSource(job.url) &&
        (message.failed === true || parsed.success)
      ) {
        if (typeof message.time === "number" && Number.isFinite(message.time))
          playback.set(sender.tab.id, message.time);
        else playback.delete(sender.tab.id);
        job.resolve(parsed.success ? parsed.data : undefined);
      }
      return;
    }
    if (
      sender.url?.split("#")[0] ===
        browser.runtime.getURL("/permission.html") &&
      (message?.type === "permission-capture" ||
        message?.type === "permission-cancel")
    ) {
      return (async () => {
        const { permissionCapture: job } = await browser.storage.session.get<{
          permissionCapture?: PermissionCapture;
        }>("permissionCapture");
        if (!job || job.id !== message.id)
          return { state: "error", label: "Try Again" };
        if (
          message.type === "permission-cancel" ||
          job.expiresAt < Date.now()
        ) {
          await browser.storage.session.remove("permissionCapture");
          // Declining a site's host access is not declining the Capture.
          if (job.adapter && message.type === "permission-cancel") {
            await browser.tabs.update(job.tabId, { active: true });
            return dispatch("page-plain", undefined, job.tabId, 0);
          }
          await clearFeedback();
          return { state: "error", label: "Cancelled" };
        }
        try {
          if (
            !(await browser.permissions.contains({
              origins: [job.origin + "/*"],
            }))
          )
            return dispatch(job.mode, undefined, undefined, 0, {
              state: "error",
              label: "Grant Access",
            });
          await browser.tabs.update(job.tabId, { active: true });
          await browser.storage.session.remove("permissionCapture");
          return dispatch(job.mode, job.imageUrl, job.tabId, job.frameId);
        } catch {
          return dispatch(job.mode, undefined, undefined, 0, {
            state: "error",
            label: "Try Again",
          });
        }
      })();
    }
    if (sender.url !== browser.runtime.getURL("/popup.html")) return;
    if (["capture", "selection", "region"].includes(message?.type)) {
      return dispatch(message.type === "capture" ? "page" : message.type);
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
        .then(present)
        .then(showFeedback);
    if (message?.type === "clear") return box.clear().then(clearFeedback);
  });
});
