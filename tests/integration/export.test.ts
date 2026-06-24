import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  suites,
  cases,
  caseVersions,
  competitors,
  competitorVersions,
  campaigns,
  comparisons,
  assignments,
  judgments,
  responses,
  users,
} from '@/db/schema';
import { exportJudgments, listCases, listCompetitorVersions } from '@/services/export';

// ---- Cleanup ID tracking ----
const createdIds = {
  judgmentIds: [] as string[],
  assignmentIds: [] as string[],
  comparisonIds: [] as string[],
  responseIds: [] as string[],
  campaignIds: [] as string[],
  competitorVersionIds: [] as string[],
  competitorIds: [] as string[],
  caseVersionIds: [] as string[],
  caseIds: [] as string[],
  suiteIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
  // Clean up in FK-safe (most-dependent-first) order
  for (const id of createdIds.judgmentIds) {
    await db.delete(judgments).where(eq(judgments.id, id)).catch(() => undefined);
  }
  for (const id of createdIds.assignmentIds) {
    await db.delete(assignments).where(eq(assignments.id, id)).catch(() => undefined);
  }
  for (const id of createdIds.comparisonIds) {
    await db.delete(comparisons).where(eq(comparisons.id, id)).catch(() => undefined);
  }
  for (const id of createdIds.responseIds) {
    await db.delete(responses).where(eq(responses.id, id)).catch(() => undefined);
  }
  for (const id of createdIds.campaignIds) {
    await db.delete(campaigns).where(eq(campaigns.id, id)).catch(() => undefined);
  }
  for (const id of createdIds.competitorVersionIds) {
    await db.delete(competitorVersions).where(eq(competitorVersions.id, id)).catch(() => undefined);
  }
  for (const id of createdIds.competitorIds) {
    await db.delete(competitors).where(eq(competitors.id, id)).catch(() => undefined);
  }
  for (const id of createdIds.caseVersionIds) {
    await db.delete(caseVersions).where(eq(caseVersions.id, id)).catch(() => undefined);
  }
  for (const id of createdIds.caseIds) {
    await db.delete(cases).where(eq(cases.id, id)).catch(() => undefined);
  }
  for (const id of createdIds.suiteIds) {
    await db.delete(suites).where(eq(suites.id, id)).catch(() => undefined);
  }
  for (const id of createdIds.userIds) {
    await db.delete(users).where(eq(users.id, id)).catch(() => undefined);
  }
  await pool.end();
});

// ---- Seed helpers ----

async function seedUser(suffix: string) {
  const [u] = await db
    .insert(users)
    .values({
      workosUserId: `wos_export_test_${suffix}`,
      email: `export-test-${suffix}@example.com`,
      orgId: 'org_export_test',
      appRole: 'evaluator',
    })
    .returning({ id: users.id });
  createdIds.userIds.push(u.id);
  return u.id;
}

async function seedSuiteAndCaseVersion(suffix: string) {
  const [suite] = await db
    .insert(suites)
    .values({ name: `Export Test Suite ${suffix}` })
    .returning({ id: suites.id });
  createdIds.suiteIds.push(suite.id);

  const [c] = await db
    .insert(cases)
    .values({ suiteId: suite.id, externalRef: `ext-ref-${suffix}` })
    .returning({ id: cases.id });
  createdIds.caseIds.push(c.id);

  const [cv] = await db
    .insert(caseVersions)
    .values({
      caseId: c.id,
      version: 1,
      kind: 'compression',
      title: `Export Case ${suffix}`,
      outputSpecJson: {},
      runnerInputJson: { user: 'Summarise this.' },
      evaluatorContextJson: {},
      contentHash: `export-case-hash-${suffix}`,
      tags: ['tag-a', 'tag-b'],
      datasetSplit: 'test',
    })
    .returning({ id: caseVersions.id });
  createdIds.caseVersionIds.push(cv.id);

  return { suiteId: suite.id, caseId: c.id, caseVersionId: cv.id };
}

