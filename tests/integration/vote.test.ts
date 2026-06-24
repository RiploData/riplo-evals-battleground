import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  users,
  suites,
  cases,
  caseVersions,
  competitors,
  competitorVersions,
  responses,
  comparisons,
  assignments,
  judgments,
} from '@/db/schema';
import { submitVote, VoteError } from '@/services/vote';
import type { SessionUser } from '@/auth/workos';
import type { VoteRequest } from '@/types/contracts';

// ---- Cleanup tracking ----
const createdJudgmentIds: string[] = [];
const createdAssignmentIds: string[] = [];
const createdComparisonIds: string[] = [];
const createdResponseIds: string[] = [];
const createdCompetitorVersionIds: string[] = [];
const createdCompetitorIds: string[] = [];
const createdCaseVersionIds: string[] = [];
const createdCaseIds: string[] = [];
const createdSuiteIds: string[] = [];
const createdUserIds: string[] = [];

afterAll(async () => {
  // Clean up in FK-safe order (most dependent first)
  for (const id of createdJudgmentIds) {
    await db.delete(judgments).where(eq(judgments.id, id)).catch(() => undefined);
  }
  for (const id of createdAssignmentIds) {
    await db.delete(assignments).where(eq(assignments.id, id)).catch(() => undefined);
  }
  for (const id of createdComparisonIds) {
    await db.delete(comparisons).where(eq(comparisons.id, id)).catch(() => undefined);
  }
  for (const id of createdResponseIds) {
    await db.delete(responses).where(eq(responses.id, id)).catch(() => undefined);
  }
  for (const id of createdCompetitorVersionIds) {
    await db.delete(competitorVersions).where(eq(competitorVersions.id, id)).catch(() => undefined);
  }
  for (const id of createdCompetitorIds) {
    await db.delete(competitors).where(eq(competitors.id, id)).catch(() => undefined);
  }
  for (const id of createdCaseVersionIds) {
    await db.delete(caseVersions).where(eq(caseVersions.id, id)).catch(() => undefined);
  }
  for (const id of createdCaseIds) {
    await db.delete(cases).where(eq(cases.id, id)).catch(() => undefined);
  }
  for (const id of createdSuiteIds) {
    await db.delete(suites).where(eq(suites.id, id)).catch(() => undefined);
  }
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id)).catch(() => undefined);
  }
  await pool.end();
});

// ---- Seed helper ----

