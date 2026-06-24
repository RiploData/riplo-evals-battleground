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
  responses,
  comparisons,
  assignments,
  generationAttempts,
} from '@/db/schema';
import { getNextBattle } from '@/services/battle';
import type { SessionUser } from '@/auth/workos';
import type { GenerationProvider, ProviderResult } from '@/services/generation/providers/openrouter';

// ---------------------------------------------------------------------------
// Fake provider — no network calls
// ---------------------------------------------------------------------------

let fakeResponseCounter = 0;

const fakeProvider: GenerationProvider = {
  async execute(): Promise<ProviderResult> {
    fakeResponseCounter++;
    return {
      text: `Fake response body #${fakeResponseCounter}`,
      inputTokens: 10,
      outputTokens: 5,
      finishReason: 'stop',
      providerRequestId: `fake-req-${fakeResponseCounter}`,
      modelReportedVersion: undefined,
      raw: {},
    };
  },
};

// ---------------------------------------------------------------------------
// Cleanup tracking (FK-safe teardown order)
// ---------------------------------------------------------------------------

const cleanup = {
  assignmentIds: [] as string[],
  comparisonIds: [] as string[],
  responseIds: [] as string[],
  generationAttemptIds: [] as string[],
  campaignIds: [] as string[],
  competitorVersionIds: [] as string[],
  competitorIds: [] as string[],
  caseVersionIds: [] as string[],
  caseIds: [] as string[],
  suiteVersionIds: [] as string[],
  suiteIds: [] as string[],
  userIds: [] as string[],
};

