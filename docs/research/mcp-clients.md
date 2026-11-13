# Connecting Claude and Codex

Researched 13 November 2026 for #35. The Connection Guide in Settings (`apps/web/src/settings/connection-guide.tsx`) repeats these steps. Recheck them before changing the guide.

## Claude Code

Source: [Claude Code MCP docs](https://code.claude.com/docs/en/mcp).

- Add a remote HTTP server: `claude mcp add --transport http <name> <url>`.
- Sign in with OAuth: run `/mcp` in Claude Code, then follow the steps in the browser.
- A fixed bearer token needs `--header "Authorization: Bearer <token>"` after the URL. The guide does not use it: a token would enter shell history, so OAuth is the path shown.

## Claude Desktop

Source: [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

- Menu path: Customize, Connectors, Add, Add custom connector. The article gives this path for claude.ai and says custom connectors are available in Claude Desktop on Free (one connector), Pro, Max, Ultra, Team and Enterprise plans. Team and Enterprise owners add them for the organization.
- The dialog asks for a name and the remote MCP server URL. Authentication can stay on the default sign-in choice: Spark registers clients dynamically, so no OAuth client ID is entered.
- Claude connects from Anthropic's cloud, so the Spark origin must be publicly reachable. A local `wrangler dev` origin cannot be used.

## Codex

Source: [Model Context Protocol, ChatGPT Learn](https://learn.chatgpt.com/docs/extend/mcp) (Markdown form at `.md`). `developers.openai.com/codex/mcp` redirects there.

- Streamable HTTP server: `codex mcp add <name> --url <url>`.
- OAuth: `codex mcp login <name>`. No config flag is needed.
- Config file: `[mcp_servers.<name>]` in `~/.codex/config.toml` with `url`; `bearer_token_env_var` is optional and names the environment variable that holds a bearer token.
- Not confirmed in the docs: `--bearer-token-env-var` on `codex mcp add`. [Connected assistants](../connected-assistants.md) still shows it from #34; test it before relying on it.
