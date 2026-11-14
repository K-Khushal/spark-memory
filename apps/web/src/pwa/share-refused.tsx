import { Link } from "@tanstack/react-router";
import { Button } from "@spark/ui";
import { REFUSAL_COPY } from "./refusal";
import type { ShareRefusal } from "./validate";

/** What a share the service worker turned away says, so it is never taken as delivered. */
export function ShareRefused({ reason }: { reason: ShareRefusal }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-12">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-center font-display text-xl font-semibold">
          {REFUSAL_COPY[reason]}
        </h1>
        <Button variant="outline" asChild>
          <Link to="/">Open Library</Link>
        </Button>
      </div>
    </main>
  );
}
