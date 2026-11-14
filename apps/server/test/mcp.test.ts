import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { sweepAccounts } from "../src/account-jobs";
import { databaseUrl, env, fakeTurnstile, newClient, signedIn } from "./worker";

fakeTurnstile();

async function authorize(
  call: ReturnType<typeof newClient>,
  clientId?: string
) {
  if (!clientId) {
    const registered = await newClient()("/api/oauth/register", {
      method: "POST",
      json: {
        client_name: "Refresh Assistant",
        redirect_uris: ["http://127.0.0.1:9000/callback"],
      },
    });
    expect(registered.status).toBe(201);
    clientId = ((await registered.json()) as { client_id: string }).client_id;
  }
  const verifier = "a".repeat(43);
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  );
  const challenge = btoa(String.fromCharCode(...hash))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "http://127.0.0.1:9000/callback",
    resource: "http://localhost:8787/api/mcp",
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "memories:read",
  });
  const page = await call(`/api/oauth/authorize?${params}`);
  const nonce = /name="nonce" value="([^"]+)"/.exec(await page.text())![1]!;
  const approved = await call("/api/oauth/authorize", {
    method: "POST",
    form: { ...Object.fromEntries(params), nonce, decision: "allow" },
  });
  return {
    grant_type: "authorization_code",
    code: new URL(approved.headers.get("location")!).searchParams.get("code")!,
    client_id: clientId,
    redirect_uri: params.get("redirect_uri")!,
    resource: params.get("resource")!,
    code_verifier: verifier,
  };
}
const tokenRequest = (
  call: ReturnType<typeof newClient>,
  form: Record<string, string>
) => call("/api/oauth/token", { method: "POST", form });
const tokenUse = (call: ReturnType<typeof newClient>, token: string) =>
  call("/api/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    },
    json: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });

describe.skipIf(!databaseUrl)("Connected assistants over HTTP", () => {
  it("discovers authorization and requires a bearer token", async () => {
    const call = newClient();
    const res = await call("/api/mcp", { method: "POST", json: {} });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource"
    );
    const metadata = await call(
      "/.well-known/oauth-protected-resource/api/mcp"
    );
    expect(await metadata.json()).toMatchObject({
      resource: "http://localhost:8787/api/mcp",
      scopes_supported: ["memories:read"],
    });
  });
  it("issues a token once, reads only its owner's originals, logs calls and revokes immediately", async () => {
    const { call } = await signedIn();
    const other = await signedIn();
    const saved = await call("/api/memories", {
      method: "POST",
      json: { body: "untrusted secret original" },
    });
    const memory = (await saved.json()) as { id: string };
    const issued = await call("/api/assistants", {
      method: "POST",
      json: { name: "Test Assistant" },
    });
    expect(issued.status).toBe(201);
    expect(issued.headers.get("cache-control")).toContain("no-store");
    expect(issued.headers.get("pragma")).toBe("no-cache");
    const token = (await issued.json()) as { id: string; token: string };
    const rpc = (name: string, args: Record<string, unknown>) =>
      call("/api/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.token}`,
          accept: "application/json, text/event-stream",
        },
        json: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        },
      });
    const answer = await rpc("get_memory", { id: memory.id });
    expect(answer.status).toBe(200);
    const body = await answer.text();
    expect(body).toContain("untrusted secret original");
    expect(body).toContain("UNTRUSTED");
    const listed = await call("/api/assistants");
    expect(await listed.text()).not.toContain(token.token);
    expect(
      (await other.call(`/api/assistants/${token.id}`, { method: "DELETE" }))
        .status
    ).toBe(404);
    const log = await call("/api/assistants/activity");
    expect(await log.json()).toMatchObject({
      activity: [
        { assistant: "Test Assistant", tool: "get_memory", resultCount: 1 },
      ],
    });
    expect(
      (await call(`/api/assistants/${token.id}`, { method: "DELETE" })).status
    ).toBe(204);
    expect((await rpc("get_memory", { id: memory.id })).status).toBe(401);
  });
});

