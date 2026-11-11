import { createLazyRoute } from "@tanstack/react-router";
import { LibraryPage } from "./library";

// Loaded on demand by the /prototypes route in router.tsx, so the reference
// Library stays out of the main bundle.
export const Route = createLazyRoute("/prototypes")({
  component: function PrototypesPage() {
    const { data } = Route.useSearch();
    return <LibraryPage key={data} data={data} />;
  },
});
