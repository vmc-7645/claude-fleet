// Custom slash-command skills in ~/.claude/skills/<name>/SKILL.md. A skill is
// "disabled" by renaming SKILL.md → SKILL.md.disabled (Claude Code then ignores
// it).

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface Skill {
  name: string;
  path: string; // the SKILL.md (or .disabled) file
  dir: string;
  description: string;
  disabled: boolean;
}

const SKILLS_DIR = join(homedir(), ".claude", "skills");

function frontmatterDesc(file: string): string {
  try {
    const txt = readFileSync(file, "utf8");
    const fm = txt.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return "";
    const d = fm[1].match(/^description:\s*(.+)$/m);
    return d ? d[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

export function listSkills(): Skill[] {
  let dirs: string[];
  try {
    dirs = readdirSync(SKILLS_DIR);
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const name of dirs) {
    const dir = join(SKILLS_DIR, name);
    const active = join(dir, "SKILL.md");
    const off = join(dir, "SKILL.md.disabled");
    let path = "";
    let disabled = false;
    if (existsSync(active)) path = active;
    else if (existsSync(off)) {
      path = off;
      disabled = true;
    } else continue;
    out.push({ name, path, dir, description: frontmatterDesc(path), disabled });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function toggleSkill(skill: Skill): void {
  const active = join(skill.dir, "SKILL.md");
  const off = join(skill.dir, "SKILL.md.disabled");
  if (skill.disabled) renameSync(off, active);
  else renameSync(active, off);
}

export function createSkill(name: string): string {
  const dir = join(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) {
    writeFileSync(
      file,
      `---\nname: ${name}\ndescription: TODO — what this command does and when to use it.\n---\n\n# ${name}\n\nTODO: instructions.\n`,
    );
  }
  return file;
}
