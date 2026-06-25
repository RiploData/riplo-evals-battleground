// src/services/skills/uploaders/index.ts
import type { SkillUploader } from './types';
import { anthropicSkillUploader } from './anthropic';
import { openaiSkillUploader } from './openai';

export type { SkillUploader } from './types';

const UPLOADERS: Record<string, SkillUploader> = {
  anthropic: anthropicSkillUploader,
  openai: openaiSkillUploader,
};

export const SKILL_PROVIDERS = Object.keys(UPLOADERS) as Array<'anthropic' | 'openai'>;

export function skillUploaderFor(provider: string): SkillUploader {
  const u = UPLOADERS[provider];
  if (!u) throw new Error(`No skill uploader for provider: ${provider}`);
  return u;
}
