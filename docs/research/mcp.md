# Remote MCP and authorization

Researched 13 November 2026 for #34. Recheck protocol and SDK support before changing the transport or authorization flow.

## Protocol and authorization

The [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) identifies HTTP servers as OAuth resource servers. Its requirements include OAuth 2.1, resource indicators, protected resource metadata, authorization-server discovery and PKCE. Access tokens belong to the intended resource, rather than being credentials passed through to other services. Dynamic client registration is one supported registration mechanism; client ID metadata documents are another. The authorization server's internal implementation remains the application's responsibility.

Spark implements discovery at `/.well-known/oauth-protected-resource/api/mcp` (plus the root alias) and `/.well-known/oauth-authorization-server`. Unauthorized requests advertise the protected resource metadata in `WWW-Authenticate`. The sole scope is `memories:read`. Authorization requires Better Auth sign-in, explicit consent, a registered redirect, `S256`, and the canonical `/api/mcp` resource. Code exchange binds all four values and atomically consumes a five-minute code. Tokens are opaque, digested with SHA-256 at rest, checked in Postgres on each request, and expire after one hour. There is no refresh grant: reconnect when authorization expires. Public clients use dynamic registration with `token_endpoint_auth_method=none`; confidential clients and client ID metadata documents are not advertised.

Native callbacks follow [RFC 8252 §7.3 and §8.4](https://www.rfc-editor.org/rfc/rfc8252#section-7.3): authorization requests may vary the port of a registered HTTP loopback IP callback (`127.0.0.1` or `[::1]`). Scheme, host, path and query remain exact. HTTPS and `localhost` callbacks remain exact in full. The approved actual redirect, including its port, is bound to the code and must match exactly at token exchange.

## Cloudflare

Cloudflare documents [Streamable HTTP transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/) and an Agents SDK `createMcpHandler`. Its [authorization guide](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/) offers Workers OAuth Provider for issuing authorization and Durable Objects for stateful servers. These are options, rather than prerequisites for a remote server.

Spark uses the MCP TypeScript SDK's [Web Standards transport](https://github.com/modelcontextprotocol/typescript-sdk) directly inside its existing Hono Worker. Stateless JSON responses avoid new Durable Objects and isolate-local session state. Existing Better Auth sessions identify the person approving consent; the existing Postgres database stores credentials and one-use grants. This keeps revocation consistent across Worker isolates. The SDK handles protocol negotiation, initialization, tool discovery and input validation. The integration test covers the HTTP boundary; the handshake script uses the SDK's client against `wrangler dev`.

## Product and security decisions

- AI opt-out prevents Spark's AI processing. A Connected assistant may read those originals because the person explicitly connected it; consent names that permission. Existing search and More Like This still respect the Memory's Indexing/vector restrictions.
- Tools return original text, Preserved text, signed original-file URLs, Source links, why-chips and the search package's `match: direct|related`; Spark generates no summaries. Search and More Like This pass `excludeSamples` to the existing Library search. A known Sample Memory id can still be read explicitly.
- Tool descriptions instruct clients to treat every returned field as untrusted data. Responses use a JSON data block between explicit delimiters. Delimiters are an instruction boundary, not an escaping sandbox; assistants remain responsible for respecting it.
- Personal access tokens last 90 days, have the same read-only scope, appear once in Settings, and can be revoked there. OAuth tokens appear alongside them and can be revoked individually. Already delivered data and signed file URLs cannot be recalled; existing signed download URLs expire within two hours.
- A shared Postgres fixed window allows 60 HTTP requests per token per minute. `assistantStore.allow` is the replacement seam for #27. Calls log only the assistant name, known tool name (or `unknown`), timestamp and result count, including failed tool calls. The #35 UI can consume `/api/assistants/activity`.
- Deletion clears credentials, pending codes and activity immediately; foreign keys also cascade on final account removal. Owner advisory locks order credential/log writes with deletion without holding a lock over an AI or storage call. Exports include connected assistant metadata, never credential digests or tokens.
- OAuth client names are supplied at registration and are not verified identities. HTTPS redirects or local loopback HTTP are accepted; redirects match exactly apart from the native loopback IP port exception. No outbound client-metadata fetch is needed.

## Owner verification

Automated HTTP flows and the SDK client handshake are executable without provider credentials. Real Claude Code and Codex account/browser authorization are owner checks: follow [Connected assistants](../connected-assistants.md), approve, search, read, revoke, then confirm the next call refuses access. Do not claim those real-client checks from a protocol handshake alone.
