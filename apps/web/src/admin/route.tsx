import { createLazyRoute } from "@tanstack/react-router";
import { AdminPage } from "./admin-page";

// Loaded on demand by the /admin route in router.tsx, so the admin tables
// stay out of the main bundle.
export const Route = createLazyRoute("/admin")({
  component: function Admin() {
    const { session } = Route.useRouteContext();
    return <AdminPage session={session} />;
  },
});
