// src/services/skills/manifest.ts
// The skill registry manifest is git-authored config-as-code: it maps each
// (skill, provider) pair to the provider-specific handle returned at upload time,
// plus the content hash that produced it (so re-uploads are idempotent and
// competitor versions can pin a known-good skill build).
//
// Committed at config/skill-registry.json. The uploader writes it; the runtime
// skill executors read it. Nothing at request time touches the provider upload APIs.

import fs from 'node:fs/promises';
import path from 'node:path';

/** Anthropic Agent Skill: uploaded once via the Skills API, referenced by id+version. */
export interface AnthropicSkillHandle {
  skillId: string;
  version: string;
}

/**
 * OpenAI has no Skills primitive. The faithful hosted-container analog:
 * - `instructions` carries the SKILL.md body (the always-loaded guide) + a note
 *   listing the reference files available on the code-interpreter container.
 * - `fileIds` are the reference files, mounted into the auto container; the model
 *   reads them on demand (progressive-disclosure analog).
 */
export interface OpenAISkillHandle {
  fileIds: string[];
  instructions: string;
}

export interface SkillManifestEntry {
  skillName: string;
  provider: 'anthropic' | 'openai';
  contentHash: string;
  uploadedAt: string;
  handle: AnthropicSkillHandle | OpenAISkillHandle;
}

/** manifest[skillName][provider] = entry */
export type SkillManifest = Record<string, Partial<Record<'anthropic' | 'openai', SkillManifestEntry>>>;

export const MANIFEST_PATH = path.join(process.cwd(), 'config', 'skill-registry.json');

export async function loadManifest(manifestPath: string = MANIFEST_PATH): Promise<SkillManifest> {
  try {
    return JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as SkillManifest;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export async function saveManifest(
  manifest: SkillManifest,
  manifestPath: string = MANIFEST_PATH,
): Promise<void> {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  // Sorted keys → stable diffs in git.
  const sorted: SkillManifest = {};
  for (const skill of Object.keys(manifest).sort()) sorted[skill] = manifest[skill];
  await fs.writeFile(manifestPath, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
}

export function getHandle(
  manifest: SkillManifest,
  skillName: string,
  provider: 'anthropic' | 'openai',
): SkillManifestEntry {
  const entry = manifest[skillName]?.[provider];
  if (!entry) {
    throw new Error(
      `No ${provider} handle for skill "${skillName}" in the skill registry. ` +
        `Run \`npm run skills:upload\` to register it.`,
    );
  }
  return entry;
}
