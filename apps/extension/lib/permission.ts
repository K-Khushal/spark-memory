import { browser } from "wxt/browser";
export type PermissionCapture = {
  id: string;
  mode: string;
  imageUrl?: string;
  tabId: number;
  frameId: number;
  origin: string;
  expiresAt: number;
};
/** Called directly by the permission page's button, before any await. */
export async function grantCapture(job: PermissionCapture) {
  try {
    const granted = await browser.permissions.request({
      origins: [job.origin + "/*"],
    });
    if (!granted) return { state: "error", label: "Grant Access" };
    return await browser.runtime.sendMessage({
      type: "permission-capture",
      id: job.id,
    });
  } catch {
    return { state: "error", label: "Try Again" };
  }
}
