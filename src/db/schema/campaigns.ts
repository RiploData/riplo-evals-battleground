import { pgTable, uuid, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import { suiteVersions } from './suites-cases';

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  suiteVersionId: uuid('suite_version_id')
    .notNull()
    .references(() => suiteVersions.id),
  caseSelectorJson: jsonb('case_selector_json').notNull().default('{}'),
  eligibleCompetitorVersionIds: uuid('eligible_competitor_version_ids').array().notNull().default([]),
  replicates: integer('replicates').notNull().default(1),
  matchmakingStrategy: text('matchmaking_strategy').notNull().default('coverage'),
  requiredJudgmentsPerBattle: integer('required_judgments_per_battle').notNull().default(1),
  rankingMethod: text('ranking_method').notNull().default('bradley_terry'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
