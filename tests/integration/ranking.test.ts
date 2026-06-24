import { vi } from 'vitest';

// Mock WorkOS authkit BEFORE any module that imports it
vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: vi.fn(),
  authkitMiddleware: vi.fn(() => vi.fn()),
  handleAuth: vi.fn(() => vi.fn()),
}));

import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  users,
  suites,
  suiteVersions,
  cases,
  caseVersions,
  competitors,
  competitorVersions,
  responses,
  comparisons,
  assignments,
  judgments,
  rankingRuns,
  rankingScores,
  campaigns,
} from '@/db/schema';
import { createRankingRun, getLeaderboard } from '@/services/ranking';
import { ForbiddenError, type SessionUser } from '@/auth/workos';

// ---- IDs to clean up ----
const createdUserIds: string[] = [];
const createdCompetitorIds: string[] = [];
const createdCompetitorVersionIds: string[] = [];
const createdResponseIds: string[] = [];
const createdComparisonIds: string[] = [];
const createdAssignmentIds: string[] = [];
const createdJudgmentIds: string[] = [];
const createdRankingRunIds: string[] = [];
const createdCampaignIds: string[] = [];
const createdSuiteIds: string[] = [];
const createdSuiteVersionIds: string[] = [];
const createdCaseIds: string[] = [];
const createdCaseVersionIds: string[] = [];

afterAll(async () => {
  // Clean up in FK-safe order (most dependent first)
  if (createdRankingRunIds.length > 0) {
    await db.delete(rankingScores).where(inArray(rankingScores.rankingRunId, createdRankingRunIds)).catch(() => undefined);
    await db.delete(rankingRuns).where(inArray(rankingRuns.id, createdRankingRunIds)).catch(() => undefined);
  }
  if (createdJudgmentIds.length > 0) {
    await db.delete(judgments).where(inArray(judgments.id, createdJudgmentIds)).catch(() => undefined);
  }
  if (createdAssignmentIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.id, createdAssignmentIds)).catch(() => undefined);
  }
  if (createdComparisonIds.length > 0) {
    await db.delete(comparisons).where(inArray(comparisons.id, createdComparisonIds)).catch(() => undefined);
  }
  if (createdResponseIds.length > 0) {
    await db.delete(responses).where(inArray(responses.id, createdResponseIds)).catch(() => undefined);
  }
  if (createdCampaignIds.length > 0) {
    await db.delete(campaigns).where(inArray(campaigns.id, createdCampaignIds)).catch(() => undefined);
  }
  if (createdCompetitorVersionIds.length > 0) {
    await db.delete(competitorVersions).where(inArray(competitorVersions.id, createdCompetitorVersionIds)).catch(() => undefined);
  }
  if (createdCompetitorIds.length > 0) {
    await db.delete(competitors).where(inArray(competitors.id, createdCompetitorIds)).catch(() => undefined);
  }
  if (createdCaseVersionIds.length > 0) {
    await db.delete(caseVersions).where(inArray(caseVersions.id, createdCaseVersionIds)).catch(() => undefined);
  }
  if (createdCaseIds.length > 0) {
    await db.delete(cases).where(inArray(cases.id, createdCaseIds)).catch(() => undefined);
  }
  if (createdSuiteVersionIds.length > 0) {
    await db.delete(suiteVersions).where(inArray(suiteVersions.id, createdSuiteVersionIds)).catch(() => undefined);
  }
  if (createdSuiteIds.length > 0) {
    await db.delete(suites).where(inArray(suites.id, createdSuiteIds)).catch(() => undefined);
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => undefined);
  }
  await pool.end();
});

// ---- Seed helpers ----

const SUFFIX = `ranking-${Date.now()}`;

async function seedUser(role: string): Promise<SessionUser & { dbId: string }> {
  const [row] = await db
    .insert(users)
    .values({
      workosUserId: `workos-test-${SUFFIX}-${role}`,
      email: `${role}-${SUFFIX}@test.com`,
      appRole: role,
      orgId: 'org-test-ranking',
    })
    .returning();
  createdUserIds.push(row.id);
  return {
    id: row.id,
    dbId: row.id,
    workosUserId: row.workosUserId,
    email: row.email,
    appRole: row.appRole as SessionUser['appRole'],
    orgId: row.orgId,
  };
}

interface SeedFixture {
  campaignId: string;
  caseVersionId: string;
  competitorVersionIdX: string;
  competitorVersionIdY: string;
  responseXId: string;
  responseYId: string;
}

