import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  doublePrecision,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { campaigns } from './campaigns';
import { competitorVersions } from './competitors';

export const rankingRuns = pgTable('ranking_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').references(() => campaigns.id),
  algorithm: text('algorithm').notNull().default('bradley_terry'),
  algorithmVersion: text('algorithm_version'),
  parametersJson: jsonb('parameters_json').notNull().default('{}'),
  voteCutoffAt: timestamp('vote_cutoff_at', { withTimezone: true }).notNull(),
  filtersJson: jsonb('filters_json').notNull().default('{}'),
  codeVersion: text('code_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('complete'),
});

export const rankingScores = pgTable(
  'ranking_scores',
  {
    rankingRunId: uuid('ranking_run_id')
      .notNull()
      .references(() => rankingRuns.id),
    competitorVersionId: uuid('competitor_version_id')
      .notNull()
      .references(() => competitorVersions.id),
    rawScore: doublePrecision('raw_score'),
    displayScore: doublePrecision('display_score'),
    rank: integer('rank'),
    rankLower: integer('rank_lower'),
    rankUpper: integer('rank_upper'),
    confidenceLower: doublePrecision('confidence_lower'),
    confidenceUpper: doublePrecision('confidence_upper'),
    judgmentCount: integer('judgment_count'),
    caseCount: integer('case_count'),
    unacceptableRate: doublePrecision('unacceptable_rate'),
    tieRate: doublePrecision('tie_rate'),
  },
  (t) => [primaryKey({ columns: [t.rankingRunId, t.competitorVersionId] })],
);
