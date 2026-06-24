import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  bigint,
  numeric,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { campaigns } from './campaigns';
import { caseVersions } from './suites-cases';
import { competitorVersions } from './competitors';
import { users } from './identity';

export const generationAttempts = pgTable(
  'generation_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    caseVersionId: uuid('case_version_id')
      .notNull()
      .references(() => caseVersions.id),
    competitorVersionId: uuid('competitor_version_id')
      .notNull()
      .references(() => competitorVersions.id),
    replicateIndex: integer('replicate_index').notNull().default(0),
    status: text('status').notNull().default('queued'),
    renderedRequest: jsonb('rendered_request'),
    providerRequestId: text('provider_request_id'),
    rawProviderResponseS3Key: text('raw_provider_response_s3_key'),
    modelReportedVersion: text('model_reported_version'),
    seed: bigint('seed', { mode: 'number' }),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }),
    finishReason: text('finish_reason'),
    errorCode: text('error_code'),
    runnerCodeVersion: text('runner_code_version'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('gen_attempts_cell').on(t.caseVersionId, t.competitorVersionId),
  ],
);

export const responses = pgTable(
  'responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseVersionId: uuid('case_version_id')
      .notNull()
      .references(() => caseVersions.id),
    competitorVersionId: uuid('competitor_version_id').references(() => competitorVersions.id),
    originType: text('origin_type').notNull(),
    generationAttemptId: uuid('generation_attempt_id').references(() => generationAttempts.id),
    authorUserId: uuid('author_user_id').references(() => users.id),
    bodyText: text('body_text').notNull(),
    bodyJson: jsonb('body_json'),
    parentResponseIds: uuid('parent_response_ids').array(), // (phased/rewrite) lineage for rewrites/syntheses
    reusePermission: boolean('reuse_permission'), // (phased) may this human-authored response re-enter battles
    authoringProtocolJson: jsonb('authoring_protocol_json'), // (phased) baseline protocol metadata
    lengthChars: integer('length_chars'),
    lengthTokens: integer('length_tokens'),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('active'),
    // Added for app-level model-cell uniqueness enforcement (replaces the
    // replicate_index_from_attempt() function referenced in 02-data-model.md).
    // A partial unique index on (case_version_id, competitor_version_id, replicate_index)
    // where origin_type = 'model_generation' enforces one model response per cell+replicate.
    replicateIndex: integer('replicate_index').notNull().default(0),
  },
  (t) => [
    // One model response per (case, competitor, replicate).
    // The DDL in 02-data-model.md references replicate_index_from_attempt(generation_attempt_id)
    // which is a custom function we do not define. Instead we carry replicate_index directly on
    // responses and enforce uniqueness here with a partial index — functionally equivalent.
    uniqueIndex('responses_model_cell')
      .on(t.caseVersionId, t.competitorVersionId, t.replicateIndex)
      .where(sql`origin_type = 'model_generation'`),
  ],
);