// OAuth is exercised through authorization-server endpoints, never private helpers.
describe.skipIf(!databaseUrl)("OAuth authorization code flow", () => {
  it("requires sign-in and consent, binds redirect/resource/PKCE and consumes a code once under a race", async () => {
    const anonymous = newClient();
    const registered = await anonymous("/api/oauth/register", {
      method: "POST",
      json: {
        client_name: "Claude <Assistant>",
        redirect_uris: [
          "http://localhost:9000/callback",
          "http://127.0.0.1:9000/callback",
          "http://[::1]:9000/callback",
        ],
      },
    });
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as { client_id: string };
    const verifier = "a".repeat(43);
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    );
    const challenge = btoa(String.fromCharCode(...hash))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "http://localhost:9000/callback",
      resource: "http://localhost:8787/api/mcp",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "memories:read",
      state: "saved-state",
    });
    const path = `/api/oauth/authorize?${params}`;
    const unauth = await anonymous(path);
    expect(unauth.status).toBe(302);
    expect(unauth.headers.get("location")).toContain("/sign-in?returnTo=");
    const { call } = await signedIn();
    expect((await call(path.replace("S256", "plain"))).status).toBe(400);
    expect((await call(path.replace("9000", "9999"))).status).toBe(400);
    // Native clients bind an ephemeral loopback port on each sign-in
    // (RFC 8252 §7.3). Host, scheme and path still have to match.
    for (const redirect of [
      "http://127.0.0.1:9999/callback",
      "http://[::1]:9998/callback",
    ]) {
      const native = new URLSearchParams(params);
      native.set("redirect_uri", redirect);
      expect((await call(`/api/oauth/authorize?${native}`)).status).toBe(200);
    }
    for (const redirect of [
      "http://127.0.0.1:9999/other",
      "https://127.0.0.1:9999/callback",
    ]) {
      const invalid = new URLSearchParams(params);
      invalid.set("redirect_uri", redirect);
      expect((await call(`/api/oauth/authorize?${invalid}`)).status).toBe(400);
    }
    const nativeParams = new URLSearchParams(params);
    nativeParams.set("redirect_uri", "http://127.0.0.1:9999/callback");
    const consent = await call(`/api/oauth/authorize?${nativeParams}`);
    expect(consent.status).toBe(200);
    const html = await consent.text();
    expect(html).toContain("Claude &lt;Assistant&gt;");
    const nonce = /name="nonce" value="([^"]+)"/.exec(html)![1]!;
    const form = Object.fromEntries(nativeParams);
    const refused = await call("/api/oauth/authorize", {
      method: "POST",
      form: { ...form, nonce: "wrong", decision: "allow" },
    });
    expect(refused.status).toBe(403);
    const approval = await call("/api/oauth/authorize", {
      method: "POST",
      form: { ...form, nonce, decision: "allow" },
    });
    expect(approval.status).toBe(303);
    const redirect = new URL(approval.headers.get("location")!);
    expect(redirect.searchParams.get("state")).toBe("saved-state");
    expect(redirect.searchParams.get("iss")).toBe("http://localhost:8787");
    const exchange = {
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      client_id: client.client_id,
      redirect_uri: form.redirect_uri!,
      resource: form.resource!,
      code_verifier: verifier,
    };
    exchange.code = (await authorize(call, client.client_id)).code;
    exchange.redirect_uri = "http://127.0.0.1:9000/callback";
    expect(
      (
        await anonymous("/api/oauth/token", {
          method: "POST",
          form: { ...exchange, code_verifier: "b".repeat(43) },
        })
      ).status
    ).toBe(400);
    exchange.code = (await authorize(call, client.client_id)).code;
    expect(
      (
        await anonymous("/api/oauth/token", {
          method: "POST",
          form: { ...exchange, resource: "https://other.example/mcp" },
        })
      ).status
    ).toBe(400);
    exchange.code = (await authorize(call, client.client_id)).code;
    expect(
      (
        await anonymous("/api/oauth/token", {
          method: "POST",
          form: { ...exchange, redirect_uri: "http://127.0.0.1:9999/callback" },
        })
      ).status
    ).toBe(400);
    exchange.code = (await authorize(call, client.client_id)).code;
    const responses = await Promise.all(
      [1, 2].map(() =>
        anonymous("/api/oauth/token", { method: "POST", form: exchange })
      )
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    const success = responses.find((r) => r.status === 200)!;
    const token = (await success.json()) as { access_token: string };
    expect(
      (
        await anonymous("/api/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token.access_token}`,
            accept: "application/json, text/event-stream",
          },
          json: {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-11-25",
              capabilities: {},
              clientInfo: { name: "test", version: "1" },
            },
          },
        })
      ).status
    ).toBe(401);
  });
});

