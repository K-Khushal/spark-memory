# Connected assistants

Spark exposes a read-only remote MCP endpoint at `https://YOUR_SPARK_HOST/api/mcp`. It offers `search_memories`, `get_memory` and `find_similar`. Tools return originals and Preserved text, Source links, why-chips and Direct/Related matches. Saved text is untrusted data, never instructions.

## Connect with OAuth

Use your deployed Spark HTTPS origin, replacing `YOUR_SPARK_HOST` below. The assistant discovers the authorization server, registers its redirect and opens Spark sign-in. The consent screen names the assistant. Approve only the assistant you meant to connect. Access expires after one hour. The client renews it with a rotating refresh token, which expires after 90 days without use. Reusing a spent refresh token during the retention grace period revokes its whole token family and requires sign-in again.

[Claude Code](https://code.claude.com/docs/en/mcp):

```sh
claude mcp add --transport http spark https://YOUR_SPARK_HOST/api/mcp
```

Open Claude Code, run `/mcp`, select Spark and authenticate.

[Codex](https://learn.chatgpt.com/docs/extend/mcp):

```sh
codex mcp add spark --url https://YOUR_SPARK_HOST/api/mcp
codex mcp login spark
```

Start a session and ask it to find a Memory you saved. Inspect the Source before relying on it. In Spark Settings → Connected Assistants, Revoke ends every access and refresh token held by that client on its next request. Settings and exports show one row per client, excluding expired grants.

## Connect with a personal access token

In Settings → Connected Assistants, enter the assistant name and choose Create Token. Copy the token before choosing Done: Spark never shows it again. It expires after 90 days and can be revoked at any time. Each person may hold up to 10 active personal access tokens and 20 connected OAuth clients; revoke an assistant to free a slot. Reauthorizing a client replaces its earlier grant and credentials without consuming another slot. It can read your Library, including AI opt-out Memories; it cannot Capture, edit or delete.

For Codex, provide the token through an environment variable rather than putting it in configuration:

```sh
read -rs SPARK_MCP_TOKEN
export SPARK_MCP_TOKEN
codex mcp add spark --url https://YOUR_SPARK_HOST/api/mcp --bearer-token-env-var SPARK_MCP_TOKEN
```

Claude Code supports a custom Authorization header (`claude mcp add --transport http ... --header 'Authorization: Bearer ...'`). Prefer OAuth there so a long-lived credential does not enter shell history or process arguments. For other clients, configure `Authorization: Bearer TOKEN` using the client's secret storage.

## Verify locally

Use a dedicated Postgres database with migrations applied. Start `wrangler dev` and Vite using the repo's normal development commands; the MCP resource origin is the configured `BETTER_AUTH_URL` (the dashboard origin). Create a token in Settings. From the repo root:

```sh
read -rs MCP_TOKEN
export MCP_TOKEN
MCP_URL=http://localhost:5173/api/mcp node apps/server/scripts/mcp-handshake.mjs
unset MCP_TOKEN
```

The SDK client initializes, discovers all three tools and calls `search_memories`. Output includes counts and success only. The script has a 30-second network timeout. Revoke the test token afterward. Automated auth, owner isolation, revocation, activity and protocol tests run with `DATABASE_URL=... pnpm --filter @spark/server exec vitest run test/mcp.test.ts`. The Playwright smoke test creates a token through Settings and revokes it after an HTTP handshake. Its third-party Turnstile widget uses the public test token; Spark sign-in and authorization still run on the real local server.

## Owner checks before launch

Real Claude Code and Codex checks need your own signed-in clients; the SDK handshake does not substitute for them. In each client:

1. Complete OAuth sign-in and check the assistant name and callback host on consent.
2. Find a known Memory and verify its `match`, why-chip, original text and Source. Read it by id and try More Like This.
3. Confirm Sample Memories are absent from searches. Read an AI opt-out Memory you intentionally chose to share.
4. Revoke the assistant in Settings; confirm the next tool request asks for authorization. Confirm access renews without consent, then verify refresh reuse or 90 days of inactivity requires reconnection.
5. Repeat with a personal access token where supported, and remove it afterward.

Already returned data cannot be recalled. Original-file URLs already issued retain the existing download expiry (at most two hours). Activity records omit queries and Memory content; account deletion removes all credentials and activity. Library export includes `connected-assistants.json` with metadata only.
