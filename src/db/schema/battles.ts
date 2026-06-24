import { pgTable, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { campaigns } from './campaigns';
import { caseVersions } from './suites-cases';
import { responses } from './generation';
import { users } from './identity';

export const comparisons = pgTable('comparisons', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').references(() => campaigns.id),
  caseVersionId: uuid('case_version_id')
    .notNull()
    .references(() => caseVersions.id),
  responseOneId: uuid('response_one_id')
    .notNull()
    .references(() => responses.id),
  responseTwoId: uuid('response_two_id')
    .notNull()
    .references(() => responses.id),
  matchmakingStrategy: text('matchmaking_strategy'),
  matchmakingReason: text('matchmaking_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('active'),
});

export const assignments = pgTable('assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  comparisonId: uuid('comparison_id')
    .notNull()
    .references(() => comparisons.id),
  assignedUserId: uuid('assigned_user_id')
    .notNull()
    .references(() => users.id),
  leftResponseId: uuid('left_response_id')
    .notNull()
    .references(() => responses.id),
  rightResponseId: uuid('right_response_id')
    .notNull()
    .references(() => responses.id),
  uiVersion: text('ui_version'),
  evaluatorInstructionVersion: text('evaluator_instruction_version'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  status: text('status').notNull().default('open'),
});

export const judgments = pgTable('judgments', {
  id: uuid('id').primaryKey().defaultRandom(),
  assignmentId: uuid('assignment_id')
    .notNull()
    .references(() => assignments.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  outcome: text('outcome').notNull(),
  preferredResponseId: uuid('preferred_response_id').references(() => responses.id),
  reasonTags: text('reason_tags').array().notNull().default([]), // (phased v1.1) diagnostic, post-choice
  freeTextComment: text('free_text_comment'),
  rewriteResponseId: uuid('rewrite_response_id').references(() => responses.id),
  rewriteForkedFrom: text('rewrite_forked_from'),
  timeToFirstActionMs: integer('time_to_first_action_ms'),
  totalDurationMs: integer('total_duration_ms'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('valid'),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  invalidationReason: text('invalidation_reason'),
});
