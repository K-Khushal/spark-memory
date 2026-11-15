import { Hono } from "hono";
import { OnboardingUpdate, SearchActivation } from "@spark/core";
import { openOnboarding } from "@spark/db";
import type { AppEnv } from "./env";
import { requireUser, withAuth } from "./auth";
import { json, noStore } from "./memories";
import { sameOrigin } from "./origin";
import { rateLimited } from "./rate-limit";

export const onboarding = new Hono<AppEnv>()
  .use("/onboarding", sameOrigin(), withAuth, requireUser, noStore)
  .use("/onboarding/*", sameOrigin(), withAuth, requireUser, noStore)
  .get("/onboarding", async (c) =>
    c.json(await openOnboarding(c.var.db, c.var.user.id).read())
  )
  .post("/onboarding/start", rateLimited("EDIT_LIMITER"), async (c) =>
    c.json(await openOnboarding(c.var.db, c.var.user.id).start())
  )
  .put(
    "/onboarding",
    rateLimited("EDIT_LIMITER"),
    json(OnboardingUpdate),
    async (c) => {
      const { step, paused } = c.req.valid("json");
      return c.json(
        await openOnboarding(c.var.db, c.var.user.id).update(step, paused)
      );
    }
  )
  .delete("/onboarding/samples", rateLimited("EDIT_LIMITER"), async (c) => {
    await openOnboarding(c.var.db, c.var.user.id).removeSamples();
    return c.body(null, 204);
  })
  .post(
    "/onboarding/activation",
    rateLimited("EDIT_LIMITER"),
    json(SearchActivation),
    async (c) => {
      const { memoryId } = c.req.valid("json");
      const recorded = await openOnboarding(c.var.db, c.var.user.id).activate(
        memoryId
      );
      return c.json({ recorded });
    }
  );
