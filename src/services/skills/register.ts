// src/services/skills/register.ts
// Orchestrates idempotent skill uploads: for each (skill, provider), upload only
// when the skill content hash differs from what the manifest already records.
// Writes the updated manifest to config/skill-registry.json.

import { loadSkillSource, listSkillNames } from './skill-source';
import { loadManifest, saveManifest, type SkillManifest } from './manifest';
import { skillUploaderFor, SKILL_PROVIDERS } from './uploaders';

export interface RegisterOptions {
  /** Skill folder names to register. Defaults to every skill under skills/. */
  skills?: string[];
  /** Providers to register against. Defaults to all known providers. */
  providers?: Array<'anthropic' | 'openai'>;
  /** Re-upload even when the content hash is unchanged. */
  force?: boolean;
  /** Per-line progress logger. */
  log?: (msg: string) => void;
}

export interface RegisterResult {
  uploaded: number;
  unchanged: number;
}

export async function registerSkills(opts: RegisterOptions = {}): Promise<RegisterResult> {
  const log = opts.log ?? (() => {});
  const providers = opts.providers ?? SKILL_PROVIDERS;
  const skillNames = opts.skills ?? (await listSkillNames());

  const manifest: SkillManifest = await loadManifest();
  let uploaded = 0;
  let unchanged = 0;

  for (const skillName of skillNames) {
    const source = await loadSkillSource(skillName);
    log(`skill "${skillName}" (hash ${source.contentHash.slice(0, 12)})`);

    for (const provider of providers) {
      const prev = manifest[skillName]?.[provider];
      if (!opts.force && prev && prev.contentHash === source.contentHash) {
        log(`  ${provider}: unchanged`);
        unchanged++;
        continue;
      }

      log(`  ${provider}: uploading…`);
      const entry = await skillUploaderFor(provider).upload(source, prev);
      manifest[skillName] = { ...manifest[skillName], [provider]: entry };
      await saveManifest(manifest); // persist after each upload so a mid-run failure keeps prior progress
      log(`  ${provider}: ok`);
      uploaded++;
    }
  }

  return { uploaded, unchanged };
}