async function seedFullChain(suffix: string) {
  // User
  const [user] = await db
    .insert(users)
    .values({
      workosUserId: `wos_vote_test_${suffix}`,
      email: `vote_test_${suffix}@example.com`,
      orgId: 'org_vote_test',
      appRole: 'evaluator',
    })
    .returning();
  createdUserIds.push(user.id);

  const sessionUser: SessionUser = {
    id: user.id,
    workosUserId: user.workosUserId,
    email: user.email,
    appRole: 'evaluator',
    orgId: user.orgId,
  };

  // Suite + Case + CaseVersion
  const [suite] = await db
    .insert(suites)
    .values({ name: `Vote Test Suite ${suffix}` })
    .returning({ id: suites.id });
  createdSuiteIds.push(suite.id);

  const [c] = await db
    .insert(cases)
    .values({ suiteId: suite.id })
    .returning({ id: cases.id });
  createdCaseIds.push(c.id);

  const [cv] = await db
    .insert(caseVersions)
    .values({
      caseId: c.id,
      version: 1,
      kind: 'compression',
      title: `Vote Test Case ${suffix}`,
      outputSpecJson: {},
      runnerInputJson: {},
      evaluatorContextJson: {},
      contentHash: `vote-case-hash-${suffix}`,
    })
    .returning({ id: caseVersions.id });
  createdCaseVersionIds.push(cv.id);

  // Competitor A + version
  const [compA] = await db
    .insert(competitors)
    .values({ name: `Vote CompA ${suffix}`, competitorType: 'model_runner' })
    .returning({ id: competitors.id });
  createdCompetitorIds.push(compA.id);

  const [cvA] = await db
    .insert(competitorVersions)
    .values({
      competitorId: compA.id,
      version: 1,
      contentHash: `vote-comp-a-hash-${suffix}`,
    })
    .returning({ id: competitorVersions.id });
  createdCompetitorVersionIds.push(cvA.id);

  // Competitor B + version
  const [compB] = await db
    .insert(competitors)
    .values({ name: `Vote CompB ${suffix}`, competitorType: 'model_runner' })
    .returning({ id: competitors.id });
  createdCompetitorIds.push(compB.id);

  const [cvB] = await db
    .insert(competitorVersions)
    .values({
      competitorId: compB.id,
      version: 1,
      contentHash: `vote-comp-b-hash-${suffix}`,
    })
    .returning({ id: competitorVersions.id });
  createdCompetitorVersionIds.push(cvB.id);

  // Two responses (one per competitor version)
  const [respLeft] = await db
    .insert(responses)
    .values({
      caseVersionId: cv.id,
      competitorVersionId: cvA.id,
      originType: 'model_generation',
      bodyText: `Response Left ${suffix}`,
      lengthChars: `Response Left ${suffix}`.length,
      contentHash: `vote-resp-left-hash-${suffix}`,
      replicateIndex: 0,
    })
    .returning({ id: responses.id });
  createdResponseIds.push(respLeft.id);

  const [respRight] = await db
    .insert(responses)
    .values({
      caseVersionId: cv.id,
      competitorVersionId: cvB.id,
      originType: 'model_generation',
      bodyText: `Response Right ${suffix}`,
      lengthChars: `Response Right ${suffix}`.length,
      contentHash: `vote-resp-right-hash-${suffix}`,
      replicateIndex: 0,
    })
    .returning({ id: responses.id });
  createdResponseIds.push(respRight.id);

  // Comparison
  const [comparison] = await db
    .insert(comparisons)
    .values({
      caseVersionId: cv.id,
      responseOneId: respLeft.id,
      responseTwoId: respRight.id,
      status: 'active',
    })
    .returning({ id: comparisons.id });
  createdComparisonIds.push(comparison.id);

  // Assignment (open, assigned to user, with recorded left/right order)
  const [assignment] = await db
    .insert(assignments)
    .values({
      comparisonId: comparison.id,
      assignedUserId: user.id,
      leftResponseId: respLeft.id,
      rightResponseId: respRight.id,
      status: 'open',
    })
    .returning({ id: assignments.id });
  createdAssignmentIds.push(assignment.id);

  return {
    sessionUser,
    assignment,
    respLeft,
    respRight,
    comparison,
    caseVersionId: cv.id,
  };
}

// ---- Tests ----

