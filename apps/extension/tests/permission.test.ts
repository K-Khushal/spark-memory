import { expect, it, vi } from "vitest";
import { grantCapture, type PermissionCapture } from "../lib/permission";
const api = vi.hoisted(() => ({
  permissions: { request: vi.fn() },
  runtime: { sendMessage: vi.fn() },
}));
vi.mock("wxt/browser", () => ({ browser: api }));
const job: PermissionCapture = {
  id: "gesture",
  mode: "image",
  tabId: 1,
  frameId: 0,
  origin: "https://images.test",
  expiresAt: 123,
};
it("handles denied and rejected grants and requests directly in the click stack", async () => {
  api.permissions.request.mockRejectedValueOnce(new Error("gesture required"));
  const result = grantCapture(job);
  expect(api.permissions.request).toHaveBeenCalledWith({
    origins: ["https://images.test/*"],
  });
  expect(await result).toEqual({ state: "error", label: "Try Again" });
  api.permissions.request.mockResolvedValueOnce(false);
  expect(await grantCapture(job)).toEqual({
    state: "error",
    label: "Grant Access",
  });
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
});
it("resumes only after the user grants access", async () => {
  api.permissions.request.mockResolvedValueOnce(true);
  api.runtime.sendMessage.mockResolvedValueOnce({ state: "saved" });
  expect(await grantCapture(job)).toEqual({ state: "saved" });
  expect(api.runtime.sendMessage).toHaveBeenCalledWith({
    type: "permission-capture",
    id: "gesture",
  });
});
