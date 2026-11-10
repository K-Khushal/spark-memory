import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { HomePage } from "./home-page";
import { Picker, PROTOTYPES, type PrototypeId } from "./prototypes/picker";
import { DATA_SETS, type DataSet } from "./prototypes/use-library";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

// Design prototypes (DESIGN.md → Prototypes). Removed once the owner picks one.
const prototypesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prototypes",
  validateSearch: (
    search: Record<string, unknown>
  ): { p: PrototypeId; data: DataSet } => ({
    p:
      PROTOTYPES.find((proto) => proto.id === search.p)?.id ?? PROTOTYPES[0].id,
    data: DATA_SETS.find((d) => d === search.data) ?? "library",
  }),
  component: function PrototypesPage() {
    const { p, data } = prototypesRoute.useSearch();
    return <Picker active={p} data={data} />;
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, prototypesRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
