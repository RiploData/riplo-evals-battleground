import { z } from 'zod';

// ── Sub-schemas ─────────────────────────────────────────────────────────────

const outputSpecPartSchema = z.object({
  type: z.string(),
  label: z.string(),
  note: z.string().optional(),
});

const outputSpecSchema = z.object({
  target: z.string(),
  parts: z.array(outputSpecPartSchema),
});

const sourceBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('bullets'), items: z.array(z.string()) }),
]);

// ── CaseFile interface ────────────────────────────────────────────────────────

export interface OutputSpecPart {
  type: string;
  label: string;
  note?: string;
}

export interface OutputSpec {
  target: string;
  parts: OutputSpecPart[];
}

export type SourceBlock =
  | { type: 'text'; text: string }
  | { type: 'bullets'; items: string[] };

export interface CaseFile {
  kind: string;
  title: string;
  guidance?: string;
  output_spec: OutputSpec;
  runner_input: Record<string, unknown>;
  source_blocks: SourceBlock[];
  hidden_metadata: Record<string, unknown>;
  tags: string[];
  dataset_split: 'dev' | 'validation' | 'holdout';
  rubric_notes?: string[];
  suite: string;
}

// ── Zod schema ───────────────────────────────────────────────────────────────

export const caseFileSchema: z.ZodType<CaseFile> = z.object({
  kind: z.string().min(1),
  title: z.string().min(1),
  guidance: z.string().optional(),
  output_spec: outputSpecSchema,
  runner_input: z.record(z.unknown()),
  source_blocks: z.array(sourceBlockSchema),
  hidden_metadata: z.record(z.unknown()),
  tags: z.array(z.string()),
  dataset_split: z.enum(['dev', 'validation', 'holdout']),
  rubric_notes: z.array(z.string()).optional(),
  suite: z.string().min(1),
});

// ── Validator ────────────────────────────────────────────────────────────────

/**
 * Validates raw JSON against the CaseFile schema.
 * Throws ZodError on failure.
 */
export function validateCaseFile(json: unknown): CaseFile {
  return caseFileSchema.parse(json);
}
