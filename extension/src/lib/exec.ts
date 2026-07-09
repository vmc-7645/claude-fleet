// Run a shell command with an augmented PATH — Raycast strips the user's shell
// PATH, so gh / claude / claude-worktree / git aren't found otherwise.

import { execFile } from "child_process";
import { homedir } from "os";
import { promisify } from "util";

const pexec = promisify(execFile);

const PATH = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  `${homedir()}/.local/bin`,
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");

export async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<string> {
  const { stdout } = await pexec(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, PATH, ...opts.env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}
