// src/services/generation/skill-executors/types.ts
import type { ProviderRequest, ProviderResult } from '../provider';
import type { SkillManifestEntry } from '@/services/skills/manifest';

/**
 * Runs a generation where the work is delegated to a provider-hosted skill/agent
 * loop (Anthropic Agent Skills, OpenAI code-interpreter container). One impl per
 * provider; registered in ./index.ts. The provider manages its own sandbox — we
 * only POST and read the result.
 */
export interface SkillExecutor {
  provider: 'anthropic' | 'openai';
  execute(req: ProviderRequest, handle: SkillManifestEntry): Promise<ProviderResult>;
}
