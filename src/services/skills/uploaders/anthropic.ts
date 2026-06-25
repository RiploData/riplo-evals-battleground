// src/services/skills/uploaders/anthropic.ts
// Uploads a skill as a real Anthropic Agent Skill via the Skills API.
// First upload → skills.create (new skill_id). Content changed on an existing
// skill → skills.versions.create (new version on the same skill_id). The model
// later loads it by reference via container.skills — Anthropic mounts the whole
// folder (SKILL.md + references/) and runs progressive disclosure server-side.

import Anthropic, { toFile } from '@anthropic-ai/sdk';
import type { Uploadable } from '@anthropic-ai/sdk/core/uploads';
import type { SkillSource } from '../skill-source';
import type { SkillManifestEntry, AnthropicSkillHandle } from '../manifest';
import type { SkillUploader } from './types';

const SKILLS_BETA = 'skills-2025-10-02';

let _client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

async function toUploadables(source: SkillSource): Promise<Uploadable[]> {
  // All files share one top-level directory (the skill name), with SKILL.md at
  // its root — the shape the Skills API requires.
  return Promise.all(
    source.files.map((f) => toFile(Buffer.from(f.content, 'utf-8'), `${source.name}/${f.relPath}`)),
  );
}

export const anthropicSkillUploader: SkillUploader = {
  provider: 'anthropic',
  async upload(source: SkillSource, prev?: SkillManifestEntry): Promise<SkillManifestEntry> {
    const client = getClient();
    const files = await toUploadables(source);

    let handle: AnthropicSkillHandle;
    const prevSkillId = (prev?.handle as AnthropicSkillHandle | undefined)?.skillId;

    if (prevSkillId) {
      const version = await client.beta.skills.versions.create(prevSkillId, {
        files,
        betas: [SKILLS_BETA],
      });
      handle = { skillId: prevSkillId, version: version.version };
    } else {
      const skill = await client.beta.skills.create({
        display_title: source.name,
        files,
        betas: [SKILLS_BETA],
      });
      if (!skill.latest_version) {
        throw new Error(`Anthropic skill create for "${source.name}" returned no latest_version`);
      }
      handle = { skillId: skill.id, version: skill.latest_version };
    }

    return {
      skillName: source.name,
      provider: 'anthropic',
      contentHash: source.contentHash,
      uploadedAt: new Date().toISOString(),
      handle,
    };
  },
};
