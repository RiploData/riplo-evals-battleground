// src/services/generation/skill-executors/index.ts
import type { SkillExecutor } from './types';
import { anthropicSkillExecutor } from './anthropic';
import { openaiSkillExecutor } from './openai';

export type { SkillExecutor } from './types';

const EXECUTORS: Record<string, SkillExecutor> = {
  anthropic: anthropicSkillExecutor,
  openai: openaiSkillExecutor,
};

export function skillExecutorFor(provider: string): SkillExecutor {
  const e = EXECUTORS[provider];
  if (!e) throw new Error(`No skill executor for provider: ${provider}`);
  return e;
}
