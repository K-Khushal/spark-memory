import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { imageStore } from "../lib/image-store";
it("keeps image bytes across worker instances and removes discarded owners' bytes", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  try {
    const first = imageStore();
    const bytes = { original: "large image", thumbnail: "small image" };
    await first.put("capture", bytes);
    const restarted = imageStore();
    expect(await restarted.get("capture")).toEqual(bytes);
    await restarted.retain([]);
    expect(await restarted.get("capture")).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("stores immutable image bytes only once, including after worker restart", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  try {
    const first = imageStore();
    await first.put("capture", { original: "first bytes", thumbnail: "thumb" });
    const restarted = imageStore();
    await restarted.put("capture", {
      original: "replacement",
      thumbnail: "other",
    });
    expect(await restarted.get("capture")).toEqual({
      original: "first bytes",
      thumbnail: "thumb",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