describe.skipIf(!databaseUrl)("read-only Library boundary", () => {
  it("keeps owner isolation and match evidence, excludes samples, and allows an explicitly connected assistant to read AI opt-out", async () => {
    const { call } = await signedIn();
    const other = await signedIn();
    const create = async (client: typeof call, body: string) =>
      (await (
        await client("/api/memories", { method: "POST", json: { body } })
      ).json()) as { id: string };
    const mine = await create(call, "cardamom sentinel original");
    const theirs = await create(other.call, "cardamom other secret");
    await call("/api/onboarding/start", { method: "POST" });
    const token = (await (
      await call("/api/assistants", {
        method: "POST",
        json: { name: "Boundary Test" },
      })
    ).json()) as { token: string };
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const res = await call("/api/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.token}`,
          accept: "application/json, text/event-stream",
        },
        json: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        },
      });
      const body = (await res.json()) as {
        result: { content: { text: string }[] };
      };
      return JSON.parse(
        body.result.content[0]!.text.split("\n").slice(1, -1).join("\n")
      ) as {
        id: string;
        sample: boolean;
        match: string;
        matched: string[];
        body: string;
      }[];
    };
    expect(await rpc("get_memory", { id: theirs.id })).toEqual([]);
    const hits = await rpc("search_memories", { query: "cardamom" });
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: mine.id, match: "direct" }),
      ])
    );
    expect(
      hits.every((m) => !m.sample && ["direct", "related"].includes(m.match))
    ).toBe(true);
    expect(JSON.stringify(hits)).not.toContain("other secret");
    expect(hits[0]!.matched.length).toBeGreaterThan(0);
    expect(
      (
        await call(`/api/memories/${mine.id}/ai-opt-out`, {
          method: "PUT",
          json: { aiOptOut: true },
        })
      ).status
    ).toBe(200);
    expect(await rpc("get_memory", { id: mine.id })).toEqual([
      expect.objectContaining({
        body: "cardamom sentinel original",
        aiOptOut: true,
      }),
    ]);
    expect(
      (await rpc("search_memories", { query: "Spark" })).every((m) => !m.sample)
    ).toBe(true);
  });
  it("revokes every token immediately when the owner requests deletion", async () => {
    const { call, address } = await signedIn();
    const oauthCode = await authorize(call);
    const oauth = (await (await tokenRequest(call, oauthCode)).json()) as {
      access_token: string;
      refresh_token: string;
    };
    const issued = (await (
      await call("/api/assistants", {
        method: "POST",
        json: { name: "Delete Test" },
      })
    ).json()) as { token: string };
    expect(
      (
        await call("/api/account", {
          method: "DELETE",
          json: { email: address },
        })
      ).status
    ).toBe(204);
    const res = await newClient()("/api/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${issued.token}` },
      json: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(res.status).toBe(401);
    expect((await tokenUse(newClient(), oauth.access_token)).status).toBe(401);
    expect(
      (
        await tokenRequest(newClient(), {
          grant_type: "refresh_token",
          refresh_token: oauth.refresh_token,
          client_id: oauthCode.client_id,
          resource: oauthCode.resource,
        })
      ).status
    ).toBe(400);
  });
  it("rate limits a token atomically and logs failed calls without their arguments", async () => {
    const { call } = await signedIn();
    const issued = (await (
      await call("/api/assistants", {
        method: "POST",
        json: { name: "Rate Test" },
      })
    ).json()) as { token: string };
    const invoke = () =>
      call("/api/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${issued.token}`,
          accept: "application/json, text/event-stream",
        },
        json: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "not_a_tool",
            arguments: { query: "NEVER_LOG_THIS_QUERY" },
          },
        },
      });
    const statuses: number[] = [];
    for (let i = 0; i < 61; i += 5)
      statuses.push(
        ...(await Promise.all(
          Array.from(
            { length: Math.min(5, 61 - i) },
            async () => (await invoke()).status
          )
        ))
      );
    expect(statuses.filter((s) => s === 200)).toHaveLength(60);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
    const activity = await (await call("/api/assistants/activity")).text();
    expect(activity).toContain('"tool":"unknown"');
    expect(activity).not.toContain("NEVER_LOG_THIS_QUERY");
    expect(activity).not.toContain(issued.token);
  });
});

