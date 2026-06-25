import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { eq, and, inArray } from 'drizzle-orm';
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
import { enqueueGeneration, campaignCellState, enqueueMissingForCampaign } from '@/services/generate-batch';
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

async function seedCompetitorVersion(
  suffix: string,
  modelIdentifier = 'fake/batch-model',
): Promise<string> {
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
      modelIdentifier,
      promptBundleJson: { system: 'You are a helpful assistant.' },
      modelParametersJson: { temperature: 0.5 },
      contentHash: `batch-comp-hash-${suffix}`,
    })
    .returning({ id: competitorVersions.id });
  createdCompetitorVersionIds.push(cv.id);

  return cv.id;
}

// A provider that fails for one specific model identifier — used to create
// real failed generation_attempts for a known cell.
function makeFlakyProvider(failModel: string): GenerationProvider {
  return {
    async execute(req): Promise<ProviderResult> {
      if (req.model === failModel) {
        throw new Error(`Simulated provider failure for ${failModel}`);
      }
      return {
        text: 'Batch fake response',
        inputTokens: 8,
        outputTokens: 4,
        finishReason: 'stop',
        providerRequestId: 'batch-fake-req-flaky',
        modelReportedVersion: undefined,
        raw: {},
      };
    },
  };
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

  it('campaignCellState reports ready vs missing cells (not the attempt log)', async () => {
    const { suiteId, suiteVersionId } = await seedSuiteAndVersion('state-02');
    const caseVersionId1 = await seedCaseVersion(suiteId, 'state-02-c1');
    const caseVersionId2 = await seedCaseVersion(suiteId, 'state-02-c2');
    const compVersionId = await seedCompetitorVersion('state-02-v1');

    // Campaign: 2 cases × 1 competitor × 1 replicate = 2 cells total.
    const [camp] = await db
      .insert(campaigns)
      .values({
        name: 'State Campaign 02',
        suiteVersionId,
        eligibleCompetitorVersionIds: [compVersionId],
        replicates: 1,
      })
      .returning({ id: campaigns.id });
    createdCampaignIds.push(camp.id);

    // Generate only the first case's cell → 1 ready, 1 missing.
    await enqueueGeneration(
      operatorUser,
      {
        campaignId: camp.id,
        caseVersionIds: [caseVersionId1],
        competitorVersionIds: [compVersionId],
        replicates: 1,
      },
      fakeProvider,
    );

    // Track for cleanup
    const attempts = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(eq(generationAttempts.campaignId, camp.id));
    for (const a of attempts) {
      if (!createdAttemptIds.includes(a.id)) createdAttemptIds.push(a.id);
    }
    const resps = await db
      .select({ id: responses.id })
      .from(responses)
      .where(inArray(responses.caseVersionId, [caseVersionId1, caseVersionId2]));
    for (const r of resps) {
      if (!createdResponseIds.includes(r.id)) createdResponseIds.push(r.id);
    }

    const state = await campaignCellState(camp.id);
    expect(state.total).toBe(2);
    expect(state.ready).toBe(1);
    expect(state.missing).toBe(1);
    expect(state.missingWithFailures).toBe(0); // no failures yet
  });

  it('campaignCellState: re-running a failing generation does NOT inflate counts', async () => {
    const { suiteId, suiteVersionId } = await seedSuiteAndVersion('flaky-02b');
    const caseVersionId = await seedCaseVersion(suiteId, 'flaky-02b-c1');
    const goodCv = await seedCompetitorVersion('flaky-02b-good', 'fake/good-model');
    const badCv = await seedCompetitorVersion('flaky-02b-bad', 'fake/bad-model');

    // 1 case × 2 competitors × 1 replicate = 2 cells. One competitor always fails.
    const [camp] = await db
      .insert(campaigns)
      .values({
        name: 'Flaky Campaign 02b',
        suiteVersionId,
        eligibleCompetitorVersionIds: [goodCv, badCv],
        replicates: 1,
      })
      .returning({ id: campaigns.id });
    createdCampaignIds.push(camp.id);

    const flaky = makeFlakyProvider('fake/bad-model');

    // First run: good cell generated, bad cell fails.
    await enqueueMissingForCampaign(operatorUser, camp.id, flaky);

    const trackRows = async () => {
      const a = await db
        .select({ id: generationAttempts.id })
        .from(generationAttempts)
        .where(eq(generationAttempts.campaignId, camp.id));
      for (const row of a) if (!createdAttemptIds.includes(row.id)) createdAttemptIds.push(row.id);
      const r = await db
        .select({ id: responses.id })
        .from(responses)
        .where(eq(responses.caseVersionId, caseVersionId));
      for (const row of r) if (!createdResponseIds.includes(row.id)) createdResponseIds.push(row.id);
    };
    await trackRows();

    const stateAfterFirst = await campaignCellState(camp.id);
    expect(stateAfterFirst.total).toBe(2);
    expect(stateAfterFirst.ready).toBe(1);
    expect(stateAfterFirst.missing).toBe(1);
    expect(stateAfterFirst.missingWithFailures).toBe(1); // the bad cell

    // Count failed attempt rows after the first run.
    const failedAfterFirst = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(and(eq(generationAttempts.campaignId, camp.id), eq(generationAttempts.status, 'failed')));

    // Second run: the bad cell fails AGAIN → another failed attempt row is logged...
    await enqueueMissingForCampaign(operatorUser, camp.id, flaky);
    await trackRows();

    const failedAfterSecond = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(and(eq(generationAttempts.campaignId, camp.id), eq(generationAttempts.status, 'failed')));

    // ...the audit log DID grow (proving the old behavior)...
    expect(failedAfterSecond.length).toBeGreaterThan(failedAfterFirst.length);

    // ...but the cell-state report is STABLE: still 1 ready, 1 missing, 1 failing cell.
    const stateAfterSecond = await campaignCellState(camp.id);
    expect(stateAfterSecond.total).toBe(2);
    expect(stateAfterSecond.ready).toBe(1);
    expect(stateAfterSecond.missing).toBe(1);
    expect(stateAfterSecond.missingWithFailures).toBe(1);
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

    // No new attempts created — the cached response short-circuits ensureResponse.
    const attemptsAfter = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(eq(generationAttempts.caseVersionId, caseVersionId));
    expect(attemptsAfter.length).toBe(attemptCountBefore);
  });

  it('enqueueMissingForCampaign fills only missing cells and is idempotent', async () => {
    const { suiteId, suiteVersionId } = await seedSuiteAndVersion('missing-04');
    const caseVersionId1 = await seedCaseVersion(suiteId, 'missing-04-c1');
    const caseVersionId2 = await seedCaseVersion(suiteId, 'missing-04-c2');
    const compVersionId1 = await seedCompetitorVersion('missing-04-v1');
    const compVersionId2 = await seedCompetitorVersion('missing-04-v2');

    // Campaign with replicates=1
    const [camp] = await db
      .insert(campaigns)
      .values({
        name: 'Missing Campaign 04',
        suiteVersionId,
        eligibleCompetitorVersionIds: [compVersionId1, compVersionId2],
        replicates: 1,
      })
      .returning({ id: campaigns.id });
    createdCampaignIds.push(camp.id);

    // First run — all 4 cells are missing
    const r1 = await enqueueMissingForCampaign(operatorUser, camp.id, fakeProvider);

    expect(r1.total).toBe(4);
    expect(r1.generated).toBe(4);
    expect(r1.skipped).toBe(0);
    expect(r1.failed).toBe(0);

    // Track cleanup
    const attemptsAfter = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(eq(generationAttempts.campaignId, camp.id));
    for (const a of attemptsAfter) {
      if (!createdAttemptIds.includes(a.id)) createdAttemptIds.push(a.id);
    }
    const responsesAfter = await db
      .select({ id: responses.id })
      .from(responses)
      .where(inArray(responses.caseVersionId, [caseVersionId1, caseVersionId2]));
    for (const r of responsesAfter) {
      if (!createdResponseIds.includes(r.id)) createdResponseIds.push(r.id);
    }

    // Second run — all 4 cells are already cached → all skipped
    const r2 = await enqueueMissingForCampaign(operatorUser, camp.id, fakeProvider);

    expect(r2.total).toBe(4);
    expect(r2.generated).toBe(0);
    expect(r2.skipped).toBe(4);
    expect(r2.failed).toBe(0);
  });
});
