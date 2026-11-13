import { lazy, Suspense } from "react";
import { createLazyRoute } from "@tanstack/react-router";
import { LibraryPage } from "./library";

const SelectionPrototype = import.meta.env.DEV
  ? lazy(() => import("./selection"))
  : null;

const VideoPrototype = import.meta.env.DEV
  ? lazy(() => import("./video"))
  : null;

const ImageQueryPrototype = import.meta.env.DEV
  ? lazy(() => import("./image-query"))
  : null;

// Loaded on demand by the /prototypes route in router.tsx, so the reference
// Library stays out of the main bundle.
export const Route = createLazyRoute("/prototypes")({
  component: function PrototypesPage() {
    const { data } = Route.useSearch();
    if (
      SelectionPrototype &&
      new URLSearchParams(location.search).has("selection")
    )
      return (
        <Suspense>
          <SelectionPrototype />
        </Suspense>
      );
    if (
      ImageQueryPrototype &&
      new URLSearchParams(location.search).has("imageSearch")
    )
      return (
        <Suspense>
          <ImageQueryPrototype />
        </Suspense>
      );
    if (VideoPrototype && new URLSearchParams(location.search).has("video"))
      return (
        <Suspense>
          <VideoPrototype />
        </Suspense>
      );
    return <LibraryPage key={data} data={data} />;
  },
});