async function seedCompetitorVersion(suffix: string) {
  const [comp] = await db
    .insert(competitors)
    .values({ name: `Export Competitor ${suffix}`, competitorType: 'model_runner' })
    .returning({ id: competitors.id });
  createdIds.competitorIds.push(comp.id);

  const [cv] = await db
    .insert(competitorVersions)
    .values({
      competitorId: comp.id,
      version: 1,
      modelIdentifier: `fake-model-${suffix}`,
      promptBundleJson: {},
      modelParametersJson: {},
      contentHash: `export-comp-hash-${suffix}`,
      sourceType: 'manual',
    })
    .returning({ id: competitorVersions.id });
  createdIds.competitorVersionIds.push(cv.id);

  return { competitorId: comp.id, competitorVersionId: cv.id };
}

async function seedResponse(caseVersionId: string, suffix: string) {
  const [resp] = await db
    .insert(responses)
    .values({
      caseVersionId,
      originType: 'independent_human_baseline',
      bodyText: `Response body ${suffix}`,
      contentHash: `export-resp-hash-${suffix}`,
    })
    .returning({ id: responses.id });
  createdIds.responseIds.push(resp.id);
  return resp.id;
}

async function seedCampaign(suiteVersionId: string) {
  const [camp] = await db
    .insert(campaigns)
    .values({
      name: 'Export Test Campaign',
      suiteVersionId,
      caseSelectorJson: {},
    })
    .returning({ id: campaigns.id });
  createdIds.campaignIds.push(camp.id);
  return camp.id;
}

// ---- Tests ----

