import { hc } from "hono/client";

export type { InferResponseType } from "hono/client";
import type { AppType } from "@spark/server";

/** Typed client for the Spark API. `baseUrl` is the origin serving `/api/*`. */
export function createApiClient(
  baseUrl: string,
  options?: Parameters<typeof hc>[1]
) {
  return hc<AppType>(baseUrl, options);
}

export type ApiClient = ReturnType<typeof createApiClient>;