async function seedFixture(): Promise<SeedFixture> {
  // Suite + version
  const [suite] = await db.insert(suites).values({ name: `Test Suite ${SUFFIX}` }).returning({ id: suites.id });
  createdSuiteIds.push(suite.id);

  const [suiteVersion] = await db
    .insert(suiteVersions)
    .values({ suiteId: suite.id, version: 1 })
    .returning({ id: suiteVersions.id });
  createdSuiteVersionIds.push(suiteVersion.id);

  // Case + version
  const [c] = await db.insert(cases).values({ suiteId: suite.id }).returning({ id: cases.id });
  createdCaseIds.push(c.id);

  const [cv] = await db
    .insert(caseVersions)
    .values({
      caseId: c.id,
      version: 1,
      kind: 'compression',
      title: `Test Case ${SUFFIX}`,
      outputSpecJson: {},
      runnerInputJson: { user: 'Test prompt' },
      evaluatorContextJson: {},
      contentHash: `case-hash-${SUFFIX}`,
    })
    .returning({ id: caseVersions.id });
  createdCaseVersionIds.push(cv.id);

  // Competitor X (the strong one)
  const [compX] = await db
    .insert(competitors)
    .values({ name: `Competitor X ${SUFFIX}`, competitorType: 'model_runner' })
    .returning({ id: competitors.id });
  createdCompetitorIds.push(compX.id);

  const [cvX] = await db
    .insert(competitorVersions)
    .values({
      competitorId: compX.id,
      version: 1,
      contentHash: `comp-x-hash-${SUFFIX}`,
    })
    .returning({ id: competitorVersions.id });
  createdCompetitorVersionIds.push(cvX.id);

  // Competitor Y (the weak one)
  const [compY] = await db
    .insert(competitors)
    .values({ name: `Competitor Y ${SUFFIX}`, competitorType: 'model_runner' })
    .returning({ id: competitors.id });
  createdCompetitorIds.push(compY.id);

  const [cvY] = await db
    .insert(competitorVersions)
    .values({
      competitorId: compY.id,
      version: 1,
      contentHash: `comp-y-hash-${SUFFIX}`,
    })
    .returning({ id: competitorVersions.id });
  createdCompetitorVersionIds.push(cvY.id);

  // Campaign
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `Test Campaign ${SUFFIX}`,
      suiteVersionId: suiteVersion.id,
      eligibleCompetitorVersionIds: [cvX.id, cvY.id],
    })
    .returning({ id: campaigns.id });
  createdCampaignIds.push(campaign.id);

  // Responses for X and Y on this case
  const [respX] = await db
    .insert(responses)
    .values({
      caseVersionId: cv.id,
      competitorVersionId: cvX.id,
      originType: 'model_generation',
      bodyText: 'Response from X',
      contentHash: `resp-x-hash-${SUFFIX}`,
      replicateIndex: 0,
    })
    .returning({ id: responses.id });
  createdResponseIds.push(respX.id);

  const [respY] = await db
    .insert(responses)
    .values({
      caseVersionId: cv.id,
      competitorVersionId: cvY.id,
      originType: 'model_generation',
      bodyText: 'Response from Y',
      contentHash: `resp-y-hash-${SUFFIX}`,
      replicateIndex: 0,
    })
    .returning({ id: responses.id });
  createdResponseIds.push(respY.id);

  return {
    campaignId: campaign.id,
    caseVersionId: cv.id,
    competitorVersionIdX: cvX.id,
    competitorVersionIdY: cvY.id,
    responseXId: respX.id,
    responseYId: respY.id,
  };
}

/**
 * Seed a judgment where X beats Y.
 * The comparison has responseOneId=responseXId, responseTwoId=responseYId.
 * The assignment has leftResponseId=responseXId (so outcome='left' means X wins).
 */
async function seedJudgmentXBeatsY(
  fixture: SeedFixture,
  assignedUserId: string,
  index: number,
): Promise<void> {
  const { campaignId, caseVersionId, responseXId, responseYId } = fixture;

  const [comparison] = await db
    .insert(comparisons)
    .values({
      campaignId,
      caseVersionId,
      responseOneId: responseXId,
      responseTwoId: responseYId,
    })
    .returning({ id: comparisons.id });
  createdComparisonIds.push(comparison.id);

  const [assignment] = await db
    .insert(assignments)
    .values({
      comparisonId: comparison.id,
      assignedUserId,
      leftResponseId: responseXId,
      rightResponseId: responseYId,
    })
    .returning({ id: assignments.id });
  createdAssignmentIds.push(assignment.id);

  const [judgment] = await db
    .insert(judgments)
    .values({
      assignmentId: assignment.id,
      userId: assignedUserId,
      outcome: 'left', // X is on the left → X wins
      preferredResponseId: responseXId,
      timeToFirstActionMs: 1000,
      totalDurationMs: 5000,
    })
    .returning({ id: judgments.id });
  createdJudgmentIds.push(judgment.id);
}

