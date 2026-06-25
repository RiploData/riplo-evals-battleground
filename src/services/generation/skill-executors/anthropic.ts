// src/services/generation/skill-executors/anthropic.ts
// Anthropic hosts the whole loop: one beta.messages.create with container.skills
// tells Anthropic to provision the sandbox, mount the skill (SKILL.md + references),
// and run the code-execution tool inside it. Our only job is the pause_turn
// re-POST (provider asked for more time) and reading the final text.

import Anthropic from '@anthropic-ai/sdk';
import type { ProviderRequest, ProviderResult } from '../provider';
import type { SkillExecutor } from './types';
import type { SkillManifestEntry, AnthropicSkillHandle } from '@/services/skills/manifest';

const BETAS = ['code-execution-2025-08-25', 'skills-2025-10-02', 'files-api-2025-04-14'];
const CODE_EXEC_TOOL = { type: 'code_execution_20250825', name: 'code_execution' } as const;
const MAX_PAUSE_TURNS = 10;

let _client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export const anthropicSkillExecutor: SkillExecutor = {
  provider: 'anthropic',
  async execute(req: ProviderRequest, entry: SkillManifestEntry): Promise<ProviderResult> {
    const client = getClient();
    const handle = entry.handle as AnthropicSkillHandle;
    const maxTokens = (req.params.max_tokens as number) ?? 4096;

    const skills = [{ type: 'custom' as const, skill_id: handle.skillId, version: handle.version }];
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: req.user }];

    let inputTokens = 0;
    let outputTokens = 0;
    const textParts: string[] = [];
    let last: Anthropic.Beta.BetaMessage | undefined;
    let containerId: string | undefined;

    for (let turn = 0; turn <= MAX_PAUSE_TURNS; turn++) {
      const resp: Anthropic.Beta.BetaMessage = await client.beta.messages.create({
        model: req.model,
        max_tokens: maxTokens,
        betas: BETAS,
        container: containerId ? { id: containerId, skills } : { skills },
        tools: [CODE_EXEC_TOOL],
        ...(req.system.trim() ? { system: req.system } : {}),
        messages,
      });

      last = resp;
      containerId = resp.container?.id ?? containerId;
      inputTokens += resp.usage.input_tokens;
      outputTokens += resp.usage.output_tokens;
      const text = textOf(resp.content);
      if (text) textParts.push(text);

      if (resp.stop_reason !== 'pause_turn') break;
      // Hand the turn back unchanged so Anthropic resumes its loop.
      messages.push({ role: 'assistant', content: resp.content });
    }

    if (!last) throw new Error('Anthropic skill execution produced no response');

    return {
      text: textParts.join(''),
      inputTokens,
      outputTokens,
      finishReason: last.stop_reason ?? 'unknown',
      providerRequestId: last.id,
      modelReportedVersion: last.model,
      raw: last,
    };
  },
};
