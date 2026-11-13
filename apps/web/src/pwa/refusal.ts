import { FREE_ALLOWANCE, formatSize } from "@spark/core";
import type { ShareRefusal } from "./validate";

/** What each refusal says (and the toast and page copy for a share that cannot be read or saved). */
export const REFUSAL_COPY: Record<ShareRefusal, string> = {
  empty: "Nothing to Capture",
  too_long: "Too Long to Capture",
  too_large: `Files Over ${formatSize(FREE_ALLOWANCE.maxUploadBytes)} Can't Be Captured`,
  too_many: "Too Many Files to Capture",
  unsupported: "This File Type Can't Be Captured",
  unreadable: "This Share Can't Be Read",
  storage: "This Share Couldn't Be Saved",
  untrusted: "This Share Can't Be Verified",
};

/** Whether `value` names a refusal the share target can send. */
export const isShareRefusal = (value: unknown): value is ShareRefusal =>
  typeof value === "string" && Object.hasOwn(REFUSAL_COPY, value);
