// src/services/generation/skill-executors/openai.ts
// OpenAI hosts the whole loop too: one responses.create with a code-interpreter
// `auto` container. OpenAI provisions/manages the container, mounts the skill's
// reference files (file_ids), runs Python/bash to read them as the model sees fit,
// and returns the finished answer in a single call — no pause_turn, no client loop.

import OpenAI from 'openai';
import type { ProviderRequest, ProviderResult } from '../provider';
import type { SkillExecutor } from './types';
import type { SkillManifestEntry, OpenAISkillHandle } from '@/services/skills/manifest';

let _client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export const openaiSkillExecutor: SkillExecutor = {
  provider: 'openai',
  async execute(req: ProviderRequest, entry: SkillManifestEntry): Promise<ProviderResult> {
    const client = getClient();
    const handle = entry.handle as OpenAISkillHandle;
    const maxTokens =
      (req.params.max_tokens as number | undefined) ??
      (req.params.max_output_tokens as number | undefined);

    // The skill guide (SKILL.md body) is the request instructions; any case-level
    // system text is appended after it. Reference files ride on the container.
    const instructions = req.system.trim()
      ? `${handle.instructions}\n\n---\n${req.system}`
      : handle.instructions;

    const resp = await client.responses.create({
      model: req.model,
      instructions,
      input: req.user,
      tools: [{ type: 'code_interpreter', container: { type: 'auto', file_ids: handle.fileIds } }],
      ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
    });

    return {
      text: resp.output_text ?? '',
      inputTokens: resp.usage?.input_tokens ?? 0,
      outputTokens: resp.usage?.output_tokens ?? 0,
      finishReason: resp.incomplete_details?.reason ?? resp.status ?? 'unknown',
      providerRequestId: resp.id,
      modelReportedVersion: resp.model,
      raw: resp,
    };
  },
};
