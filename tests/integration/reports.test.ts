/**
 * Integration test for reports service (task 17).
 * Uses a real DB — docker compose must be running on port 5544.
 * Cleans up only the rows it inserts (no global truncate).
 */

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
  campaigns,
  comparisons,
  assignments,
  judgments,
  responses,
} from '@/db/schema';
import { headToHead, segments, positionBias } from '@/services/reports';

// ─── Cleanup bookkeeping ──────────────────────────────────────────────────────

const ids = {
  userIds: [] as string[],
  suiteIds: [] as string[],
  suiteVersionIds: [] as string[],
  caseIds: [] as string[],
  caseVersionIds: [] as string[],
  competitorIds: [] as string[],
  competitorVersionIds: [] as string[],
  campaignIds: [] as string[],
  responseIds: [] as string[],
  comparisonIds: [] as string[],
  assignmentIds: [] as string[],
  judgmentIds: [] as string[],
};

afterAll(async () => {
  // Delete in FK-safe order (most dependent first)
  for (const id of ids.judgmentIds) {
    await db.delete(judgments).where(eq(judgments.id, id)).catch(() => undefined);
  }
  for (const id of ids.assignmentIds) {
    await db.delete(assignments).where(eq(assignments.id, id)).catch(() => undefined);
  }
  for (const id of ids.comparisonIds) {
    await db.delete(comparisons).where(eq(comparisons.id, id)).catch(() => undefined);
  }
  for (const id of ids.responseIds) {
    await db.delete(responses).where(eq(responses.id, id)).catch(() => undefined);
  }
  for (const id of ids.campaignIds) {
    await db.delete(campaigns).where(eq(campaigns.id, id)).catch(() => undefined);
  }
  for (const id of ids.caseVersionIds) {
    await db.delete(caseVersions).where(eq(caseVersions.id, id)).catch(() => undefined);
  }
  for (const id of ids.caseIds) {
    await db.delete(cases).where(eq(cases.id, id)).catch(() => undefined);
  }
  for (const id of ids.suiteVersionIds) {
    await db.delete(suiteVersions).where(eq(suiteVersions.id, id)).catch(() => undefined);
  }
  for (const id of ids.suiteIds) {
    await db.delete(suites).where(eq(suites.id, id)).catch(() => undefined);
  }
  for (const id of ids.competitorVersionIds) {
    await db.delete(competitorVersions).where(eq(competitorVersions.id, id)).catch(() => undefined);
  }
  for (const id of ids.competitorIds) {
    await db.delete(competitors).where(eq(competitors.id, id)).catch(() => undefined);
  }
  for (const id of ids.userIds) {
    await db.delete(users).where(eq(users.id, id)).catch(() => undefined);
  }
  await pool.end();
});

// ─── Seed helpers ─────────────────────────────────────────────────────────────

let _suffix = 0;
const tag = () => `rpt-${Date.now()}-${_suffix++}`;

async function seedUser() {
  const suffix = tag();
  const [u] = await db
    .insert(users)
    .values({ workosUserId: `wos-rpt-${suffix}`, email: `rpt-${suffix}@test.com`, orgId: 'org-test', appRole: 'member' })
    .returning({ id: users.id });
  ids.userIds.push(u.id);
  return u.id;
}

async function seedSuite() {
  const [s] = await db.insert(suites).values({ name: `Suite-${tag()}` }).returning({ id: suites.id });
  ids.suiteIds.push(s.id);
  const [sv] = await db.insert(suiteVersions).values({ suiteId: s.id, version: 1 }).returning({ id: suiteVersions.id });
  ids.suiteVersionIds.push(sv.id);
  return { suiteId: s.id, suiteVersionId: sv.id };
}

async function seedCase(suiteId: string, kind: string) {
  const [c] = await db.insert(cases).values({ suiteId }).returning({ id: cases.id });
  ids.caseIds.push(c.id);
  const suffix = tag();
  const [cv] = await db
    .insert(caseVersions)
    .values({
      caseId: c.id,
      version: 1,
      kind,
      title: `Case-${suffix}`,
      outputSpecJson: {},
      runnerInputJson: {},
      evaluatorContextJson: {},
      contentHash: `cv-hash-${suffix}`,
    })
    .returning({ id: caseVersions.id });
  ids.caseVersionIds.push(cv.id);
  return cv.id;
}

