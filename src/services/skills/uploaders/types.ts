// src/services/skills/uploaders/types.ts
import type { SkillSource } from '../skill-source';
import type { SkillManifestEntry } from '../manifest';

/**
 * Generic provider uploader. One implementation per provider; registered in
 * ./index.ts. Adding a new provider = implement this + add it to the registry.
 */
export interface SkillUploader {
  provider: 'anthropic' | 'openai';
  /**
   * Push the skill to the provider and return a fresh manifest entry.
   * `prev` is the existing manifest entry (if any) so the uploader can extend an
   * existing resource (e.g. add an Anthropic skill version) rather than orphan it.
   */
  upload(source: SkillSource, prev?: SkillManifestEntry): Promise<SkillManifestEntry>;
}
