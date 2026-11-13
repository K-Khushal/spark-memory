/** MCP_TOKEN is read only from the environment; no credential or result content is printed. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function checkMcp(url, token) {
  if (!token) throw new Error("MCP_TOKEN is required");
  const client = new Client({ name: "Spark handshake", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    if (
      ["search_memories", "get_memory", "find_similar"].some(
        (name) => !tools.some((t) => t.name === name)
      )
    )
      throw new Error("Missing tools");
    const result = await client.callTool({
      name: "search_memories",
      arguments: { query: "memory" },
    });
    if (result.isError) throw new Error("Tool call failed");
    console.log(
      `MCP handshake passed; ${tools.length} tools; search_memories passed`
    );
  } finally {
    await client.close();
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await checkMcp(
    process.env.MCP_URL ?? "http://localhost:8787/api/mcp",
    process.env.MCP_TOKEN
  );
}
