import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  suites,
  cases,
  caseVersions,
  competitors,
  competitorVersions,
  generationAttempts,
  responses,
} from '@/db/schema';
import { ensureResponse } from '@/services/generation/runner';
import type { GenerationProvider, ProviderResult } from '@/services/generation/provider';

// ---- Fake providers ----

const fakeProvider: GenerationProvider = {
  async execute(): Promise<ProviderResult> {
    return {
      text: 'Hello from fake provider',
      inputTokens: 10,
      outputTokens: 5,
      finishReason: 'stop',
      providerRequestId: 'fake-req-001',
      modelReportedVersion: undefined,
      raw: {},
    };
  },
};

function makeFailingProvider(message: string): GenerationProvider {
  return {
    async execute(): Promise<ProviderResult> {
      throw new Error(message);
    },
  };
}

// ---- Test IDs for cleanup ----
const createdSuiteIds: string[] = [];
const createdCaseIds: string[] = [];
const createdCaseVersionIds: string[] = [];
const createdCompetitorIds: string[] = [];
const createdCompetitorVersionIds: string[] = [];
const createdAttemptIds: string[] = [];
const createdResponseIds: string[] = [];

afterAll(async () => {
  // Clean up in FK-safe order (most dependent first)
  if (createdResponseIds.length > 0) {
    for (const id of createdResponseIds) {
      await db.delete(responses).where(eq(responses.id, id)).catch(() => undefined);
    }
  }
  if (createdAttemptIds.length > 0) {
    for (const id of createdAttemptIds) {
      await db.delete(generationAttempts).where(eq(generationAttempts.id, id)).catch(() => undefined);
    }
  }
  if (createdCompetitorVersionIds.length > 0) {
    for (const id of createdCompetitorVersionIds) {
      await db.delete(competitorVersions).where(eq(competitorVersions.id, id)).catch(() => undefined);
    }
  }
  if (createdCompetitorIds.length > 0) {
    for (const id of createdCompetitorIds) {
      await db.delete(competitors).where(eq(competitors.id, id)).catch(() => undefined);
    }
  }
  if (createdCaseVersionIds.length > 0) {
    for (const id of createdCaseVersionIds) {
      await db.delete(caseVersions).where(eq(caseVersions.id, id)).catch(() => undefined);
    }
  }
  if (createdCaseIds.length > 0) {
    for (const id of createdCaseIds) {
      await db.delete(cases).where(eq(cases.id, id)).catch(() => undefined);
    }
  }
  if (createdSuiteIds.length > 0) {
    for (const id of createdSuiteIds) {
      await db.delete(suites).where(eq(suites.id, id)).catch(() => undefined);
    }
  }
  await pool.end();
});

// ---- Seed helpers ----

async function seedCaseVersion(suffix: string) {
  const [suite] = await db
    .insert(suites)
    .values({ name: `Test Suite ${suffix}` })
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
      title: `Test Case ${suffix}`,
      outputSpecJson: {},
      runnerInputJson: { user: 'Summarise this text in one sentence.' },
      evaluatorContextJson: {},
      contentHash: `case-hash-gen-${suffix}`,
    })
    .returning({ id: caseVersions.id });
  createdCaseVersionIds.push(cv.id);

  return cv.id;
}

async function seedCompetitorVersion(suffix: string) {
  const [comp] = await db
    .insert(competitors)
    .values({ name: `Test Competitor ${suffix}`, competitorType: 'model_runner' })
    .returning({ id: competitors.id });
  createdCompetitorIds.push(comp.id);

  const [cv] = await db
    .insert(competitorVersions)
    .values({
      competitorId: comp.id,
      version: 1,
      modelIdentifier: 'fake/model',
      promptBundleJson: { system: 'You are a helpful assistant.' },
      modelParametersJson: { temperature: 0.7 },
      contentHash: `comp-hash-gen-${suffix}`,
    })
    .returning({ id: competitorVersions.id });
  createdCompetitorVersionIds.push(cv.id);

  return cv.id;
}

// ---- Tests ----