async function seedCompetitor(name: string) {
  const [comp] = await db
    .insert(competitors)
    .values({ name, competitorType: 'model_runner' })
    .returning({ id: competitors.id });
  ids.competitorIds.push(comp.id);
  const suffix = tag();
  const [cv] = await db
    .insert(competitorVersions)
    .values({
      competitorId: comp.id,
      version: 1,
      contentHash: `cv-hash-comp-${suffix}`,
    })
    .returning({ id: competitorVersions.id });
  ids.competitorVersionIds.push(cv.id);
  return { competitorId: comp.id, competitorVersionId: cv.id };
}

async function seedResponse(caseVersionId: string, competitorVersionId: string, replicateIndex = 0) {
  const suffix = tag();
  const [r] = await db
    .insert(responses)
    .values({
      caseVersionId,
      competitorVersionId,
      originType: 'model_generation',
      bodyText: `response-${suffix}`,
      contentHash: `resp-hash-${suffix}`,
      replicateIndex,
    })
    .returning({ id: responses.id });
  ids.responseIds.push(r.id);
  return r.id;
}

async function seedComparison(
  campaignId: string,
  caseVersionId: string,
  responseOneId: string,
  responseTwoId: string,
) {
  const [comp] = await db
    .insert(comparisons)
    .values({ campaignId, caseVersionId, responseOneId, responseTwoId })
    .returning({ id: comparisons.id });
  ids.comparisonIds.push(comp.id);
  return comp.id;
}

async function seedAssignment(
  comparisonId: string,
  userId: string,
  leftResponseId: string,
  rightResponseId: string,
) {
  const [a] = await db
    .insert(assignments)
    .values({ comparisonId, assignedUserId: userId, leftResponseId, rightResponseId })
    .returning({ id: assignments.id });
  ids.assignmentIds.push(a.id);
  return a.id;
}

