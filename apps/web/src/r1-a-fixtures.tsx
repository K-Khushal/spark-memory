import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import {
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Button,
  trackInputModality,
} from "@spark/ui";
import { PhoneNavigation } from "./shell";
import "./styles.css";

// Dev-only: the shared primitives on a page of their own, so their contracts
// are tested before any screen mounts them (e2e/r1-a.e2e.ts). Served by Vite
// at /r1-a-fixtures.html; the production build only bundles index.html.

const LONG = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}`);

function Sheet({
  name,
  presentation,
}: {
  name: string;
  presentation?: "sheet" | "dialog" | "fullscreen";
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">{name}</Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        {...(presentation && { presentation })}
        className={
          presentation === "sheet" || presentation === "dialog"
            ? "flex max-h-[min(90dvh,48rem)] flex-col"
            : "h-dvh w-screen max-w-none rounded-none"
        }
      >
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>
        <DialogBody data-testid="body">
          <input aria-label="First Field" className="mb-2 w-full" />
          {LONG.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="primary">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fixtures() {
  return (
    <main className="flex flex-col items-start gap-4 p-4">
      <PhoneNavigation current="library" admin />
      <button type="button">Outside</button>
      <Sheet name="Plain Dialog" />
      <Sheet name="Pointer Dialog" presentation="dialog" />
      <Sheet name="Sheet" presentation="sheet" />
      <Sheet name="Full Screen" presentation="fullscreen" />
      <label className="flex items-center gap-2">
        <Checkbox aria-label="Import All Today" />
        Import All Today
      </label>
    </main>
  );
}

function Elsewhere({
  title,
  current,
}: {
  title: string;
  current: "settings" | "admin";
}) {
  return (
    <main className="flex flex-col items-start gap-4 p-4">
      <PhoneNavigation current={current} admin />
      <h1>{title}</h1>
      <Link to="/">Back</Link>
    </main>
  );
}

const rootRoute = createRootRoute({ component: Outlet });
const router = createRouter({
  routeTree: rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: Fixtures,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/settings",
      component: () => <Elsewhere title="Settings Page" current="settings" />,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/admin",
      component: () => <Elsewhere title="Admin Page" current="admin" />,
    }),
  ]),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

trackInputModality();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
