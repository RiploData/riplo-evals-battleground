// src/services/generation/providers/index.ts
export type { GenerationProvider, ProviderRequest, ProviderResult } from '../provider';
export { anthropicProvider } from './anthropic';
export { openAIProvider } from './openai';
export { googleProvider } from './gemini';

import type { GenerationProvider } from '../provider';
import { anthropicProvider } from './anthropic';
import { openAIProvider } from './openai';
import { googleProvider } from './gemini';

export function providerFor(modelProvider: string): GenerationProvider {
  switch (modelProvider) {
    case 'anthropic':
      return anthropicProvider;
    case 'openai':
      return openAIProvider;
    case 'google':
      return googleProvider;
    default:
      throw new Error(`Unknown model_provider: ${modelProvider}`);
  }
}