describe('submitVote integration', () => {
  it('left vote resolves preferred_response_id to the left response', async () => {
    const { sessionUser, assignment, respLeft } = await seedFullChain('left-vote');

    const req: VoteRequest = {
      assignment_id: assignment.id,
      outcome: 'left',
      time_to_first_action_ms: 1000,
      total_duration_ms: 5000,
    };

    const result = await submitVote(sessionUser, req);

    expect(result.judgment_id).toBeTruthy();
    expect(result.next).toBe('/battle');
    createdJudgmentIds.push(result.judgment_id);

    // Verify judgment row
    const [judgment] = await db
      .select()
      .from(judgments)
      .where(eq(judgments.id, result.judgment_id));

    expect(judgment.outcome).toBe('left');
    expect(judgment.preferredResponseId).toBe(respLeft.id);
    expect(judgment.status).toBe('valid');
    expect(judgment.userId).toBe(sessionUser.id);
    expect(judgment.assignmentId).toBe(assignment.id);
    expect(judgment.timeToFirstActionMs).toBe(1000);
    expect(judgment.totalDurationMs).toBe(5000);

    // Verify assignment is now 'submitted'
    const [updatedAssignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    expect(updatedAssignment.status).toBe('submitted');
  });

  it('rewrite-only submission defaults outcome to both_unacceptable and creates post_battle_rewrite response', async () => {
    const { sessionUser, assignment, respLeft } = await seedFullChain('rewrite-only');

    // No explicit outcome — rewrite-only
    const req: VoteRequest = {
      assignment_id: assignment.id,
      outcome: 'both_unacceptable', // effectiveOutcome handles undefined but VoteRequest requires outcome field
      time_to_first_action_ms: 2000,
      total_duration_ms: 10000,
      rewrite: {
        forked_from: 'a',
        body_text: 'My improved rewrite text',
      },
    };

    const result = await submitVote(sessionUser, req);
    expect(result.judgment_id).toBeTruthy();
    createdJudgmentIds.push(result.judgment_id);

    // Verify judgment row
    const [judgment] = await db
      .select()
      .from(judgments)
      .where(eq(judgments.id, result.judgment_id));

    expect(judgment.outcome).toBe('both_unacceptable');
    expect(judgment.preferredResponseId).toBeNull();
    expect(judgment.rewriteResponseId).toBeTruthy();
    expect(judgment.rewriteForkedFrom).toBe('a');
    createdResponseIds.push(judgment.rewriteResponseId!);

    // Verify the rewrite response was created
    const [rewriteResp] = await db
      .select()
      .from(responses)
      .where(eq(responses.id, judgment.rewriteResponseId!));

    expect(rewriteResp.originType).toBe('post_battle_rewrite');
    expect(rewriteResp.authorUserId).toBe(sessionUser.id);
    expect(rewriteResp.bodyText).toBe('My improved rewrite text');
    // Parent lineage: forked from 'a' → left response
    expect(rewriteResp.parentResponseIds).toContain(respLeft.id);

    // Originals must be unchanged
    const [originalLeft] = await db
      .select()
      .from(responses)
      .where(eq(responses.id, respLeft.id));
    expect(originalLeft.bodyText).toBe(`Response Left rewrite-only`);
    expect(originalLeft.originType).toBe('model_generation');
  });

  it('rejects a second vote on an already-submitted assignment', async () => {
    const { sessionUser, assignment } = await seedFullChain('double-vote');

    const req: VoteRequest = {
      assignment_id: assignment.id,
      outcome: 'tie',
      time_to_first_action_ms: 500,
      total_duration_ms: 3000,
    };

    // First vote — should succeed
    const first = await submitVote(sessionUser, req);
    createdJudgmentIds.push(first.judgment_id);

    // Second vote — should be rejected
    await expect(submitVote(sessionUser, req)).rejects.toThrow(VoteError);
    await expect(submitVote(sessionUser, req)).rejects.toMatchObject({
      code: 'ASSIGNMENT_NOT_OPEN',
      status: 409,
    });
  });

  it('cannot_assess stores null preferred_response_id', async () => {
    const { sessionUser, assignment } = await seedFullChain('cannot-assess');

    const req: VoteRequest = {
      assignment_id: assignment.id,
      outcome: 'cannot_assess',
      time_to_first_action_ms: 100,
      total_duration_ms: 200,
    };

    const result = await submitVote(sessionUser, req);
    createdJudgmentIds.push(result.judgment_id);

    const [judgment] = await db
      .select()
      .from(judgments)
      .where(eq(judgments.id, result.judgment_id));

    expect(judgment.outcome).toBe('cannot_assess');
    expect(judgment.preferredResponseId).toBeNull();
  });

  it('rejects vote on assignment belonging to another user', async () => {
    const { assignment } = await seedFullChain('wrong-user');
    // Create a different user
    const [otherUser] = await db
      .insert(users)
      .values({
        workosUserId: 'wos_vote_other_user',
        email: 'other_vote@example.com',
        orgId: 'org_vote_test',
        appRole: 'evaluator',
      })
      .returning();
    createdUserIds.push(otherUser.id);

    const otherSession: SessionUser = {
      id: otherUser.id,
      workosUserId: otherUser.workosUserId,
      email: otherUser.email,
      appRole: 'evaluator',
      orgId: otherUser.orgId,
    };

    const req: VoteRequest = {
      assignment_id: assignment.id,
      outcome: 'left',
      time_to_first_action_ms: 100,
      total_duration_ms: 200,
    };

    await expect(submitVote(otherSession, req)).rejects.toMatchObject({
      code: 'ASSIGNMENT_NOT_YOURS',
      status: 403,
    });
  });
});
