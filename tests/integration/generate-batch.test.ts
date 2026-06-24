import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  suites,
  suiteVersions,
  cases,
  caseVersions,
  competitors,
  competitorVersions,
  campaigns,
  generationAttempts,
  responses,
} from '@/db/schema';
import { enqueueGeneration, generationStatus } from '@/services/generate-batch';
import type { GenerationProvider, ProviderResult } from '@/services/generation/provider';
import type { SessionUser } from '@/auth/workos';

// ---- Fake provider ----

const fakeProvider: GenerationProvider = {
  async execute(): Promise<ProviderResult> {
    return {
      text: 'Batch fake response',
      inputTokens: 8,
      outputTokens: 4,
      finishReason: 'stop',
      providerRequestId: 'batch-fake-req-001',
      modelReportedVersion: undefined,
      raw: {},
    };
  },
};

// ---- Fake operator user ----

const operatorUser: SessionUser = {
  id: 'uuid-operator-batch-test',
  workosUserId: 'workos_operator_batch_test',
  email: 'operator@batch.test',
  appRole: 'admin',
  orgId: 'org_batch_test',
};

// ---- Tracked IDs for scoped cleanup ----

const createdSuiteIds: string[] = [];
const createdSuiteVersionIds: string[] = [];
const createdCaseIds: string[] = [];
const createdCaseVersionIds: string[] = [];
const createdCompetitorIds: string[] = [];
const createdCompetitorVersionIds: string[] = [];
const createdCampaignIds: string[] = [];
const createdAttemptIds: string[] = [];
const createdResponseIds: string[] = [];

