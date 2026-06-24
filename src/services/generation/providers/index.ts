// src/services/generation/providers/index.ts
export type { GenerationProvider, ProviderRequest, ProviderResult } from '../provider';
export { anthropicProvider } from './anthropic';
export { openAIProvider } from './openai';

import type { GenerationProvider } from '../provider';
import { anthropicProvider } from './anthropic';
import { openAIProvider } from './openai';

export function providerFor(modelProvider: string): GenerationProvider {
  switch (modelProvider) {
    case 'anthropic':
      return anthropicProvider;
    case 'openai':
      return openAIProvider;
    default:
      throw new Error(`Unknown model_provider: ${modelProvider}`);
  }
}
