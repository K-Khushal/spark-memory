import { createLazyRoute } from "@tanstack/react-router";
import { SignInPage } from "./sign-in-page";

// Loaded on demand by the /sign-in route in router.tsx, so Turnstile and
// the one-time code field stay out of the main bundle.
export const Route = createLazyRoute("/sign-in")({
  component: function SignIn() {
    const options = Route.useLoaderData();
    const { failed, returnTo } = Route.useSearch();
    return (
      <SignInPage options={options} failed={failed === 1} returnTo={returnTo} />
    );
  },
});
