// src/services/generation/providers/gemini.ts
// Google Gemini via the unified Google Gen AI SDK (@google/genai).
// Single-completion prompt mode only (the wildcard competitor is vanilla).
// Key: GEMINI_API_KEY (falls back to GOOGLE_API_KEY).

import { GoogleGenAI } from '@google/genai';
import type { GenerationProvider, ProviderRequest, ProviderResult } from '../provider';

let _client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

export const googleProvider: GenerationProvider = {
  async execute(req: ProviderRequest): Promise<ProviderResult> {
    const client = getClient();
    const maxOutputTokens =
      (req.params.max_tokens as number | undefined) ??
      (req.params.max_output_tokens as number | undefined) ??
      4096;

    const resp = await client.models.generateContent({
      model: req.model,
      contents: req.user,
      config: {
        maxOutputTokens,
        // Omit systemInstruction when empty (true vanilla baseline).
        ...(req.system.trim() ? { systemInstruction: req.system } : {}),
        // Only forward temperature if explicitly set (vanilla leaves it default).
        ...(req.params.temperature !== undefined ? { temperature: req.params.temperature as number } : {}),
      },
    });

    return {
      text: resp.text ?? '',
      inputTokens: resp.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: resp.usageMetadata?.candidatesTokenCount ?? 0,
      finishReason: (resp.candidates?.[0]?.finishReason as string | undefined) ?? 'unknown',
      providerRequestId: resp.responseId,
      modelReportedVersion: resp.modelVersion ?? req.model,
      raw: resp,
    };
  },
};
