import { pgTable, uuid, text, timestamp, jsonb, integer, unique } from 'drizzle-orm/pg-core';
import { users } from './identity';

export const competitors = pgTable('competitors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  competitorType: text('competitor_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const competitorVersions = pgTable(
  'competitor_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitors.id),
    version: integer('version').notNull(),
    parentCompetitorVersionId: uuid('parent_competitor_version_id').references(
      () => competitorVersions.id,
    ),
    modelProvider: text('model_provider'),
    modelIdentifier: text('model_identifier'),
    promptBundleJson: jsonb('prompt_bundle_json').notNull().default('{}'),
    modelParametersJson: jsonb('model_parameters_json').notNull().default('{}'),
    toolConfigJson: jsonb('tool_config_json').notNull().default('{}'), // (phased) tools/MCP config
    outputSchemaJson: jsonb('output_schema_json'), // (phased) expected structured output
    sourceType: text('source_type').notNull().default('manual'),
    contentHash: text('content_hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('active'),
  },
  (t) => [unique().on(t.competitorId, t.version)],
);
