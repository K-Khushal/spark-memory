import { createLazyRoute } from "@tanstack/react-router";
import { SettingsPage } from "./settings-page";

// Loaded on demand by the /settings route in router.tsx, so Sessions and
// account deletion stay out of the main bundle.
export const Route = createLazyRoute("/settings")({
  component: function Settings() {
    const { session, admin } = Route.useRouteContext();
    return <SettingsPage session={session} admin={admin} />;
  },
});