describe('generation runner integration', () => {
  it('writes exactly one attempt and one response on success', async () => {
    const caseVersionId = await seedCaseVersion('success-01');
    const competitorVersionId = await seedCompetitorVersion('success-01');

    const { responseId } = await ensureResponse(
      caseVersionId,
      competitorVersionId,
      0,
      undefined,
      fakeProvider,
    );

    expect(responseId).toBeTruthy();
    createdResponseIds.push(responseId);

    // Verify one response row
    const respRows = await db
      .select()
      .from(responses)
      .where(
        and(
          eq(responses.caseVersionId, caseVersionId),
          eq(responses.competitorVersionId, competitorVersionId),
          eq(responses.replicateIndex, 0),
          eq(responses.originType, 'model_generation'),
        ),
      );
    expect(respRows).toHaveLength(1);
    expect(respRows[0].id).toBe(responseId);
    expect(respRows[0].bodyText).toBe('Hello from fake provider');
    expect(respRows[0].lengthChars).toBe('Hello from fake provider'.length);
    expect(respRows[0].lengthTokens).toBe(5);
    expect(respRows[0].contentHash).toBeTruthy();

    // Verify one attempt row with status 'succeeded'
    const attemptRows = await db
      .select()
      .from(generationAttempts)
      .where(
        and(
          eq(generationAttempts.caseVersionId, caseVersionId),
          eq(generationAttempts.competitorVersionId, competitorVersionId),
          eq(generationAttempts.replicateIndex, 0),
        ),
      );
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0].status).toBe('succeeded');
    expect(attemptRows[0].inputTokens).toBe(10);
    expect(attemptRows[0].outputTokens).toBe(5);
    expect(attemptRows[0].finishReason).toBe('stop');
    createdAttemptIds.push(attemptRows[0].id);
  });

  it('is idempotent — second call returns the same responseId and creates no second attempt', async () => {
    const caseVersionId = await seedCaseVersion('idempotent-02');
    const competitorVersionId = await seedCompetitorVersion('idempotent-02');

    const first = await ensureResponse(
      caseVersionId,
      competitorVersionId,
      0,
      undefined,
      fakeProvider,
    );
    createdResponseIds.push(first.responseId);

    // Collect the attempt created by the first call
    const firstAttempts = await db
      .select()
      .from(generationAttempts)
      .where(
        and(
          eq(generationAttempts.caseVersionId, caseVersionId),
          eq(generationAttempts.competitorVersionId, competitorVersionId),
        ),
      );
    for (const a of firstAttempts) createdAttemptIds.push(a.id);

    // Second call — should hit cache
    const second = await ensureResponse(
      caseVersionId,
      competitorVersionId,
      0,
      undefined,
      fakeProvider,
    );

    expect(second.responseId).toBe(first.responseId);

    // Still only one attempt
    const allAttempts = await db
      .select()
      .from(generationAttempts)
      .where(
        and(
          eq(generationAttempts.caseVersionId, caseVersionId),
          eq(generationAttempts.competitorVersionId, competitorVersionId),
        ),
      );
    expect(allAttempts).toHaveLength(1);
  });

  it('marks attempt failed and writes no response when provider throws', async () => {
    const caseVersionId = await seedCaseVersion('fail-03');
    const competitorVersionId = await seedCompetitorVersion('fail-03');

    const failingProvider = makeFailingProvider('provider exploded');

    await expect(
      ensureResponse(caseVersionId, competitorVersionId, 0, undefined, failingProvider),
    ).rejects.toThrow('provider exploded');

    // No response should exist
    const respRows = await db
      .select()
      .from(responses)
      .where(
        and(
          eq(responses.caseVersionId, caseVersionId),
          eq(responses.competitorVersionId, competitorVersionId),
          eq(responses.replicateIndex, 0),
          eq(responses.originType, 'model_generation'),
        ),
      );
    expect(respRows).toHaveLength(0);

    // One attempt with status 'failed'
    const attemptRows = await db
      .select()
      .from(generationAttempts)
      .where(
        and(
          eq(generationAttempts.caseVersionId, caseVersionId),
          eq(generationAttempts.competitorVersionId, competitorVersionId),
          eq(generationAttempts.replicateIndex, 0),
        ),
      );
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0].status).toBe('failed');
    expect(attemptRows[0].errorCode).toContain('provider exploded');
    createdAttemptIds.push(attemptRows[0].id);
  });
});