async function seedJudgment(
  assignmentId: string,
  userId: string,
  outcome: string,
  preferredResponseId: string | null = null,
) {
  const [j] = await db
    .insert(judgments)
    .values({
      assignmentId,
      userId,
      outcome,
      preferredResponseId: preferredResponseId ?? undefined,
      timeToFirstActionMs: 1000,
      totalDurationMs: 5000,
    })
    .returning({ id: judgments.id });
  ids.judgmentIds.push(j.id);
  return j.id;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('reports integration', () => {
  /**
   * Fixture setup:
   *   - 2 competitors: cvA, cvB
   *   - 2 case kinds: 'compression' and 'reasoning'
   *   - campaign
   *   - 3 judgments in total:
   *       1. cvA wins over cvB (compression case, cvA on left)
   *       2. cvB wins over cvA (compression case, cvB on left)
   *       3. tie between cvA and cvB (reasoning case)
   */

  it('headToHead: square matrix with consistent wins', async () => {
    const userId = await seedUser();
    const { suiteVersionId } = await seedSuite();
    const suiteId = (await db.select({ suiteId: suiteVersions.suiteId }).from(suiteVersions).where(eq(suiteVersions.id, suiteVersionId)))[0].suiteId;

    const cvCase1 = await seedCase(suiteId, 'compression');
    const cvCase2 = await seedCase(suiteId, 'reasoning');

    const { competitorVersionId: cvA } = await seedCompetitor(`CompA-${tag()}`);
    const { competitorVersionId: cvB } = await seedCompetitor(`CompB-${tag()}`);

    // Campaign
    const [campaign] = await db
      .insert(campaigns)
      .values({
        name: `Campaign-${tag()}`,
        suiteVersionId,
        requiredJudgmentsPerBattle: 1,
      })
      .returning({ id: campaigns.id });
    ids.campaignIds.push(campaign.id);

    // Responses
    const respA1 = await seedResponse(cvCase1, cvA);
    const respB1 = await seedResponse(cvCase1, cvB);
    const respA2 = await seedResponse(cvCase2, cvA);
    const respB2 = await seedResponse(cvCase2, cvB);

    // Comparison 1 (compression): cvA vs cvB
    const compId1 = await seedComparison(campaign.id, cvCase1, respA1, respB1);
    // cvA is left, cvB is right → cvA wins
    const assignId1 = await seedAssignment(compId1, userId, respA1, respB1);
    await seedJudgment(assignId1, userId, 'left', respA1);

    // Comparison 2 (compression): cvA vs cvB — same case but cvB on left, cvB wins
    const respA1b = await seedResponse(cvCase1, cvA, 1);
    const respB1b = await seedResponse(cvCase1, cvB, 1);
    const compId2 = await seedComparison(campaign.id, cvCase1, respA1b, respB1b);
    const assignId2 = await seedAssignment(compId2, userId, respB1b, respA1b);
    await seedJudgment(assignId2, userId, 'left', respB1b); // left = cvB's response

    // Comparison 3 (reasoning): tie
    const compId3 = await seedComparison(campaign.id, cvCase2, respA2, respB2);
    const assignId3 = await seedAssignment(compId3, userId, respA2, respB2);
    await seedJudgment(assignId3, userId, 'tie', null);

    const result = await headToHead();

    // Filter to just our seeded competitors
    const allCvIds = [cvA, cvB];
    const idxA = result.competitors.indexOf(cvA);
    const idxB = result.competitors.indexOf(cvB);

    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);

    const n = result.competitors.length;
    expect(result.matrix).toHaveLength(n);
    for (const row of result.matrix) expect(row).toHaveLength(n);

    // Tie counts 0.5 each; cvA won once, cvB won once
    // matrix[idxA][idxB] = 1 (win from comp1) + 0.5 (tie from comp3) = 1.5
    // matrix[idxB][idxA] = 1 (win from comp2) + 0.5 (tie) = 1.5
    const aVsB = result.matrix[idxA][idxB];
    const bVsA = result.matrix[idxB][idxA];

    // Together they should sum to the number of games (3) — two decisive + one tie = 2+0.5+0.5 = 3
    expect(aVsB + bVsA).toBeCloseTo(3, 5);
    // Ties split 0.5 each, and each competitor won 1 decisive
    expect(aVsB).toBeCloseTo(1.5, 5);
    expect(bVsA).toBeCloseTo(1.5, 5);

    // Diagonal is always 0 (no self-wins)
    expect(result.matrix[idxA][idxA]).toBe(0);
    expect(result.matrix[idxB][idxB]).toBe(0);
  });

  it('segments(by:kind): partitions judgments into correct kind buckets', async () => {
    const userId = await seedUser();
    const { suiteVersionId } = await seedSuite();
    const suiteId = (await db.select({ suiteId: suiteVersions.suiteId }).from(suiteVersions).where(eq(suiteVersions.id, suiteVersionId)))[0].suiteId;

    const compressionCaseId = await seedCase(suiteId, 'compression');
    const reasoningCaseId = await seedCase(suiteId, 'reasoning');

    const { competitorVersionId: cvX } = await seedCompetitor(`CompX-${tag()}`);
    const { competitorVersionId: cvY } = await seedCompetitor(`CompY-${tag()}`);

    const [campaign] = await db
      .insert(campaigns)
      .values({ name: `Campaign-seg-${tag()}`, suiteVersionId, requiredJudgmentsPerBattle: 1 })
      .returning({ id: campaigns.id });
    ids.campaignIds.push(campaign.id);

    // Compression responses
    const respX1 = await seedResponse(compressionCaseId, cvX);
    const respY1 = await seedResponse(compressionCaseId, cvY);
    const compC = await seedComparison(campaign.id, compressionCaseId, respX1, respY1);
    const assignC = await seedAssignment(compC, userId, respX1, respY1);
    // cvX wins in compression
    await seedJudgment(assignC, userId, 'left', respX1);

    // Reasoning responses
    const respX2 = await seedResponse(reasoningCaseId, cvX);
    const respY2 = await seedResponse(reasoningCaseId, cvY);
    const compR = await seedComparison(campaign.id, reasoningCaseId, respX2, respY2);
    const assignR = await seedAssignment(compR, userId, respX2, respY2);
    // cvY wins in reasoning
    await seedJudgment(assignR, userId, 'right', respY2);

    const result = await segments(undefined, 'kind');

    // Find compression and reasoning segments
    const compressionSeg = result.find((s) => s.segment === 'compression');
    const reasoningSeg = result.find((s) => s.segment === 'reasoning');

    expect(compressionSeg).toBeDefined();
    expect(reasoningSeg).toBeDefined();

    // In compression: cvX should rank better than cvY (cvX won)
    const compressionRows = compressionSeg!.rows;
    const cvXRowC = compressionRows.find((r) => r.competitor_version_id === cvX);
    const cvYRowC = compressionRows.find((r) => r.competitor_version_id === cvY);
    expect(cvXRowC).toBeDefined();
    expect(cvYRowC).toBeDefined();
    // cvX should rank better (lower rank number) than cvY
    expect(cvXRowC!.rank!).toBeLessThan(cvYRowC!.rank!);

    // In reasoning: cvY should rank better than cvX (cvY won)
    const reasoningRows = reasoningSeg!.rows;
    const cvXRowR = reasoningRows.find((r) => r.competitor_version_id === cvX);
    const cvYRowR = reasoningRows.find((r) => r.competitor_version_id === cvY);
    expect(cvXRowR).toBeDefined();
    expect(cvYRowR).toBeDefined();
    expect(cvYRowR!.rank!).toBeLessThan(cvXRowR!.rank!);

    // Each segment should have the correct judgment_count
    expect(cvXRowC!.judgment_count).toBeGreaterThanOrEqual(1);
    expect(cvYRowR!.judgment_count).toBeGreaterThanOrEqual(1);
  });

  it('positionBias: computes top vs bottom win rates from assignment order', async () => {
    const userId = await seedUser();
    const { suiteVersionId } = await seedSuite();
    const suiteId = (await db.select({ suiteId: suiteVersions.suiteId }).from(suiteVersions).where(eq(suiteVersions.id, suiteVersionId)))[0].suiteId;

    const caseId = await seedCase(suiteId, 'compression');

    const { competitorVersionId: cvP } = await seedCompetitor(`CompP-${tag()}`);
    const { competitorVersionId: cvQ } = await seedCompetitor(`CompQ-${tag()}`);

    const [campaign] = await db
      .insert(campaigns)
      .values({ name: `Campaign-bias-${tag()}`, suiteVersionId, requiredJudgmentsPerBattle: 1 })
      .returning({ id: campaigns.id });
    ids.campaignIds.push(campaign.id);

    // Two comparisons:
    // 1. cvP shown LEFT (top), cvQ shown RIGHT (bottom) → cvP wins (left wins)
    // 2. cvQ shown LEFT (top), cvP shown RIGHT (bottom) → cvQ wins (left wins)

    const respP1 = await seedResponse(caseId, cvP);
    const respQ1 = await seedResponse(caseId, cvQ);
    const comp1 = await seedComparison(campaign.id, caseId, respP1, respQ1);
    // assignment: left=respP1 (cvP on top), right=respQ1
    const assign1 = await seedAssignment(comp1, userId, respP1, respQ1);
    await seedJudgment(assign1, userId, 'left', respP1); // cvP wins from top position

    const respP2 = await seedResponse(caseId, cvP, 1);
    const respQ2 = await seedResponse(caseId, cvQ, 1);
    const comp2 = await seedComparison(campaign.id, caseId, respP2, respQ2);
    // assignment: left=respQ2 (cvQ on top), right=respP2
    const assign2 = await seedAssignment(comp2, userId, respQ2, respP2);
    await seedJudgment(assign2, userId, 'left', respQ2); // cvQ wins from top position

    const result = await positionBias(campaign.id);

    const rowP = result.find((r) => r.competitorVersionId === cvP);
    const rowQ = result.find((r) => r.competitorVersionId === cvQ);

    expect(rowP).toBeDefined();
    expect(rowQ).toBeDefined();

    // cvP: shown on top once (won) → topWinRate = 1.0; shown on bottom once (lost) → bottomWinRate = 0.0
    expect(rowP!.topWinRate).toBeCloseTo(1.0, 5);
    expect(rowP!.bottomWinRate).toBeCloseTo(0.0, 5);
    expect(rowP!.n).toBe(2);

    // cvQ: shown on top once (won) → topWinRate = 1.0; shown on bottom once (lost) → bottomWinRate = 0.0
    expect(rowQ!.topWinRate).toBeCloseTo(1.0, 5);
    expect(rowQ!.bottomWinRate).toBeCloseTo(0.0, 5);
    expect(rowQ!.n).toBe(2);
  });
});
