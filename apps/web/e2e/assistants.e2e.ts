import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { signIn } from "./sign-in";

test("connect an assistant, complete MCP handshake, then revoke", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByLabel("Assistant Name").fill("Claude Code");
  await page.getByRole("button", { name: "Create Token" }).click();
  const token = await page.getByLabel("Copy Token Now").inputValue();
  expect(token).toHaveLength(43);
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/json, text/event-stream",
  };
  const initialized = await page.request.post("/api/mcp", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "smoke", version: "1" },
      },
    },
  });
  expect(initialized.ok()).toBe(true);
  expect(await initialized.json()).toMatchObject({
    result: { serverInfo: { name: "Spark" } },
  });
  const listed = await page.request.post("/api/mcp", {
    headers,
    data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
  });
  const { result } = (await listed.json()) as {
    result: { tools: { name: string }[] };
  };
  expect(result.tools.map((t) => t.name).sort()).toEqual([
    "find_similar",
    "get_memory",
    "search_memories",
  ]);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  if (process.env.MCP_SCREENSHOTS === "1") {
    for (const width of [1440, 390])
      for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme });
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, colorScheme);
        await page.screenshot({
          path: `/data/workspace/spark-memory/.git/factory/r/t34-settings-${width}-${colorScheme}.png`,
          fullPage: true,
        });
      }
  }
  await page.reload();
  await expect(page.getByLabel("Copy Token Now")).toHaveCount(0);
  await page.getByRole("button", { name: "Revoke Claude Code" }).click();
  await expect(
    page.getByRole("button", { name: "Revoke Claude Code" })
  ).toHaveCount(0);
  const revoked = await page.request.post("/api/mcp", {
    headers,
    data: { jsonrpc: "2.0", id: 3, method: "tools/list" },
  });
  expect(revoked.status()).toBe(401);
});

test("OAuth consent names the assistant and callback, with a working deny action", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("baseURL is required");
  const origin = new URL(baseURL).origin;
  // Redirects from an intercepted sign-in request bypass page.route in Chromium.
  // A real native-client listener also exercises the loopback callback boundary.
  const listener = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("Authorization Denied");
  });
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("No callback port");
  const callback = `http://127.0.0.1:${address.port}/callback`;
  try {
    const registration = await page.request.post("/api/oauth/register", {
      data: {
        client_name: "Research Assistant / हिंदी",
        redirect_uris: [callback],
      },
    });
    expect(registration.status()).toBe(201);
    const { client_id } = (await registration.json()) as { client_id: string };
    const params = new URLSearchParams({
      client_id,
      redirect_uri: callback,
      resource: `${origin}/api/mcp`,
      response_type: "code",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      scope: "memories:read",
      state: "test-state",
    });
    await signIn(page, undefined, `/api/oauth/authorize?${params}`);
    await expect(
      page.getByRole("heading", { name: "Research Assistant / हिंदी" })
    ).toBeVisible();
    await expect(
      page.getByText(new URL(callback).host, { exact: true })
    ).toBeVisible();
    if (process.env.MCP_SCREENSHOTS === "1") {
      for (const width of [1440, 390])
        for (const colorScheme of ["light", "dark"] as const) {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme });
          await page.screenshot({
            path: `/data/workspace/spark-memory/.git/factory/r/t34-consent-${width}-${colorScheme}.png`,
            fullPage: true,
          });
        }
    }
    await page.getByRole("button", { name: "Deny" }).click();
    await expect(page).toHaveURL(/callback\?.*error=access_denied/);
    await expect(
      page.getByText("Authorization Denied", { exact: true })
    ).toBeVisible();
  } finally {
    await new Promise<void>((resolve, reject) => {
      listener.close((error) => (error ? reject(error) : resolve()));
      listener.closeAllConnections();
    });
  }
});

test("personal access token limit explains how to free a slot", async ({
  page,
}) => {
  await signIn(page);
  for (let i = 0; i < 10; i++) {
    const issued = await page.request.post("/api/assistants", {
      headers: { origin: new URL(page.url()).origin },
      data: { name: `Limited Assistant ${i}` },
    });
    expect(issued.status()).toBe(201);
  }
  await page.goto("/settings");
  await page.getByLabel("Assistant Name").fill("One More Assistant");
  await page.getByRole("button", { name: "Create Token" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "You Have 10 Active Tokens. Revoke One To Create Another."
  );
  await page
    .getByRole("button", { name: "Revoke Limited Assistant 0", exact: true })
    .click();
  await page.getByRole("button", { name: "Create Token" }).click();
  await expect(page.getByLabel("Copy Token Now")).toHaveValue(
    /^[A-Za-z0-9_-]{43}$/
  );
});
