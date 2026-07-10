// Claude Code config surfaces: file paths, hooks/plugins/model readers, version.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { run } from "./exec";

export const CLAUDE_DIR = join(homedir(), ".claude");

export const configPaths = {
  settings: join(CLAUDE_DIR, "settings.json"),
  settingsLocal: join(CLAUDE_DIR, "settings.local.json"),
  globalMemory: join(CLAUDE_DIR, "CLAUDE.md"),
};

type Settings = {
  hooks?: Record<string, { hooks?: unknown[] }[]>;
  enabledPlugins?: Record<string, boolean>;
  model?: string;
  theme?: string;
};

export function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(configPaths.settings, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function hookEvents(): { event: string; count: number }[] {
  const hooks = readSettings().hooks || {};
  return Object.keys(hooks).map((event) => ({
    event,
    count: (hooks[event] || []).reduce((n, g) => n + (g.hooks?.length || 0), 0),
  }));
}

export function enabledPlugins(): string[] {
  const p = readSettings().enabledPlugins || {};
  return Object.keys(p).filter((k) => p[k]);
}

export function currentModel(): string {
  return readSettings().model || "default";
}

export function setModel(model: string): void {
  const s = readSettings();
  if (model === "default") delete s.model;
  else s.model = model;
  writeFileSync(configPaths.settings, JSON.stringify(s, null, 2) + "\n");
}

export const MODELS = [
  { title: "Default (unset)", value: "default" },
  { title: "Opus 4.8", value: "claude-opus-4-8" },
  { title: "Sonnet 5", value: "claude-sonnet-5" },
  { title: "Haiku 4.5", value: "claude-haiku-4-5-20251001" },
  { title: "Fable 5", value: "claude-fable-5" },
];

// Ensure a file exists (create with template) and return its path.
export function ensureFile(path: string, template: string): string {
  if (!existsSync(path)) writeFileSync(path, template);
  return path;
}

export async function claudeVersion(): Promise<string> {
  try {
    return (await run("claude", ["--version"])).trim();
  } catch {
    return "unknown";
  }
}
