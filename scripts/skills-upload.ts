/**
 * scripts/skills-upload.ts
 *
 * Registers git-authored skill folders (skills/<name>/) with the LLM providers and
 * writes the handles to config/skill-registry.json. Idempotent: only re-uploads a
 * (skill, provider) when the skill's content hash changed (or with --force).
 *
 * Usage:
 *   npm run skills:upload                          # all skills, all providers
 *   npm run skills:upload -- --skills mbb-language # one skill
 *   npm run skills:upload -- --providers anthropic # one provider
 *   npm run skills:upload -- --force               # re-upload even if unchanged
 *
 * Requires ANTHROPIC_API_KEY / OPENAI_API_KEY for the providers being uploaded to.
 */

import 'dotenv/config';
import { registerSkills } from '@/services/skills/register';
import { SKILL_PROVIDERS } from '@/services/skills/uploaders';
import { MANIFEST_PATH } from '@/services/skills/manifest';

function parseList(flag: string): string[] | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) return undefined;
  return process.argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const force = process.argv.includes('--force');
  const skills = parseList('--skills');
  const providers = (parseList('--providers') as Array<'anthropic' | 'openai'> | undefined) ?? SKILL_PROVIDERS;

  console.log('=== Skill upload ===');
  console.log(`providers: ${providers.join(', ')}${force ? ' (force)' : ''}`);

  const res = await registerSkills({
    skills,
    providers,
    force,
    log: (m) => console.log(m),
  });

  console.log(`\nDone — uploaded ${res.uploaded}, unchanged ${res.unchanged}.`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log('Commit config/skill-registry.json so seed + runtime resolve the handles.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\nskills:upload failed:', err?.message ?? err);
    process.exit(1);
  },
);
