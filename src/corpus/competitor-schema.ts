import { z } from 'zod';

// ── Zod schemas ──────────────────────────────────────────────────────────────

const CompetitorFileSchema = z.object({
  name: z.string().min(1),
  competitor_type: z.string().min(1),
});

const CompetitorVersionFileSchema = z.object({
  model_provider: z.string().min(1),
  model_identifier: z.string().min(1),
  // 'prompt' (default) = single completion; 'skill' = provider-hosted skill loop.
  execution_mode: z.enum(['prompt', 'skill']).optional(),
  prompt_bundle: z.object({
    system_prompt: z.string().optional(),
    system_prompt_ref: z.string().optional(),
    skills: z.array(z.string()).optional(),
    // Skill folder name under skills/ — required when execution_mode === 'skill'.
    skill_ref: z.string().optional(),
  }),
  model_parameters: z.record(z.unknown()),
  source_type: z.string().min(1),
  parent: z
    .object({
      slug: z.string().min(1),
      version: z.number().int().positive(),
    })
    .optional(),
});

// ── TypeScript interfaces (derived from schemas) ─────────────────────────────

export type CompetitorFile = z.infer<typeof CompetitorFileSchema>;
export type CompetitorVersionFile = z.infer<typeof CompetitorVersionFileSchema>;

// ── Validators ───────────────────────────────────────────────────────────────

export function validateCompetitor(json: unknown): CompetitorFile {
  return CompetitorFileSchema.parse(json);
}

export function validateCompetitorVersion(json: unknown): CompetitorVersionFile {
  return CompetitorVersionFileSchema.parse(json);
}