describe.skipIf(!databaseUrl)("OAuth credential lifecycle", () => {
  it("burns a code on the first attempt and revokes issued credentials when it is replayed", async () => {
    const { call } = await signedIn();
    const bad = await authorize(call);
    expect(
      (await tokenRequest(call, { ...bad, code_verifier: "b".repeat(43) }))
        .status
    ).toBe(400);
    expect((await tokenRequest(call, bad)).status).toBe(400);
    const valid = await authorize(call, bad.client_id);
    const response = await tokenRequest(call, valid);
    expect(response.status).toBe(200);
    const token = (await response.json()) as { access_token: string };
    expect((await tokenUse(call, token.access_token)).status).toBe(200);
    expect((await tokenRequest(call, valid)).status).toBe(400);
    expect((await tokenUse(call, token.access_token)).status).toBe(401);
  });
});

describe.skipIf(!databaseUrl)("rotating OAuth refresh families", () => {
  it("rotates client-bound refresh tokens, keeps one client row and revokes the family on reuse", async () => {
    const { call } = await signedIn();
    const code = await authorize(call);
    const issued = await tokenRequest(call, code);
    expect(issued.status).toBe(200);
    const first = (await issued.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(first.refresh_token).toHaveLength(43);
    const request = {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: code.client_id,
      resource: code.resource,
    };
    expect(
      (await tokenRequest(call, { ...request, client_id: "wrong-client" }))
        .status
    ).toBe(400);
    expect(
      (
        await tokenRequest(call, {
          ...request,
          resource: "https://other.example/mcp",
        })
      ).status
    ).toBe(400);
    const renewed = await tokenRequest(call, request);
    expect(renewed.status).toBe(200);
    const second = (await renewed.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(second.refresh_token).toHaveLength(43);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    await call("/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${second.access_token}`,
        accept: "application/json, text/event-stream",
      },
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_memory", arguments: { id: crypto.randomUUID() } },
      },
    });
    expect(await (await call("/api/assistants/activity")).json()).toMatchObject(
      {
        activity: [
          {
            clientId: code.client_id,
            assistant: "Refresh Assistant",
            tool: "get_memory",
            resultCount: 0,
          },
        ],
      }
    );
    expect((await tokenUse(call, second.access_token)).status).toBe(200);
    const listed = (await (await call("/api/assistants")).json()) as {
      assistants: { id: string; clientId: string | null }[];
    };
    expect(listed.assistants).toHaveLength(1);
    expect(listed.assistants[0]!.clientId).toBe(code.client_id);
    expect(JSON.stringify(listed)).not.toContain(first.refresh_token);
    expect((await tokenRequest(call, request)).status).toBe(400);
    expect((await tokenUse(call, first.access_token)).status).toBe(401);
    expect((await tokenUse(call, second.access_token)).status).toBe(401);
    expect(
      (
        await tokenRequest(call, {
          ...request,
          refresh_token: second.refresh_token,
        })
      ).status
    ).toBe(400);
    const reconnect = await tokenRequest(
      call,
      await authorize(call, code.client_id)
    );
    const independent = (await reconnect.json()) as {
      access_token: string;
      refresh_token: string;
    };
    // An old receipt cannot revoke a replacement grant for the same client.
    expect((await tokenRequest(call, request)).status).toBe(400);
    expect((await tokenUse(call, independent.access_token)).status).toBe(200);
    const third = (await (
      await tokenRequest(call, await authorize(call, code.client_id))
    ).json()) as { access_token: string; refresh_token: string };
    expect(
      (
        await call(`/api/assistants/${listed.assistants[0]!.id}`, {
          method: "DELETE",
        })
      ).status
    ).toBe(204);
    expect((await tokenUse(call, independent.access_token)).status).toBe(401);
    expect((await tokenUse(call, third.access_token)).status).toBe(401);
    expect(
      (
        await tokenRequest(call, {
          ...request,
          refresh_token: third.refresh_token,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await tokenRequest(call, {
          ...request,
          refresh_token: independent.refresh_token,
        })
      ).status
    ).toBe(400);
  });
});

describe.skipIf(!databaseUrl)("Connected assistant limits", () => {
  it("caps personal access tokens at ten under concurrent issuance and releases a slot on revoke", async () => {
    const { call } = await signedIn();
    const issue = () =>
      call("/api/assistants", {
        method: "POST",
        json: { name: "Limited Assistant" },
      });
    const responses = await Promise.all(Array.from({ length: 12 }, issue));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(10);
    const refused = responses.filter((r) => r.status === 409);
    expect(refused).toHaveLength(2);
    expect(await refused[0]!.json()).toMatchObject({
      error: "assistant_limit",
      error_description: "Token Limit Reached",
    });
    const first = (await responses.find((r) => r.status === 201)!.json()) as {
      id: string;
    };
    await call(`/api/assistants/${first.id}`, { method: "DELETE" });
    expect((await issue()).status).toBe(201);
  });
  it("allows twenty-five reauthorizations of one client and revokes earlier credentials", async () => {
    const { call } = await signedIn();
    const code = await authorize(call);
    let prior = (await (await tokenRequest(call, code)).json()) as {
      access_token: string;
      refresh_token: string;
    };
    for (let i = 0; i < 25; i++) {
      const response = await tokenRequest(
        call,
        await authorize(call, code.client_id)
      );
      expect(response.status).toBe(200);
      const current = (await response.json()) as typeof prior;
      expect((await tokenUse(call, prior.access_token)).status).toBe(401);
      expect(
        (
          await tokenRequest(call, {
            grant_type: "refresh_token",
            client_id: code.client_id,
            refresh_token: prior.refresh_token,
          })
        ).status
      ).toBe(400);
      expect((await tokenUse(call, current.access_token)).status).toBe(200);
      prior = current;
    }
    const listed = (await (await call("/api/assistants")).json()) as {
      assistants: { clientId: string }[];
    };
    expect(listed.assistants).toEqual([
      expect.objectContaining({ clientId: code.client_id }),
    ]);
  });
  it("caps distinct OAuth clients at twenty under a race and permits reconnecting at the cap", async () => {
    const { call } = await signedIn();
    const code = await authorize(call);
    expect((await tokenRequest(call, code)).status).toBe(200);
    for (let i = 1; i < 19; i++)
      expect((await tokenRequest(call, await authorize(call))).status).toBe(
        200
      );
    const lastCodes = [await authorize(call), await authorize(call)];
    const responses = await Promise.all(
      lastCodes.map((p) => tokenRequest(call, p))
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await responses.find((r) => r.status === 400)!.json()).toMatchObject(
      { error: "invalid_grant", error_description: "Assistant Limit Reached" }
    );
    expect(
      (await tokenRequest(call, await authorize(call, code.client_id))).status
    ).toBe(200);
    const listed = (await (await call("/api/assistants")).json()) as {
      assistants: { id: string }[];
    };
    expect(listed.assistants).toHaveLength(20);
    await call(`/api/assistants/${listed.assistants[0]!.id}`, {
      method: "DELETE",
    });
    expect((await tokenRequest(call, await authorize(call))).status).toBe(200);
  });
  it("shares SEARCH_LIMITER with dashboard search across all of a person's tokens", async () => {
    const { call } = await signedIn();
    const credentials = [];
    for (let i = 0; i < 2; i++)
      credentials.push(
        (await (
          await call("/api/assistants", {
            method: "POST",
            json: { name: "Rate Assistant" },
          })
        ).json()) as { token: string }
      );
    const keys: string[] = [];
    const bindings = env({
      SEARCH_LIMITER: {
        limit: async ({ key }) => {
          keys.push(key);
          return { success: keys.length === 1 };
        },
      },
    });
    for (let i = 0; i < 2; i++) {
      const response = await call(
        "/api/mcp",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${credentials[i]!.token}`,
            accept: "application/json, text/event-stream",
          },
          json: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "search_memories",
              arguments: { query: "cardamom" },
            },
          },
        },
        bindings
      );
      expect(response.status).toBe(i === 0 ? 200 : 429);
      if (i === 1) expect(response.headers.get("retry-after")).toBe("60");
    }
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    const dashboardKeys: string[] = [];
    await call(
      "/api/search",
      { method: "POST", json: { q: "cardamom", mode: "full" } },
      env({
        SEARCH_LIMITER: {
          limit: async ({ key }) => {
            dashboardKeys.push(key);
            return { success: false };
          },
        },
      })
    );
    expect(dashboardKeys).toEqual([keys[0]]);
  });
});

describe.skipIf(!databaseUrl)("OAuth inactivity and concurrency", () => {
  it("slides the ninety-day inactivity deadline, excludes expired grants and refuses their access and refresh tokens", async () => {
    const { call } = await signedIn();
    const code = await authorize(call);
    const first = (await (await tokenRequest(call, code)).json()) as {
      access_token: string;
      refresh_token: string;
    };
    const user = (await (await call("/api/me")).json()) as { id: string };
    const fixture = new Client({ connectionString: databaseUrl });
    await fixture.connect();
    try {
      await fixture.query(
        "update assistant_grant set expires_at = now() + interval '1 day' where user_id = $1",
        [user.id]
      );
      const form = {
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
        client_id: code.client_id,
      };
      const response = await tokenRequest(call, form);
      expect(response.status).toBe(200);
      const renewed = (await response.json()) as {
        access_token: string;
        refresh_token: string;
      };
      const list = (await (await call("/api/assistants")).json()) as {
        assistants: { expiresAt: string }[];
      };
      expect(new Date(list.assistants[0]!.expiresAt).getTime()).toBeGreaterThan(
        Date.now() + 89 * 86400000
      );
      expect(new Date(list.assistants[0]!.expiresAt).getTime()).toBeLessThan(
        Date.now() + 91 * 86400000
      );
      await fixture.query(
        "update assistant_grant set expires_at = now() - interval '1 second' where user_id = $1",
        [user.id]
      );
      expect(await (await call("/api/assistants")).json()).toMatchObject({
        assistants: [],
      });
      expect((await tokenUse(call, renewed.access_token)).status).toBe(401);
      expect(
        (
          await tokenRequest(call, {
            ...form,
            refresh_token: renewed.refresh_token,
          })
        ).status
      ).toBe(400);
    } finally {
      await fixture.end();
    }
  });
  it("treats a parallel refresh as reuse and revokes every credential in that family", async () => {
    const { call } = await signedIn();
    const code = await authorize(call);
    const issued = (await (await tokenRequest(call, code)).json()) as {
      access_token: string;
      refresh_token: string;
    };
    const form = {
      grant_type: "refresh_token",
      refresh_token: issued.refresh_token,
      client_id: code.client_id,
      resource: code.resource,
    };
    const responses = await Promise.all([
      tokenRequest(call, form),
      tokenRequest(call, form),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    const rotated = (await responses.find((r) => r.status === 200)!.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect((await tokenUse(call, issued.access_token)).status).toBe(401);
    expect((await tokenUse(call, rotated.access_token)).status).toBe(401);
    expect(
      (
        await tokenRequest(call, {
          ...form,
          refresh_token: rotated.refresh_token,
        })
      ).status
    ).toBe(400);
  });
});

describe.skipIf(!databaseUrl)("credential replay receipt retention", () => {
  it("sweeps spent refresh tokens after a minute and code receipts after a day while preserving grace-period reuse detection", async () => {
    const { call } = await signedIn();
    const code = await authorize(call);
    const first = (await (await tokenRequest(call, code)).json()) as {
      access_token: string;
      refresh_token: string;
    };
    const renewal = {
      grant_type: "refresh_token",
      client_id: code.client_id,
      refresh_token: first.refresh_token,
    };
    const second = (await (
      await tokenRequest(call, renewal)
    ).json()) as typeof first;
    const user = (await (await call("/api/me")).json()) as { id: string };
    const fixture = new Client({ connectionString: databaseUrl });
    await fixture.connect();
    try {
      await fixture.query(
        "update assistant_refresh r set used_at = now() - interval '2 minutes' from assistant_grant g where r.grant_id = g.id and g.user_id = $1 and r.used",
        [user.id]
      );
      await fixture.query(
        "update assistant_code_use set expires_at = now() - interval '1 second' where user_id = $1",
        [user.id]
      );
      await sweepAccounts(env());
      expect((await tokenRequest(call, renewal)).status).toBe(400);
      expect((await tokenUse(call, second.access_token)).status).toBe(200);
      expect((await tokenRequest(call, code)).status).toBe(400);
      expect((await tokenUse(call, second.access_token)).status).toBe(200);
      const recent = { ...renewal, refresh_token: second.refresh_token };
      const third = (await (
        await tokenRequest(call, recent)
      ).json()) as typeof first;
      await fixture.query(
        "update assistant_refresh r set used_at = now() - interval '30 seconds' from assistant_grant g where r.grant_id = g.id and g.user_id = $1 and r.used",
        [user.id]
      );
      await sweepAccounts(env());
      expect((await tokenUse(call, third.access_token)).status).toBe(200);
      expect((await tokenRequest(call, recent)).status).toBe(400);
      expect((await tokenUse(call, third.access_token)).status).toBe(401);
    } finally {
      await fixture.end();
    }
  });
});

type Row = {
  id: string;
  tool: string;
  occurredAt: string;
  resultCount: number;
  memory: { id: string; title: string | null } | null;
};
type Page = { activity: Row[]; next: string | null };
type Listed = {
  assistants: { id: string; name: string; lastActiveAt: string | null }[];
};

describe.skipIf(!databaseUrl)("Connected assistants activity", () => {
  const rpc = (
    call: ReturnType<typeof newClient>,
    token: string,
    name: string,
    args: Record<string, unknown>
  ) =>
    call("/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
      },
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      },
    });
  const connect = async (call: ReturnType<typeof newClient>, name: string) => {
    const issued = (await (
      await call("/api/assistants", { method: "POST", json: { name } })
    ).json()) as { id: string; token: string };
    return issued;
  };
  const pageOf = async (
    call: ReturnType<typeof newClient>,
    query: Record<string, string>
  ) =>
    (await (
      await call(`/api/assistants/activity?${new URLSearchParams(query)}`)
    ).json()) as Page;

  it("shows last activity, pages one assistant's log newest first and names the opened Memory without any search text", async () => {
    const { call } = await signedIn();
    const saved = (await (
      await call("/api/memories", {
        method: "POST",
        json: { body: "plain body" },
      })
    ).json()) as { id: string };
    await call(`/api/memories/${saved.id}`, {
      method: "PATCH",
      json: { title: "Bread Notes" },
    });
    const claude = await connect(call, "Claude Code");
    const codex = await connect(call, "Codex");
    expect(
      ((await (await call("/api/assistants")).json()) as Listed).assistants.map(
        (a) => a.lastActiveAt
      )
    ).toEqual([null, null]);

    await rpc(call, claude.token, "search_memories", {
      query: "NEVER_SHOW_THIS_QUERY",
    });
    await rpc(call, claude.token, "get_memory", { id: saved.id });
    await rpc(call, claude.token, "get_memory", { id: crypto.randomUUID() });
    await rpc(call, codex.token, "search_memories", { query: "other" });

    const all = await pageOf(call, { assistant: claude.id });
    expect(all.next).toBeNull();
    expect(all.activity.map((r) => [r.tool, r.resultCount, r.memory])).toEqual([
      ["get_memory", 0, null],
      ["get_memory", 1, { id: saved.id, title: "Bread Notes" }],
      ["search_memories", expect.any(Number), null],
    ]);
    expect(JSON.stringify(all)).not.toContain("NEVER_SHOW_THIS_QUERY");

    const first = await pageOf(call, { assistant: claude.id, limit: "2" });
    expect(first.activity).toHaveLength(2);
    expect(first.next).toEqual(expect.any(String));
    const second = await pageOf(call, {
      assistant: claude.id,
      limit: "2",
      before: first.next!,
    });
    expect(second.activity.map((r) => r.id)).toEqual([all.activity[2]!.id]);
    expect(second.next).toBeNull();

    const listed = (await (await call("/api/assistants")).json()) as Listed;
    for (const a of listed.assistants)
      expect(Date.parse(a.lastActiveAt!)).not.toBeNaN();

    // Deleting the Memory blanks the row; the visit itself stays.
    await call(`/api/memories/${saved.id}`, { method: "DELETE" });
    expect(
      (await pageOf(call, { assistant: claude.id })).activity[1]
    ).toMatchObject({ tool: "get_memory", resultCount: 1, memory: null });
  });

  it("scopes the log to its owner and one assistant, and attributes OAuth clients by client row", async () => {
    const { call } = await signedIn();
    const other = await signedIn();
    const mine = await connect(call, "Mine");
    const theirs = await connect(other.call, "Theirs");
    await rpc(call, mine.token, "search_memories", { query: "mine" });
    await rpc(other.call, theirs.token, "search_memories", { query: "theirs" });

    // Another person's assistant id reads nothing, and a bad cursor is refused.
    expect(await pageOf(call, { assistant: theirs.id })).toEqual({
      activity: [],
      next: null,
    });
    expect((await pageOf(call, {})).activity).toHaveLength(1);
    const refused = await call("/api/assistants/activity?before=nope");
    expect(refused.status).toBe(400);

    const code = await authorize(call);
    const issued = (await (await tokenRequest(call, code)).json()) as {
      access_token: string;
    };
    await rpc(call, issued.access_token, "search_memories", { query: "x" });
    const clientRow = (
      (await (await call("/api/assistants")).json()) as Listed
    ).assistants.find((a) => a.id.startsWith("client:"))!;
    expect(clientRow.lastActiveAt).not.toBeNull();
    const log = await pageOf(call, { assistant: clientRow.id });
    expect(log.activity.map((r) => r.tool)).toEqual(["search_memories"]);
    expect(
      (await pageOf(other.call, { assistant: clientRow.id })).activity
    ).toEqual([]);
  });
});

// Registration is anonymous, so what it stores is bounded (SEC-1).
describe.skipIf(!databaseUrl)("anonymous OAuth registration limits", () => {
  const register = (redirects: string[], call = newClient()) =>
    call("/api/oauth/register", {
      method: "POST",
      json: { client_name: "Bounded", redirect_uris: redirects },
    });

  it("accepts up to four short redirect URIs and refuses more or longer ones", async () => {
    const uris = (n: number) =>
      Array.from({ length: n }, (_, i) => `https://example.test/cb${i}`);
    expect((await register(uris(4))).status).toBe(201);
    expect((await register(uris(5))).status).toBe(400);
    const long = `https://example.test/${"a".repeat(512 - "https://example.test/".length)}`;
    expect(long).toHaveLength(512);
    expect((await register([long])).status).toBe(201);
    expect((await register([`${long}a`])).status).toBe(400);
  });

  it("answers 429 with Retry-After while the unclaimed registrations fill the global cap", async () => {
    const fixture = new Client({ connectionString: databaseUrl });
    await fixture.connect();
    const filler = `fill-${crypto.randomUUID()}`;
    try {
      await fixture.query(
        `insert into assistant_client(id, name, redirects)
         select $1 || g, 'filler', '[]'::jsonb from generate_series(1, 1000) g`,
        [filler]
      );
      const refused = await register(["https://example.test/cb"]);
      expect(refused.status).toBe(429);
      expect(refused.headers.get("retry-after")).toBe("3600");
      expect(await refused.json()).toEqual({ error: "rate_limited" });
      // A claimed integration is not one of them.
      await fixture.query(
        `update assistant_client set claimed_at = now() where id like $1`,
        [`${filler}%`]
      );
      expect((await register(["https://example.test/cb"])).status).toBe(201);
    } finally {
      await fixture.query(`delete from assistant_client where id like $1`, [
        `${filler}%`,
      ]);
      await fixture.end();
    }
  });
});