afterAll(async () => {
  // Most-dependent first
  if (cleanup.assignmentIds.length) {
    for (const id of cleanup.assignmentIds) {
      await db.delete(assignments).where(eq(assignments.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.comparisonIds.length) {
    for (const id of cleanup.comparisonIds) {
      await db.delete(comparisons).where(eq(comparisons.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.responseIds.length) {
    for (const id of cleanup.responseIds) {
      await db.delete(responses).where(eq(responses.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.generationAttemptIds.length) {
    for (const id of cleanup.generationAttemptIds) {
      await db.delete(generationAttempts).where(eq(generationAttempts.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.campaignIds.length) {
    for (const id of cleanup.campaignIds) {
      await db.delete(campaigns).where(eq(campaigns.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.competitorVersionIds.length) {
    for (const id of cleanup.competitorVersionIds) {
      await db.delete(competitorVersions).where(eq(competitorVersions.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.competitorIds.length) {
    for (const id of cleanup.competitorIds) {
      await db.delete(competitors).where(eq(competitors.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.caseVersionIds.length) {
    for (const id of cleanup.caseVersionIds) {
      await db.delete(caseVersions).where(eq(caseVersions.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.caseIds.length) {
    for (const id of cleanup.caseIds) {
      await db.delete(cases).where(eq(cases.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.suiteVersionIds.length) {
    for (const id of cleanup.suiteVersionIds) {
      await db.delete(suiteVersions).where(eq(suiteVersions.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.suiteIds.length) {
    for (const id of cleanup.suiteIds) {
      await db.delete(suites).where(eq(suites.id, id)).catch(() => undefined);
    }
  }
  if (cleanup.userIds.length) {
    for (const id of cleanup.userIds) {
      await db.delete(users).where(eq(users.id, id)).catch(() => undefined);
    }
  }
  await pool.end();
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedUser(suffix: string): Promise<SessionUser> {
  const workosUserId = `battle-test-workos-${suffix}`;
  // Resilient to leftover rows from a previously aborted run (fixed workos id).
  await db.delete(users).where(eq(users.workosUserId, workosUserId)).catch(() => undefined);
  const [row] = await db
    .insert(users)
    .values({
      workosUserId,
      email: `battle-test-${suffix}@example.com`,
      appRole: 'member',
      orgId: 'test-org',
    })
    .returning();
  cleanup.userIds.push(row.id);
  return {
    id: row.id,
    workosUserId: row.workosUserId,
    email: row.email,
    appRole: row.appRole as 'member',
    orgId: row.orgId,
  };
}

interface SeedResult {
  suiteId: string;
  suiteVersionId: string;
  caseId: string;
  caseVersionId: string;
  compAId: string;
  compAVersionId: string;
  compBId: string;
  compBVersionId: string;
  campaignId: string;
}

async function seedBattleFixture(suffix: string): Promise<SeedResult> {
  // Suite
  const [suite] = await db
    .insert(suites)
    .values({ name: `Battle Suite ${suffix}` })
    .returning({ id: suites.id });
  cleanup.suiteIds.push(suite.id);

  // Suite version
  const [sv] = await db
    .insert(suiteVersions)
    .values({ suiteId: suite.id, version: 1 })
    .returning({ id: suiteVersions.id });
  cleanup.suiteVersionIds.push(sv.id);

  // Case
  const [c] = await db
    .insert(cases)
    .values({ suiteId: suite.id, externalRef: `case-ref-${suffix}` })
    .returning({ id: cases.id });
  cleanup.caseIds.push(c.id);

  // Case version
  const [cv] = await db
    .insert(caseVersions)
    .values({
      caseId: c.id,
      version: 1,
      kind: 'compression',
      title: `Battle Case ${suffix}`,
      guidance: 'Rate carefully.',
      outputSpecJson: { target: 'text', parts: [{ type: 'text', label: 'Response' }] },
      runnerInputJson: { user: 'Summarise in one sentence.' },
      evaluatorContextJson: {
        title: `Evaluator Title ${suffix}`,
        guidance: 'Evaluator guidance here.',
        output_spec: { target: 'text', parts: [{ type: 'text', label: 'Response' }] },
        source_blocks: [{ type: 'text', text: 'Source text here.' }],
      },
      sourceBlocksJson: [{ type: 'text', text: 'Source text here.' }],
      contentHash: `battle-case-hash-${suffix}`,
      tags: ['tag-a'],
    })
    .returning({ id: caseVersions.id });
  cleanup.caseVersionIds.push(cv.id);

  // Competitor A
  const [compA] = await db
    .insert(competitors)
    .values({ name: `Competitor A ${suffix}`, competitorType: 'model_runner' })
    .returning({ id: competitors.id });
  cleanup.competitorIds.push(compA.id);

  const [cvA] = await db
    .insert(competitorVersions)
    .values({
      competitorId: compA.id,
      version: 1,
      modelIdentifier: 'fake/model-a',
      promptBundleJson: { system: 'You are model A.' },
      modelParametersJson: {},
      contentHash: `comp-a-hash-${suffix}`,
    })
    .returning({ id: competitorVersions.id });
  cleanup.competitorVersionIds.push(cvA.id);

  // Competitor B
  const [compB] = await db
    .insert(competitors)
    .values({ name: `Competitor B ${suffix}`, competitorType: 'model_runner' })
    .returning({ id: competitors.id });
  cleanup.competitorIds.push(compB.id);

  const [cvB] = await db
    .insert(competitorVersions)
    .values({
      competitorId: compB.id,
      version: 1,
      modelIdentifier: 'fake/model-b',
      promptBundleJson: { system: 'You are model B.' },
      modelParametersJson: {},
      contentHash: `comp-b-hash-${suffix}`,
    })
    .returning({ id: competitorVersions.id });
  cleanup.competitorVersionIds.push(cvB.id);

  // Campaign (active — no endedAt)
  const [camp] = await db
    .insert(campaigns)
    .values({
      name: `Battle Campaign ${suffix}`,
      suiteVersionId: sv.id,
      eligibleCompetitorVersionIds: [cvA.id, cvB.id],
    })
    .returning({ id: campaigns.id });
  cleanup.campaignIds.push(camp.id);

  return {
    suiteId: suite.id,
    suiteVersionId: sv.id,
    caseId: c.id,
    caseVersionId: cv.id,
    compAId: compA.id,
    compAVersionId: cvA.id,
    compBId: compB.id,
    compBVersionId: cvB.id,
    campaignId: camp.id,
  };
}

// ---------------------------------------------------------------------------
// Banned provenance field names (blinding invariant)
// ---------------------------------------------------------------------------

const BANNED_FIELDS = [
  'competitor_version_id',
  'origin_type',
  'author_user_id',
  'length_chars',
  'length_tokens',
  'model_identifier',
  'prompt_bundle',
];

function assertNoProvenanceFields(options: unknown[]): void {
  const serialized = JSON.stringify(options);
  for (const banned of BANNED_FIELDS) {
    expect(serialized).not.toContain(banned);
  }
}

function allowedOptionKeys(option: Record<string, unknown>): string[] {
  return Object.keys(option).sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('battle service integration', () => {
  it('returns a payload with exactly 2 blinded options and creates an assignment row', async () => {
    const user = await seedUser('t1');
    const fixture = await seedBattleFixture('t1');

    const payload = await getNextBattle(user, { provider: fakeProvider, rng: Math.random });

    expect(payload).not.toBeNull();
    expect(payload!.ui_version).toBe('arena-1');
    expect(payload!.options).toHaveLength(2);
    expect(['A', 'B']).toContain(payload!.options[0].label);
    expect(payload!.options[0].label).toBe('A');
    expect(payload!.options[1].label).toBe('B');

    // Verify blinding — no provenance fields
    assertNoProvenanceFields(payload!.options);

    // Each option must have ONLY allowed keys: label, response_id, body_text (optionally body_json)
    for (const opt of payload!.options) {
      const keys = allowedOptionKeys(opt as unknown as Record<string, unknown>);
      const allowed = new Set(['label', 'response_id', 'body_text', 'body_json']);
      for (const k of keys) {
        expect(allowed.has(k)).toBe(true);
      }
    }

    // Verify task fields come from evaluatorContextJson
    expect(payload!.task.case_external_ref).toBe(`case-ref-t1`);
    expect(payload!.task.kind).toBe('compression');
    expect(payload!.task.title).toBe(`Evaluator Title t1`);

    // Verify an assignment row exists with both left and right response ids set
    const assignmentRows = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, payload!.assignment_id));

    expect(assignmentRows).toHaveLength(1);
    const assignment = assignmentRows[0];
    expect(assignment.leftResponseId).toBeTruthy();
    expect(assignment.rightResponseId).toBeTruthy();
    expect(assignment.uiVersion).toBe('arena-1');
    expect(assignment.assignedUserId).toBe(user.id);

    // Track for cleanup
    cleanup.assignmentIds.push(assignment.id);

    // Track comparison too
    const compRow = await db
      .select({ id: comparisons.id })
      .from(comparisons)
      .where(eq(comparisons.id, assignment.comparisonId));
    if (compRow[0]) cleanup.comparisonIds.push(compRow[0].id);

    // Track responses created
    const respRows = await db
      .select({ id: responses.id })
      .from(responses)
      .where(inArray(responses.competitorVersionId, [fixture.compAVersionId, fixture.compBVersionId]));
    for (const r of respRows) cleanup.responseIds.push(r.id);

    // Track generation attempts
    const attemptRows = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(eq(generationAttempts.caseVersionId, fixture.caseVersionId));
    for (const a of attemptRows) cleanup.generationAttemptIds.push(a.id);
  });

  it('randomised order is observed across different rng values', async () => {
    const user = await seedUser('t2');
    const fixture = await seedBattleFixture('t2');

    // Call with rng always returning < 0.5 (flip = true → compB is left)
    const payloadFlipped = await getNextBattle(user, {
      provider: fakeProvider,
      rng: () => 0.1, // first call (selectPair), second call (flip) — 0.1 < 0.5 → flip
    });

    // Track cleanup
    if (payloadFlipped) {
      cleanup.assignmentIds.push(payloadFlipped.assignment_id);
      const compRow = await db
        .select()
        .from(assignments)
        .where(eq(assignments.id, payloadFlipped.assignment_id));
      if (compRow[0]) cleanup.comparisonIds.push(compRow[0].comparisonId);
    }

    // Call with a second user and rng always returning >= 0.5 (no flip → compA is left)
    const user2 = await seedUser('t2b');
    const payloadNotFlipped = await getNextBattle(user2, {
      provider: fakeProvider,
      rng: () => 0.9, // first call (selectPair), second call (flip) — 0.9 >= 0.5 → no flip
    });

    if (payloadNotFlipped) {
      cleanup.assignmentIds.push(payloadNotFlipped.assignment_id);
      const compRow = await db
        .select()
        .from(assignments)
        .where(eq(assignments.id, payloadNotFlipped.assignment_id));
      if (compRow[0]) cleanup.comparisonIds.push(compRow[0].comparisonId);
    }

    expect(payloadFlipped).not.toBeNull();
    expect(payloadNotFlipped).not.toBeNull();

    // The left response ids should differ between flipped and not-flipped assignments
    const assignFlipped = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, payloadFlipped!.assignment_id));
    const assignNotFlipped = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, payloadNotFlipped!.assignment_id));

    // The left response id in one should equal the right response id in the other
    // (since the same pair is assigned, just flipped)
    expect(assignFlipped[0].leftResponseId).toBe(assignNotFlipped[0].rightResponseId);
    expect(assignFlipped[0].rightResponseId).toBe(assignNotFlipped[0].leftResponseId);

    // Track responses
    const respRows = await db
      .select({ id: responses.id })
      .from(responses)
      .where(inArray(responses.competitorVersionId, [fixture.compAVersionId, fixture.compBVersionId]));
    for (const r of respRows) {
      if (!cleanup.responseIds.includes(r.id)) cleanup.responseIds.push(r.id);
    }

    const attemptRows = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(eq(generationAttempts.caseVersionId, fixture.caseVersionId));
    for (const a of attemptRows) {
      if (!cleanup.generationAttemptIds.includes(a.id)) cleanup.generationAttemptIds.push(a.id);
    }
  });

  it('returns null (→204) when the only pair has already been seen by the user', async () => {
    const user = await seedUser('t3');
    const fixture = await seedBattleFixture('t3');

    // First call — should succeed
    const first = await getNextBattle(user, { provider: fakeProvider, rng: Math.random });
    expect(first).not.toBeNull();

    // Track cleanup for first call's rows
    if (first) {
      cleanup.assignmentIds.push(first.assignment_id);
      const assignRow = await db
        .select()
        .from(assignments)
        .where(eq(assignments.id, first.assignment_id));
      if (assignRow[0]) cleanup.comparisonIds.push(assignRow[0].comparisonId);
    }

    // Second call for the same user — the single pair is now in seenByUser → null
    const second = await getNextBattle(user, { provider: fakeProvider, rng: Math.random });
    expect(second).toBeNull();

    // Track responses
    const respRows = await db
      .select({ id: responses.id })
      .from(responses)
      .where(inArray(responses.competitorVersionId, [fixture.compAVersionId, fixture.compBVersionId]));
    for (const r of respRows) {
      if (!cleanup.responseIds.includes(r.id)) cleanup.responseIds.push(r.id);
    }

    const attemptRows = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(eq(generationAttempts.caseVersionId, fixture.caseVersionId));
    for (const a of attemptRows) {
      if (!cleanup.generationAttemptIds.includes(a.id)) cleanup.generationAttemptIds.push(a.id);
    }
  });
});
