// src/services/generation/providers/openai.ts
import OpenAI from 'openai';
import type { GenerationProvider, ProviderRequest, ProviderResult } from '../provider';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const openAIProvider: GenerationProvider = {
  async execute(req: ProviderRequest): Promise<ProviderResult> {
    // Newer OpenAI models (gpt-5, o-series) use max_completion_tokens.
    // Accept either param name from req.params for flexibility.
    const maxCompletionTokens =
      (req.params.max_tokens as number | undefined) ??
      (req.params.max_completion_tokens as number | undefined) ??
      4096;

    // Build optional params — do NOT force a temperature because gpt-5/o-series
    // only accept the default value. Only forward if explicitly present.
    const extraParams: Record<string, unknown> = {};
    if (req.params.temperature !== undefined) {
      extraParams.temperature = req.params.temperature;
    }

    const resp = (await client.chat.completions.create({
      model: req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      max_completion_tokens: maxCompletionTokens,
      stream: false,
      ...extraParams,
    })) as OpenAI.Chat.Completions.ChatCompletion;

    const text = resp.choices[0]?.message?.content ?? '';

    return {
      text,
      inputTokens: resp.usage?.prompt_tokens ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
      finishReason: resp.choices[0]?.finish_reason ?? 'unknown',
      providerRequestId: resp.id,
      modelReportedVersion: resp.model,
      raw: resp,
    };
  },
};
