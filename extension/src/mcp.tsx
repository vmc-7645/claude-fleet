// MCP Servers — list configured servers + live auth status; re-authenticate.

import { List, ActionPanel, Action, Icon, Color, showToast, Toast, showHUD, closeMainWindow } from "@raycast/api";
import { useEffect, useState } from "react";
import { listMcpServers, McpServer } from "./lib/mcp";
import { openMcpAuth } from "./lib/claude";

export default function Command() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    setIsLoading(true);
    try {
      setServers(await listMcpServers());
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to list MCP servers", message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const needAuth = servers.filter((s) => s.needsAuth);
  const ok = servers.filter((s) => !s.needsAuth);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search MCP servers…">
      <List.Section title={`Needs auth (${needAuth.length})`}>
        {needAuth.map((s) => (
          <McpItem key={s.name} s={s} reload={load} />
        ))}
      </List.Section>
      <List.Section title={`Connected (${ok.length})`}>
        {ok.map((s) => (
          <McpItem key={s.name} s={s} reload={load} />
        ))}
      </List.Section>
    </List>
  );
}

function McpItem({ s, reload }: { s: McpServer; reload: () => void }) {
  const icon = s.needsAuth
    ? { source: Icon.ExclamationMark, tintColor: Color.Orange }
    : s.connected
      ? { source: Icon.CheckCircle, tintColor: Color.Green }
      : { source: Icon.Circle };

  async function auth() {
    await closeMainWindow();
    try {
      await openMcpAuth();
      await showHUD("Opening Claude /mcp to authenticate");
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }

  return (
    <List.Item
      icon={icon}
      title={s.name}
      subtitle={s.url}
      accessories={[{ text: s.status }]}
      actions={
        <ActionPanel>
          <Action title={s.needsAuth ? "Authenticate (Opens /mcp)" : "Re-authenticate (Opens /mcp)"} icon={Icon.Key} onAction={auth} />
          <Action.OpenInBrowser url={s.url} />
          <Action.CopyToClipboard title="Copy URL" content={s.url} />
          <Action title="Refresh" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={reload} />
        </ActionPanel>
      }
    />
  );
}
