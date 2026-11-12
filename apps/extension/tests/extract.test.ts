import { afterEach, expect, it, vi } from "vitest";
import extract from "../entrypoints/extract";
const sendMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("wxt/browser", () => ({ browser: { runtime: { sendMessage } } }));
afterEach(() => vi.unstubAllGlobals());
it("reports extraction exceptions to the worker immediately", async () => {
  vi.stubGlobal("document", {
    cloneNode: () => {
      throw new Error("unreadable document");
    },
  });
  vi.stubGlobal("location", { href: "https://garden.test" });
  await extract.main();
  expect(sendMessage).toHaveBeenCalledWith({
    type: "extracted",
    url: "https://garden.test",
    failed: true,
  });
});