// ---- Tests ----

describe('ranking service integration', () => {
  it('createRankingRun: X ranks above Y with a higher display_score when X beats Y consistently', async () => {
    const operator = await seedUser('operator');
    const fixture = await seedFixture();

    // Seed 5 judgments where X beats Y
    for (let i = 0; i < 5; i++) {
      await seedJudgmentXBeatsY(fixture, operator.dbId, i);
    }

    const { rankingRunId } = await createRankingRun(operator, {
      campaignId: fixture.campaignId,
      seed: 12345,
    });
    createdRankingRunIds.push(rankingRunId);

    // Fetch scores
    const scores = await db
      .select()
      .from(rankingScores)
      .where(eq(rankingScores.rankingRunId, rankingRunId));

    expect(scores).toHaveLength(2);

    const scoreX = scores.find((s) => s.competitorVersionId === fixture.competitorVersionIdX);
    const scoreY = scores.find((s) => s.competitorVersionId === fixture.competitorVersionIdY);

    expect(scoreX).toBeDefined();
    expect(scoreY).toBeDefined();

    // X should rank above Y (lower rank number = better)
    expect(scoreX!.rank).toBeLessThan(scoreY!.rank!);
    // X should have a higher display score
    expect(scoreX!.displayScore!).toBeGreaterThan(scoreY!.displayScore!);
  });

  it('createRankingRun: same seed produces identical scores (reproducibility)', async () => {
    const operator = await seedUser('admin');
    const fixture = await seedFixture();

    // Seed judgments
    for (let i = 0; i < 4; i++) {
      await seedJudgmentXBeatsY(fixture, operator.dbId, i);
    }

    // Use a fixed future cutoff so both runs load the same judgments
    const futureCutoff = new Date(Date.now() + 60_000).toISOString();

    const { rankingRunId: runId1 } = await createRankingRun(operator, {
      campaignId: fixture.campaignId,
      seed: 99999,
      voteCutoffAt: futureCutoff,
    });
    createdRankingRunIds.push(runId1);

    const { rankingRunId: runId2 } = await createRankingRun(operator, {
      campaignId: fixture.campaignId,
      seed: 99999,
      voteCutoffAt: futureCutoff,
    });
    createdRankingRunIds.push(runId2);

    const scores1 = await db
      .select()
      .from(rankingScores)
      .where(eq(rankingScores.rankingRunId, runId1));
    const scores2 = await db
      .select()
      .from(rankingScores)
      .where(eq(rankingScores.rankingRunId, runId2));

    expect(scores1).toHaveLength(2);
    expect(scores2).toHaveLength(2);

    // Compare by matching on competitorVersionId explicitly (X and Y are shared by both runs)
    for (const s1 of scores1) {
      const s2 = scores2.find((s) => s.competitorVersionId === s1.competitorVersionId);
      expect(s2).toBeDefined();
      expect(s1.displayScore).toBeCloseTo(s2!.displayScore!, 10);
      expect(s1.rawScore).toBeCloseTo(s2!.rawScore!, 10);
      expect(s1.rank).toBe(s2!.rank);
    }
  });

  it('getLeaderboard: returns rows sorted by rank with CI fields populated', async () => {
    const operator = await seedUser('analyst');
    const fixture = await seedFixture();

    for (let i = 0; i < 5; i++) {
      await seedJudgmentXBeatsY(fixture, operator.dbId, i);
    }

    const { rankingRunId } = await createRankingRun(operator, {
      campaignId: fixture.campaignId,
      seed: 77777,
    });
    createdRankingRunIds.push(rankingRunId);

    const leaderboard = await getLeaderboard(rankingRunId);

    expect(leaderboard.length).toBeGreaterThan(0);

    // Sorted by rank ascending
    for (let i = 1; i < leaderboard.length; i++) {
      expect(leaderboard[i].rank!).toBeGreaterThanOrEqual(leaderboard[i - 1].rank!);
    }

    // CI fields populated on each row
    for (const row of leaderboard) {
      expect(row.rank).not.toBeNull();
      expect(row.rank_lower).not.toBeNull();
      expect(row.rank_upper).not.toBeNull();
      expect(row.confidence_lower).not.toBeNull();
      expect(row.confidence_upper).not.toBeNull();
      expect(row.competitor_name).toBeTruthy();
      expect(row.version).toBeGreaterThan(0);
    }
  });

  it('requireRole gating: evaluator cannot createRankingRun (throws ForbiddenError)', async () => {
    const evaluator = await seedUser('evaluator');
    const fixture = await seedFixture();

    await expect(
      createRankingRun(evaluator, { campaignId: fixture.campaignId }),
    ).rejects.toThrow(ForbiddenError);
  });
});