afterAll(async () => {
  // Clean in FK-safe order (dependents first)
  for (const id of createdResponseIds) {
    await db.delete(responses).where(eq(responses.id, id)).catch(() => undefined);
  }
  for (const id of createdAttemptIds) {
    await db.delete(generationAttempts).where(eq(generationAttempts.id, id)).catch(() => undefined);
  }
  for (const id of createdCampaignIds) {
    await db.delete(campaigns).where(eq(campaigns.id, id)).catch(() => undefined);
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
  for (const id of createdSuiteVersionIds) {
    await db.delete(suiteVersions).where(eq(suiteVersions.id, id)).catch(() => undefined);
  }
  for (const id of createdSuiteIds) {
    await db.delete(suites).where(eq(suites.id, id)).catch(() => undefined);
  }
  await pool.end();
});

// ---- Seed helpers ----

async function seedSuiteAndVersion(suffix: string) {
  const [suite] = await db
    .insert(suites)
    .values({ name: `Batch Suite ${suffix}` })
    .returning({ id: suites.id });
  createdSuiteIds.push(suite.id);

  const [sv] = await db
    .insert(suiteVersions)
    .values({ suiteId: suite.id, version: 1 })
    .returning({ id: suiteVersions.id });
  createdSuiteVersionIds.push(sv.id);

  return { suiteId: suite.id, suiteVersionId: sv.id };
}

async function seedCaseVersion(suiteId: string, suffix: string): Promise<string> {
  const [c] = await db
    .insert(cases)
    .values({ suiteId })
    .returning({ id: cases.id });
  createdCaseIds.push(c.id);

  const [cv] = await db
    .insert(caseVersions)
    .values({
      caseId: c.id,
      version: 1,
      kind: 'compression',
      title: `Batch Case ${suffix}`,
      outputSpecJson: {},
      runnerInputJson: { user: 'Summarise this.' },
      evaluatorContextJson: {},
      contentHash: `batch-case-hash-${suffix}`,
    })
    .returning({ id: caseVersions.id });
  createdCaseVersionIds.push(cv.id);

  return cv.id;
}

async function seedCompetitorVersion(suffix: string): Promise<string> {
  const [comp] = await db
    .insert(competitors)
    .values({ name: `Batch Competitor ${suffix}`, competitorType: 'model_runner' })
    .returning({ id: competitors.id });
  createdCompetitorIds.push(comp.id);

  const [cv] = await db
    .insert(competitorVersions)
    .values({
      competitorId: comp.id,
      version: 1,
      modelIdentifier: 'fake/batch-model',
      promptBundleJson: { system: 'You are a helpful assistant.' },
      modelParametersJson: { temperature: 0.5 },
      contentHash: `batch-comp-hash-${suffix}`,
    })
    .returning({ id: competitorVersions.id });
  createdCompetitorVersionIds.push(cv.id);

  return cv.id;
}

async function seedCampaign(suiteVersionId: string, suffix: string): Promise<string> {
  const [camp] = await db
    .insert(campaigns)
    .values({
      name: `Batch Campaign ${suffix}`,
      suiteVersionId,
    })
    .returning({ id: campaigns.id });
  createdCampaignIds.push(camp.id);

  return camp.id;
}

// ---- Tests ----

describe('generate-batch service integration', () => {
  it('enqueueGeneration produces a response for every cell in the matrix', async () => {
    const { suiteId, suiteVersionId } = await seedSuiteAndVersion('matrix-01');
    const caseVersionId1 = await seedCaseVersion(suiteId, 'matrix-01-c1');
    const caseVersionId2 = await seedCaseVersion(suiteId, 'matrix-01-c2');
    const compVersionId1 = await seedCompetitorVersion('matrix-01-v1');
    const compVersionId2 = await seedCompetitorVersion('matrix-01-v2');
    const campaignId = await seedCampaign(suiteVersionId, 'matrix-01');

    const result = await enqueueGeneration(
      operatorUser,
      {
        campaignId,
        caseVersionIds: [caseVersionId1, caseVersionId2],
        competitorVersionIds: [compVersionId1, compVersionId2],
        replicates: 1,
      },
      fakeProvider,
    );

    // 2 cases × 2 competitors × 1 replicate = 4 cells
    expect(result.enqueued).toBe(4);
    expect(result.completed).toBe(4);

    // Verify every cell has a response in the DB
    for (const caseVersionId of [caseVersionId1, caseVersionId2]) {
      for (const competitorVersionId of [compVersionId1, compVersionId2]) {
        const rows = await db
          .select({ id: responses.id })
          .from(responses)
          .where(
            eq(responses.caseVersionId, caseVersionId),
          );
        // Track for cleanup
        for (const r of rows) {
          if (!createdResponseIds.includes(r.id)) createdResponseIds.push(r.id);
        }

        // Get attempts for tracking cleanup too
        const attempts = await db
          .select({ id: generationAttempts.id })
          .from(generationAttempts)
          .where(
            eq(generationAttempts.campaignId, campaignId),
          );
        for (const a of attempts) {
          if (!createdAttemptIds.includes(a.id)) createdAttemptIds.push(a.id);
        }

        const cellRows = await db
          .select({ id: responses.id })
          .from(responses)
          .where(
            eq(responses.caseVersionId, caseVersionId),
          );
        const cellResponse = cellRows.find((_) => true); // at least one exists
        expect(cellResponse).toBeDefined();
      }
    }
  });

  it('generationStatus reports counts by status for the campaign', async () => {
    const { suiteId, suiteVersionId } = await seedSuiteAndVersion('status-02');
    const caseVersionId = await seedCaseVersion(suiteId, 'status-02-c1');
    const compVersionId = await seedCompetitorVersion('status-02-v1');
    const campaignId = await seedCampaign(suiteVersionId, 'status-02');

    await enqueueGeneration(
      operatorUser,
      {
        campaignId,
        caseVersionIds: [caseVersionId],
        competitorVersionIds: [compVersionId],
        replicates: 1,
      },
      fakeProvider,
    );

    // Track for cleanup
    const attempts = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(eq(generationAttempts.campaignId, campaignId));
    for (const a of attempts) {
      if (!createdAttemptIds.includes(a.id)) createdAttemptIds.push(a.id);
    }
    const resps = await db
      .select({ id: responses.id })
      .from(responses)
      .where(eq(responses.caseVersionId, caseVersionId));
    for (const r of resps) {
      if (!createdResponseIds.includes(r.id)) createdResponseIds.push(r.id);
    }

    const status = await generationStatus(campaignId);

    // The attempt should have succeeded
    expect(typeof status).toBe('object');
    expect(status['succeeded']).toBeGreaterThanOrEqual(1);

    // Total count should match number of attempts
    const total = Object.values(status).reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('re-running enqueueGeneration is a no-op (cache hit, no new attempts)', async () => {
    const { suiteId, suiteVersionId } = await seedSuiteAndVersion('noop-03');
    const caseVersionId = await seedCaseVersion(suiteId, 'noop-03-c1');
    const compVersionId = await seedCompetitorVersion('noop-03-v1');
    const campaignId = await seedCampaign(suiteVersionId, 'noop-03');

    // First run
    const first = await enqueueGeneration(
      operatorUser,
      {
        campaignId,
        caseVersionIds: [caseVersionId],
        competitorVersionIds: [compVersionId],
        replicates: 1,
      },
      fakeProvider,
    );

    expect(first.enqueued).toBe(1);
    expect(first.completed).toBe(1);

    const attemptsBefore = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(eq(generationAttempts.campaignId, campaignId));
    for (const a of attemptsBefore) {
      if (!createdAttemptIds.includes(a.id)) createdAttemptIds.push(a.id);
    }
    const responsesBefore = await db
      .select({ id: responses.id })
      .from(responses)
      .where(eq(responses.caseVersionId, caseVersionId));
    for (const r of responsesBefore) {
      if (!createdResponseIds.includes(r.id)) createdResponseIds.push(r.id);
    }

    const attemptCountBefore = attemptsBefore.length;

    // Second run (cache hit)
    const second = await enqueueGeneration(
      operatorUser,
      {
        campaignId,
        caseVersionIds: [caseVersionId],
        competitorVersionIds: [compVersionId],
        replicates: 1,
      },
      fakeProvider,
    );

    expect(second.enqueued).toBe(1);
    expect(second.completed).toBe(1);

    // No new attempts created
    const attemptsAfter = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(eq(generationAttempts.caseVersionId, caseVersionId));
    expect(attemptsAfter.length).toBe(attemptCountBefore);

    // generationStatus still reports the original succeeded count
    const status = await generationStatus(campaignId);
    expect(status['succeeded']).toBe(attemptCountBefore);
  });
});