describe('export service integration', () => {
  it('exportJudgments json — returns valid JSON with one record per judgment including left/right and outcome', async () => {
    const userId = await seedUser('j-json-01');
    const { caseVersionId, suiteId } = await seedSuiteAndCaseVersion('j-json-01');

    // Need a suite_version for campaign FK
    const [sv] = await db
      .select({ id: suites.id })
      .from(suites)
      .where(eq(suites.id, suiteId));
    // Insert suite_version
    const { suiteVersions } = await import('@/db/schema');
    const [svRow] = await db
      .insert(suiteVersions)
      .values({
        suiteId: sv.id,
        version: 1,
        rubricJson: {},
        weightingJson: {},
      })
      .returning({ id: suiteVersions.id });
    // Track for cleanup — suite cleanup will cascade or we do it manually
    // suiteVersions are deleted when suite is deleted via cascade or we handle here
    // We'll just let it flow through the suite delete

    const campaignId = await seedCampaign(svRow.id);

    const leftId = await seedResponse(caseVersionId, 'left-01');
    const rightId = await seedResponse(caseVersionId, 'right-01');
    const rewriteId = await seedResponse(caseVersionId, 'rewrite-01');

    // Seed comparison + assignment + judgment
    const [comp] = await db
      .insert(comparisons)
      .values({
        campaignId,
        caseVersionId,
        responseOneId: leftId,
        responseTwoId: rightId,
      })
      .returning({ id: comparisons.id });
    createdIds.comparisonIds.push(comp.id);

    const [asgn] = await db
      .insert(assignments)
      .values({
        comparisonId: comp.id,
        assignedUserId: userId,
        leftResponseId: leftId,
        rightResponseId: rightId,
      })
      .returning({ id: assignments.id });
    createdIds.assignmentIds.push(asgn.id);

    const [j1] = await db
      .insert(judgments)
      .values({
        assignmentId: asgn.id,
        userId,
        outcome: 'left',
        preferredResponseId: leftId,
        timeToFirstActionMs: 1200,
        totalDurationMs: 4500,
      })
      .returning({ id: judgments.id });
    createdIds.judgmentIds.push(j1.id);

    // Second judgment with rewrite
    const [j2] = await db
      .insert(judgments)
      .values({
        assignmentId: asgn.id,
        userId,
        outcome: 'rewrite',
        rewriteResponseId: rewriteId,
        rewriteForkedFrom: 'left',
        timeToFirstActionMs: 2000,
        totalDurationMs: 9000,
      })
      .returning({ id: judgments.id });
    createdIds.judgmentIds.push(j2.id);

    const result = await exportJudgments(campaignId, 'json');

    // Must be valid JSON
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);

    const j1Record = parsed.find((r) => r['judgment_id'] === j1.id);
    expect(j1Record).toBeDefined();
    expect(j1Record!['left_response_id']).toBe(leftId);
    expect(j1Record!['right_response_id']).toBe(rightId);
    expect(j1Record!['outcome']).toBe('left');
    expect(j1Record!['preferred_response_id']).toBe(leftId);
    expect(j1Record!['time_to_first_action_ms']).toBe(1200);
    expect(j1Record!['total_duration_ms']).toBe(4500);

    const j2Record = parsed.find((r) => r['judgment_id'] === j2.id);
    expect(j2Record).toBeDefined();
    expect(j2Record!['rewrite_response_id']).toBe(rewriteId);
    expect(j2Record!['rewrite_forked_from']).toBe('left');
  });

  it('exportJudgments csv — has header row + N data rows', async () => {
    const userId = await seedUser('j-csv-02');
    const { caseVersionId, suiteId } = await seedSuiteAndCaseVersion('j-csv-02');

    const { suiteVersions } = await import('@/db/schema');
    const [svRow] = await db
      .insert(suiteVersions)
      .values({
        suiteId,
        version: 1,
        rubricJson: {},
        weightingJson: {},
      })
      .returning({ id: suiteVersions.id });

    const campaignId = await seedCampaign(svRow.id);

    const leftId = await seedResponse(caseVersionId, 'csv-left-02');
    const rightId = await seedResponse(caseVersionId, 'csv-right-02');

    const [comp] = await db
      .insert(comparisons)
      .values({
        campaignId,
        caseVersionId,
        responseOneId: leftId,
        responseTwoId: rightId,
      })
      .returning({ id: comparisons.id });
    createdIds.comparisonIds.push(comp.id);

    const [asgn] = await db
      .insert(assignments)
      .values({
        comparisonId: comp.id,
        assignedUserId: userId,
        leftResponseId: leftId,
        rightResponseId: rightId,
      })
      .returning({ id: assignments.id });
    createdIds.assignmentIds.push(asgn.id);

    const [j1] = await db
      .insert(judgments)
      .values({ assignmentId: asgn.id, userId, outcome: 'right', preferredResponseId: rightId })
      .returning({ id: judgments.id });
    createdIds.judgmentIds.push(j1.id);

    const [j2] = await db
      .insert(judgments)
      .values({ assignmentId: asgn.id, userId, outcome: 'tie' })
      .returning({ id: judgments.id });
    createdIds.judgmentIds.push(j2.id);

    const [j3] = await db
      .insert(judgments)
      .values({ assignmentId: asgn.id, userId, outcome: 'left', preferredResponseId: leftId })
      .returning({ id: judgments.id });
    createdIds.judgmentIds.push(j3.id);

    const result = await exportJudgments(campaignId, 'csv');
    const lines = result.split('\n').filter((l) => l.trim().length > 0);

    // Header row
    expect(lines[0]).toContain('judgment_id');
    expect(lines[0]).toContain('left_response_id');
    expect(lines[0]).toContain('right_response_id');
    expect(lines[0]).toContain('outcome');

    // 3 data rows
    expect(lines.length).toBe(4); // 1 header + 3 data
  });

  it('listCases — returns seeded case version rows', async () => {
    const { caseVersionId } = await seedSuiteAndCaseVersion('lc-03');

    const results = await listCases();
    const found = results.find((r) => r.case_version_id === caseVersionId);

    expect(found).toBeDefined();
    expect(found!.kind).toBe('compression');
    expect(found!.title).toBe('Export Case lc-03');
    expect(found!.tags).toEqual(['tag-a', 'tag-b']);
    expect(found!.dataset_split).toBe('test');
    expect(found!.external_ref).toBe('ext-ref-lc-03');
  });

  it('listCompetitorVersions — returns seeded competitor version rows', async () => {
    const { competitorVersionId, competitorId } = await seedCompetitorVersion('lcv-04');

    const results = await listCompetitorVersions();
    const found = results.find((r) => r.competitor_version_id === competitorVersionId);

    expect(found).toBeDefined();
    expect(found!.name).toBe('Export Competitor lcv-04');
    expect(found!.version).toBe(1);
    expect(found!.model_identifier).toBe('fake-model-lcv-04');
    expect(found!.source_type).toBe('manual');
    expect(found!.parent_competitor_version_id).toBeNull();

    // Verify competitorId tracked
    expect(createdIds.competitorIds).toContain(competitorId);
  });
});
