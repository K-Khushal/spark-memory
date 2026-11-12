import { Link } from "@tanstack/react-router";
import { Button } from "@spark/ui";
import type { ShareRefusal } from "./validate";

const COPY: Record<ShareRefusal, string> = {
  empty: "Nothing to Capture",
  too_long: "Too Long to Capture",
  too_large: "Files Over 25 MB Can't Be Captured",
  too_many: "Too Many Files to Capture",
  unsupported: "This File Type Can't Be Captured",
  unreadable: "This Share Can't Be Read",
  storage: "This Share Couldn't Be Saved",
  untrusted: "This Share Can't Be Verified",
};

/** Whether `value` names a refusal the share target can send. */
export const isShareRefusal = (value: unknown): value is ShareRefusal =>
  typeof value === "string" && Object.hasOwn(COPY, value);

/** What a share the service worker turned away says, so it is never taken as delivered. */
export function ShareRefused({ reason }: { reason: ShareRefusal }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-12">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-center font-display text-xl font-semibold tracking-[-0.02em]">
          {COPY[reason]}
        </h1>
        <Button variant="outline" asChild>
          <Link to="/">Open Library</Link>
        </Button>
      </div>
    </main>
  );
}
