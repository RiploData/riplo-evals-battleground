import { z } from 'zod';

// ── Suite config (config/suites/default.json) ────────────────────────────────

export const suiteConfigSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().optional(),
  intended_reader: z.string().optional(),
  rubric_json: z.record(z.unknown()).default({}),
  weighting_json: z.record(z.unknown()).default({}),
});

export type SuiteConfig = z.infer<typeof suiteConfigSchema>;

// ── Campaign config (config/campaign.json) ───────────────────────────────────

export const eligibleCompetitorRefSchema = z.object({
  slug: z.string().min(1),
  version: z.number().int().positive(),
});

export const campaignConfigSchema = z.object({
  name: z.string().min(1),
  suite: z.string().min(1),
  case_selector_json: z.record(z.unknown()).default({}),
  eligible_competitors: z.array(eligibleCompetitorRefSchema).min(1),
  replicates: z.number().int().positive().default(1),
  matchmaking_strategy: z.string().default('coverage'),
});

export type EligibleCompetitorRef = z.infer<typeof eligibleCompetitorRefSchema>;
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;

// ── Validators ────────────────────────────────────────────────────────────────

export function validateSuiteConfig(json: unknown): SuiteConfig {
  return suiteConfigSchema.parse(json);
}

export function validateCampaignConfig(json: unknown): CampaignConfig {
  return campaignConfigSchema.parse(json);
}
