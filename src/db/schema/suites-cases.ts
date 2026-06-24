import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  doublePrecision,
  unique,
} from 'drizzle-orm/pg-core';
import { users } from './identity';

export const suites = pgTable('suites', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  purpose: text('purpose'),
  intendedReader: text('intended_reader'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const suiteVersions = pgTable(
  'suite_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    suiteId: uuid('suite_id')
      .notNull()
      .references(() => suites.id),
    version: integer('version').notNull(),
    rubricJson: jsonb('rubric_json').notNull().default('{}'),
    weightingJson: jsonb('weighting_json').notNull().default('{}'),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.suiteId, t.version)],
);

export const cases = pgTable('cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  suiteId: uuid('suite_id')
    .notNull()
    .references(() => suites.id),
  externalRef: text('external_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const caseVersions = pgTable(
  'case_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id),
    version: integer('version').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    guidance: text('guidance'),
    outputSpecJson: jsonb('output_spec_json').notNull(),
    runnerInputJson: jsonb('runner_input_json').notNull(),
    evaluatorContextJson: jsonb('evaluator_context_json').notNull(),
    sourceBlocksJson: jsonb('source_blocks_json').notNull().default('[]'),
    hiddenMetadataJson: jsonb('hidden_metadata_json').notNull().default('{}'),
    tags: text('tags').array().notNull().default([]),
    datasetSplit: text('dataset_split').notNull().default('dev'),
    samplingWeight: doublePrecision('sampling_weight').notNull().default(1.0),
    sensitivity: text('sensitivity').notNull().default('internal'),
    contentHash: text('content_hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.caseId, t.version)],
);
