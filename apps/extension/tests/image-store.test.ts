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
