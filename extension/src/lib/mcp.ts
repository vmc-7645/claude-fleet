// MCP servers via `claude mcp list` (authoritative — includes claude.ai gateway
// servers and their live auth/health status).

import { run } from "./exec";

export interface McpServer {
  name: string;
  url: string;
  status: string;
  connected: boolean;
  needsAuth: boolean;
}

export async function listMcpServers(): Promise<McpServer[]> {
  let out = "";
  try {
    out = await run("claude", ["mcp", "list"]);
  } catch (e) {
    // `claude mcp list` can exit non-zero while still printing the list.
    out = String((e as { stdout?: string }).stdout || "");
  }
  const servers: McpServer[] = [];
  for (const line of out.split("\n")) {
    // "<name>: <url> - <status>"
    const m = line.match(/^(.+?):\s+(\S+)\s+-\s+(.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    const url = m[2].trim();
    const status = m[3].trim();
    servers.push({
      name,
      url,
      status,
      connected: /connected/i.test(status),
      needsAuth: /needs auth/i.test(status),
    });
  }
  return servers;
}
