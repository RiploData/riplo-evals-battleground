// src/services/skills/skill-source.ts
// Reads a skill folder (SKILL.md + references/*) from disk into a deterministic,
// content-addressable in-memory representation. Provider-agnostic — both the
// uploaders and the executors consume this.

import fs from 'node:fs/promises';
import path from 'node:path';
import { contentHash } from '@/domain/content-hash';

export interface SkillFile {
  /** Path relative to the skill directory, POSIX-separated (e.g. "references/de-slop-flags.md"). */
  relPath: string;
  content: string;
}

export interface SkillSource {
  /** Skill folder name, e.g. "mbb-language". Also the manifest key. */
  name: string;
  /** All files in the skill, sorted by relPath for determinism. */
  files: SkillFile[];
  /** YAML frontmatter `name`/`description` parsed from SKILL.md. */
  meta: { name: string; description: string };
  /** SKILL.md body with the YAML frontmatter stripped. */
  skillMdBody: string;
  /** Stable hash over {relPath, content} of every file. Changes iff skill content changes. */
  contentHash: string;
}

/** Default location of git-authored skill sources, alongside cases/ competitors/ config/. */
export const SKILLS_ROOT = path.join(process.cwd(), 'skills');

async function walk(dir: string, base: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(abs, base)));
    } else if (e.isFile()) {
      out.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  return out;
}

/** Parse `---\n...\n---` YAML frontmatter for `name` and `description` (no YAML dep needed). */
function parseFrontmatter(md: string): { meta: { name: string; description: string }; body: string } {
  const match = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: { name: '', description: '' }, body: md };
  const [, fmBlock, body] = match;
  const read = (key: string): string => {
    const m = fmBlock.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  return { meta: { name: read('name'), description: read('description') }, body: body.trimStart() };
}

/** Load a single skill folder into a SkillSource. Throws if SKILL.md is missing. */
export async function loadSkillSource(name: string, skillsRoot: string = SKILLS_ROOT): Promise<SkillSource> {
  const dir = path.join(skillsRoot, name);
  const relPaths = await walk(dir, dir);
  if (!relPaths.includes('SKILL.md')) {
    throw new Error(`Skill "${name}" is missing SKILL.md at ${dir}/SKILL.md`);
  }

  const files: SkillFile[] = [];
  for (const relPath of relPaths) {
    const content = await fs.readFile(path.join(dir, relPath), 'utf-8');
    files.push({ relPath, content });
  }

  const skillMd = files.find((f) => f.relPath === 'SKILL.md')!;
  const { meta, body } = parseFrontmatter(skillMd.content);

  return {
    name,
    files,
    meta,
    skillMdBody: body,
    contentHash: contentHash(files.map((f) => ({ relPath: f.relPath, content: f.content }))),
  };
}

/** List every skill folder under the skills root (those containing a SKILL.md). */
export async function listSkillNames(skillsRoot: string = SKILLS_ROOT): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      await fs.stat(path.join(skillsRoot, e.name, 'SKILL.md'));
      names.push(e.name);
    } catch {
      // not a skill folder
    }
  }
  return names.sort();
}
