// src/services/skills/uploaders/openai.ts
// OpenAI has no Skills primitive, so we build the faithful hosted-container analog:
// the reference files are uploaded once and mounted into the code-interpreter
// `auto` container; the SKILL.md body becomes the request `instructions` (the
// always-loaded guide). The model reads the reference files on demand via the
// code interpreter — the progressive-disclosure analog — with no forced trigger.

import OpenAI, { toFile } from 'openai';
import path from 'node:path';
import type { SkillSource } from '../skill-source';
import type { SkillManifestEntry, OpenAISkillHandle } from '../manifest';
import type { SkillUploader } from './types';

let _client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

/** Reference files = everything except SKILL.md (which is carried in instructions). */
function referenceFiles(source: SkillSource) {
  return source.files.filter((f) => f.relPath !== 'SKILL.md');
}

/**
 * Build the request `instructions`: the skill guide (SKILL.md body) plus a note
 * mapping the SKILL.md's `references/<name>` paths to the flat container filenames
 * the model will actually see. Deliberately descriptive, not imperative — the
 * model decides whether to apply the guide, mirroring Anthropic's description-based
 * triggering.
 */
export function buildOpenAIInstructions(source: SkillSource): string {
  const refs = referenceFiles(source).map((f) => path.basename(f.relPath));
  const refNote =
    refs.length === 0
      ? ''
      : `\n\n---\nReference material for this guide is available in your code-interpreter ` +
        `working directory. Where the guide above cites \`references/<name>.md\`, the file is ` +
        `available as \`<name>.md\`. Read these as needed:\n` +
        refs.map((r) => `- ${r}`).join('\n');
  return `${source.skillMdBody.trim()}${refNote}`;
}

export const openaiSkillUploader: SkillUploader = {
  provider: 'openai',
  async upload(source: SkillSource, prev?: SkillManifestEntry): Promise<SkillManifestEntry> {
    const client = getClient();

    const fileIds: string[] = [];
    for (const f of referenceFiles(source)) {
      const uploaded = await client.files.create({
        file: await toFile(Buffer.from(f.content, 'utf-8'), path.basename(f.relPath)),
        purpose: 'user_data',
      });
      fileIds.push(uploaded.id);
    }

    // Best-effort cleanup of the previous build's files so they don't accumulate.
    const prevIds = (prev?.handle as OpenAISkillHandle | undefined)?.fileIds ?? [];
    await Promise.allSettled(prevIds.map((id) => client.files.delete(id)));

    const handle: OpenAISkillHandle = {
      fileIds,
      instructions: buildOpenAIInstructions(source),
    };

    return {
      skillName: source.name,
      provider: 'openai',
      contentHash: source.contentHash,
      uploadedAt: new Date().toISOString(),
      handle,
    };
  },
};
