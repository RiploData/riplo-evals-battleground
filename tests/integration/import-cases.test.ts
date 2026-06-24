import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';

import { db, pool } from '@/db/client';
import { suites, cases, caseVersions } from '@/db/schema';
import { validateCaseFile } from '@/corpus/case-schema';
import { importCases } from '@/corpus/import-cases';

// ── Fixture directory ─────────────────────────────────────────────────────────

const FIXTURE_DIR = join(
  new URL('../../tests/fixtures/cases', import.meta.url).pathname,
);

// Suite name that our fixture cases use — scoped for cleanup
const FIXTURE_SUITE_NAME = 'Fixture Suite v1';

// ── Cleanup helpers ───────────────────────────────────────────────────────────

/**
 * Delete only the rows created by our fixture suite, by name.
 * Cascades: case_versions → cases → suites.
 * Does NOT truncate globally.
 */
async function cleanupFixtureSuite(suiteName: string): Promise<void> {
  const suite = await db.query.suites.findFirst({
    where: eq(suites.name, suiteName),
  });
  if (!suite) return;

  // Get all cases in this suite
  const suiteCases = await db.query.cases.findMany({
    where: eq(cases.suiteId, suite.id),
  });

  // Delete case_versions for each case
  for (const c of suiteCases) {
    await db.delete(caseVersions).where(eq(caseVersions.caseId, c.id));
  }

  // Delete cases
  await db.delete(cases).where(eq(cases.suiteId, suite.id));

  // Delete suite
  await db.delete(suites).where(eq(suites.id, suite.id));
}

afterAll(async () => {
  await cleanupFixtureSuite(FIXTURE_SUITE_NAME);
  await pool.end();
});

// ── Schema validation tests ───────────────────────────────────────────────────

describe('validateCaseFile', () => {
  it('rejects a case file missing output_spec', () => {
    const bad = {
      kind: 'compression',
      title: 'Test case',
      runner_input: {},
      source_blocks: [],
      hidden_metadata: {},
      tags: [],
      dataset_split: 'dev',
      suite: 'Test Suite',
    };
    expect(() => validateCaseFile(bad)).toThrow();
  });

  it('rejects an invalid dataset_split value', () => {
    const bad = {
      kind: 'compression',
      title: 'Test case',
      output_spec: { target: 'IC one-pager', parts: [] },
      runner_input: {},
      source_blocks: [],
      hidden_metadata: {},
      tags: [],
      dataset_split: 'invalid-split',
      suite: 'Test Suite',
    };
    expect(() => validateCaseFile(bad)).toThrow();
  });

  it('accepts a valid case file', () => {
    const good = {
      kind: 'compression',
      title: 'Test case',
      output_spec: { target: 'IC one-pager', parts: [{ type: 'title', label: 'Headline' }] },
      runner_input: { instruction: 'Compress this.' },
      source_blocks: [{ type: 'text', text: 'Some text.' }],
      hidden_metadata: { domain: 'test' },
      tags: ['test'],
      dataset_split: 'dev',
      suite: 'Test Suite',
    };
    expect(() => validateCaseFile(good)).not.toThrow();
    const result = validateCaseFile(good);
    expect(result.kind).toBe('compression');
  });
});

// ── importCases integration tests ─────────────────────────────────────────────

describe('importCases', () => {
  it('creates N versions on first import of fixture dir', async () => {
    // Clean up before so test is repeatable
    await cleanupFixtureSuite(FIXTURE_SUITE_NAME);

    const result = await importCases(FIXTURE_DIR);

    // Fixture dir has 3 case.json files
    expect(result.created).toBe(3);
    expect(result.unchanged).toBe(0);
  });

  it('re-running the same import yields {created:0, unchanged:N}', async () => {
    const result = await importCases(FIXTURE_DIR);

    expect(result.created).toBe(0);
    expect(result.unchanged).toBe(3);
  });

  it('editing one case title creates a new version, old version preserved', async () => {
    // Create a temp dir with a single modified case (one title changed)
    const tmpSuite = `Fixture Suite v1 - Mutated - ${randomUUID().slice(0, 8)}`;
    const tmpRoot = join(tmpdir(), `arena-test-${randomUUID().slice(0, 8)}`);
    const caseDir = join(tmpRoot, 'domain-a', 'compression', 'case-alpha');
    mkdirSync(caseDir, { recursive: true });

    // Write a modified case (same external_ref path, different title)
    const modifiedCase = {
      kind: 'compression',
      title: 'MODIFIED TITLE — Compress this diligence memo',
      guidance: 'Reward the version that helps a partner reach a call.',
      output_spec: {
        target: 'IC one-pager',
        parts: [
          { type: 'title', label: 'Headline', note: 'one line' },
          { type: 'bullets', label: 'Key supporting points', note: '3 bullets' },
        ],
      },
      runner_input: {
        instruction: 'Compress the memo below to its decision-relevant core.',
        constraints: 'Max 250 words.',
      },
      source_blocks: [
        { type: 'text', text: 'Synthetic SaaS Co. £14m ARR, 31% YoY growth. Priced at 8.5x ARR.' },
        { type: 'bullets', items: ['91% gross retention', 'Founder-CTO single point of failure'] },
      ],
      hidden_metadata: { domain: 'domain-a', difficulty: 'medium' },
      tags: ['domain-a', 'compression', 'fixture'],
      dataset_split: 'dev',
      suite: tmpSuite,
    };

    writeFileSync(join(caseDir, 'case.json'), JSON.stringify(modifiedCase, null, 2));

    try {
      // First import — creates version 1
      const r1 = await importCases(tmpRoot);
      expect(r1.created).toBe(1);
      expect(r1.unchanged).toBe(0);

      // Modify the title again
      modifiedCase.title = 'MODIFIED TITLE v2 — Compress this diligence memo';
      writeFileSync(join(caseDir, 'case.json'), JSON.stringify(modifiedCase, null, 2));

      // Second import — should create version 2
      const r2 = await importCases(tmpRoot);
      expect(r2.created).toBe(1);
      expect(r2.unchanged).toBe(0);

      // Verify two versions exist and version 1 is unchanged (immutability check)
      const suite = await db.query.suites.findFirst({
        where: eq(suites.name, tmpSuite),
      });
      expect(suite).toBeTruthy();

      const suiteCases = await db.query.cases.findMany({
        where: eq(cases.suiteId, suite!.id),
      });
      expect(suiteCases).toHaveLength(1);

      const versions = await db.query.caseVersions.findMany({
        where: eq(caseVersions.caseId, suiteCases[0].id),
        orderBy: (cv, { asc }) => asc(cv.version),
      });
      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(1);
      expect(versions[1].version).toBe(2);
      // Old version title should be unchanged
      expect(versions[0].title).toBe('MODIFIED TITLE — Compress this diligence memo');
      expect(versions[1].title).toBe('MODIFIED TITLE v2 — Compress this diligence memo');

      // Third import unchanged — idempotent
      const r3 = await importCases(tmpRoot);
      expect(r3.created).toBe(0);
      expect(r3.unchanged).toBe(1);
    } finally {
      // Clean up this test's suite
      await cleanupFixtureSuite(tmpSuite);
    }
  });
});
