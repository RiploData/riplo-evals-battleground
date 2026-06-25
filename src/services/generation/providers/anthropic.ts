// src/services/generation/providers/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';
import type { GenerationProvider, ProviderRequest, ProviderResult } from '../provider';

let _client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export const anthropicProvider: GenerationProvider = {
  async execute(req: ProviderRequest): Promise<ProviderResult> {
    const client = getClient();
    const maxTokens = (req.params.max_tokens as number) ?? 4096;

    // Build optional thinking block — ONLY pass if present in params.
    // Do NOT forward temperature, top_p, top_k, or budget_tokens:
    // current Claude models (Opus 4.8 / Sonnet 4.6) reject those with a 400.
    const extraParams: Record<string, unknown> = {};
    if (req.params.thinking !== undefined) {
      extraParams.thinking = req.params.thinking;
    }

    const resp = await client.messages.create({
      model: req.model,
      max_tokens: maxTokens,
      // Omit system entirely when empty (vanilla / no-prompt competitors).
      ...(req.system.trim() ? { system: req.system } : {}),
      messages: [{ role: 'user', content: req.user }],
      ...extraParams,
    });

    const text = resp.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      finishReason: resp.stop_reason ?? 'unknown',
      providerRequestId: resp.id,
      modelReportedVersion: resp.model,
      raw: resp,
    };
  },
};
