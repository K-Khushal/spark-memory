import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { assistantStore } from "@spark/db/assistants";
import { withAuth, requireUser } from "./auth";
import { sameOrigin } from "./origin";
import { digest, opaque, resourceFor } from "./mcp";
import { assistantPage, escapeHtml as esc } from "./assistant-pages";
import type { AppEnv } from "./env";

const redirectUri = z
  .string()
  .max(2048)
  .refine((s) => {
    try {
      const u = new URL(s);
      return (
        !u.hash &&
        !u.username &&
        !u.password &&
        (u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
      );
    } catch {
      return false;
    }
  });
const registration = z.object({
  client_name: z.string().trim().min(1).max(80),
  redirect_uris: z.array(redirectUri).min(1).max(8),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z.array(z.literal("authorization_code")).optional(),
  response_types: z.array(z.literal("code")).optional(),
});
const authorization = z.object({
  client_id: z.string().max(128),
  redirect_uri: redirectUri,
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  resource: z.string().max(2048),
  scope: z.literal("memories:read"),
  state: z.string().max(2048).optional(),
});
const exchange = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  client_id: z.string().max(128),
  redirect_uri: redirectUri,
  resource: z.string().max(2048),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});
const assistantName = z.object({ name: z.string().trim().min(1).max(80) });
const COOKIE = "spark-assistant-consent";

export const assistantAuth = new Hono<AppEnv>()
  .use("*", bodyLimit({ maxSize: 16_384 }))
  .use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Referrer-Policy", "same-origin");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    );
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  })
  .use("*", withAuth)
  .post("/oauth/register", async (c) => {
    const key =
      "mcp-register:" +
      (await digest(
        c.env.BETTER_AUTH_SECRET +
          (c.req.header("cf-connecting-ip") ?? "unknown")
      ));
    if (!(await assistantStore(c.var.db).allowRegistration(key))) {
      c.header("Retry-After", "60");
      return c.json({ error: "rate_limited" }, 429);
    }
    const parsed = registration.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "invalid_client_metadata" }, 400);
    const id = crypto.randomUUID();
    await assistantStore(c.var.db).register({
      id,
      name: parsed.data.client_name,
      redirects: parsed.data.redirect_uris,
    });
    return c.json(
      {
        ...parsed.data,
        client_id: id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      201
    );
  })
  .post("/oauth/token", async (c) => {
    const form = await c.req.parseBody();
    const parsed = exchange.safeParse(form);
    if (!parsed.success || parsed.data.resource !== resourceFor(c.env))
      return c.json({ error: "invalid_grant" }, 400);
    const token = opaque();
    const p = parsed.data;
    const ok = await assistantStore(c.var.db).exchange({
      digest: await digest(p.code),
      clientId: p.client_id,
      redirect: p.redirect_uri,
      challenge: await digest(p.code_verifier),
      resource: p.resource,
      tokenDigest: await digest(token),
      id: crypto.randomUUID(),
    });
    return ok
      ? c.json({
          access_token: token,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "memories:read",
        })
      : c.json({ error: "invalid_grant" }, 400);
  })
  .get("/oauth/authorize", async (c) => {
    const p = authorization.safeParse(c.req.query());
    if (!p.success || p.data.resource !== resourceFor(c.env))
      return c.json({ error: "invalid_request" }, 400);
    const client = await assistantStore(c.var.db).client(p.data.client_id);
    if (!client || !client.redirects.includes(p.data.redirect_uri))
      return c.json({ error: "invalid_client" }, 400);
    const session = await c.var.auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session)
      return c.redirect(
        `/sign-in?returnTo=${encodeURIComponent(new URL(c.req.url).pathname + new URL(c.req.url).search)}`
      );
    // A form POST must carry its same-origin Origin, and its OAuth redirect
    // must be allowed by the page's CSP even when the callback is loopback.
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self' ${new URL(p.data.redirect_uri).origin}; frame-ancestors 'none'; base-uri 'none'`
    );
    const nonce = opaque();
    const binding = await digest(
      JSON.stringify(p.data) + session.user.id + nonce
    );
    await setSignedCookie(c, COOKIE, binding, c.env.BETTER_AUTH_SECRET, {
      httpOnly: true,
      secure: c.env.SPARK_ENV !== "local",
      sameSite: "Lax",
      path: "/api/oauth/authorize",
      maxAge: 600,
    });
    const fields = Object.entries(p.data)
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`)
      .join("");
    return c.html(
      assistantPage(
        "Connect Assistant",
        `<h2 dir="auto">${esc(client.name)}</h2><p>${esc(new URL(p.data.redirect_uri).host)}</p><ul><li>Search And Read Your Library</li><li>Read AI Opt-Out Memories</li></ul><form method="post">${fields}<input type="hidden" name="nonce" value="${nonce}"><nav><button class="primary" name="decision" value="allow">Allow</button><button name="decision" value="deny">Deny</button></nav></form>`
      )
    );
  })
  .post("/oauth/authorize", sameOrigin(), requireUser, async (c) => {
    const form = await c.req.parseBody();
    const p = authorization.safeParse(form);
    if (
      !p.success ||
      p.data.resource !== resourceFor(c.env) ||
      typeof form.nonce !== "string"
    )
      return c.json({ error: "invalid_request" }, 400);
    const store = assistantStore(c.var.db);
    const client = await store.client(p.data.client_id);
    if (!client || !client.redirects.includes(p.data.redirect_uri))
      return c.json({ error: "invalid_client" }, 400);
    const cookie = await getSignedCookie(c, c.env.BETTER_AUTH_SECRET, COOKIE);
    if (
      cookie !==
      (await digest(JSON.stringify(p.data) + c.var.user.id + form.nonce))
    )
      return c.json({ error: "invalid_consent" }, 403);
    deleteCookie(c, COOKIE, { path: "/api/oauth/authorize" });
    const target = new URL(p.data.redirect_uri);
    target.searchParams.set("iss", new URL(resourceFor(c.env)).origin);
    if (p.data.state !== undefined)
      target.searchParams.set("state", p.data.state);
    if (form.decision !== "allow")
      target.searchParams.set("error", "access_denied");
    else {
      const code = opaque();
      await store.grant({
        digest: await digest(code),
        userId: c.var.user.id,
        clientId: p.data.client_id,
        redirect: p.data.redirect_uri,
        challenge: p.data.code_challenge,
        resource: p.data.resource,
      });
      target.searchParams.set("code", code);
    }
    return c.redirect(target.href, 303);
  })
  .use("/assistants/*", sameOrigin(), requireUser)
  .use("/assistants", sameOrigin(), requireUser)
  .get("/assistants", async (c) =>
    c.json({ assistants: await assistantStore(c.var.db).list(c.var.user.id) })
  )
  .post("/assistants", async (c) => {
    const p = assistantName.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "invalid_name" }, 400);
    const token = opaque();
    const assistant = await assistantStore(c.var.db).issue(
      c.var.user.id,
      crypto.randomUUID(),
      p.data.name,
      await digest(token)
    );
    return assistant
      ? c.json({ ...assistant, token, scope: "memories:read" }, 201)
      : c.json({ error: "unauthorized" }, 401);
  })
  .get("/assistants/activity", async (c) =>
    c.json({ activity: await assistantStore(c.var.db).activity(c.var.user.id) })
  )
  .delete("/assistants/:id", async (c) =>
    (await assistantStore(c.var.db).revoke(c.var.user.id, c.req.param("id")))
      ? c.body(null, 204)
      : c.json({ error: "not_found" }, 404)
  );
