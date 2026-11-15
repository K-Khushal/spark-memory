import { Link } from "@tanstack/react-router";
import { Button, StateBlock } from "@spark/ui";
import { REFUSAL_COPY } from "./refusal";
import type { ShareRefusal } from "./validate";

/** What a share the service worker turned away says, so it is never taken as delivered. */
export function ShareRefused({ reason }: { reason: ShareRefusal }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-12">
      <StateBlock title={REFUSAL_COPY[reason]} level={1} align="centre">
        <Button variant="outline" asChild>
          <Link to="/">Open Library</Link>
        </Button>
      </StateBlock>
    </main>
  );
}
