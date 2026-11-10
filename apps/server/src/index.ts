import { Hono } from "hono";
import { routes } from "./routes";

const app = new Hono().basePath("/api").route("/", routes);

/** The API's type, consumed by @spark/api-client for end-to-end type safety. */
export type AppType = typeof app;

export default app;
