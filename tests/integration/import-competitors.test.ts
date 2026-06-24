import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db, pool } from '@/db/client';
import { competitors, competitorVersions } from '@/db/schema';
import { importCompetitors } from '@/corpus/import-competitors';
import { eq, inArray } from 'drizzle-orm';

// ── Test-scoped competitor names we own ──────────────────────────────────────
const FIXTURE_NAMES = [
  '__test_fixture_alpha__',
  '__test_fixture_beta__',
  '__test_fixture_child__',
  '__test_fixture_missing_parent__',
];

const FIXTURE_ROOT = path.resolve(
  process.cwd(),
  'tests/fixtures/competitors',
);

// ── Cleanup helpers ──────────────────────────────────────────────────────────

async function cleanupTestRows() {
  // Delete versions first (FK constraint), then competitors
  const comps = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(inArray(competitors.name, FIXTURE_NAMES));

  if (comps.length > 0) {
    const ids = comps.map((c) => c.id);
    await db.delete(competitorVersions).where(inArray(competitorVersions.competitorId, ids));
    await db.delete(competitors).where(inArray(competitors.id, ids));
  }
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanupTestRows();
});

afterAll(async () => {
  await cleanupTestRows();
  await pool.end();
});

beforeEach(async () => {
  await cleanupTestRows();
});

// ── Fixture subset helper ────────────────────────────────────────────────────

/**
 * Copy a subset of fixture competitor dirs into a temp directory so we can
 * test partial imports without touching the full fixture tree.
 */
async function buildTempDir(slugs: string[]): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-import-test-'));
  for (const slug of slugs) {
    const src = path.join(FIXTURE_ROOT, slug);
    const dest = path.join(tmpDir, slug);
    await copyDir(src, dest);
  }
  return tmpDir;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('importCompetitors', () => {
  it('creates competitors and versions on first import', async () => {
    const tmpDir = await buildTempDir(['fixture-alpha', 'fixture-beta']);

    const result = await importCompetitors(tmpDir);

    expect(result.created).toBe(2);
    expect(result.unchanged).toBe(0);

    // Verify rows exist in DB
    const alphaRows = await db
      .select()
      .from(competitors)
      .where(eq(competitors.name, '__test_fixture_alpha__'));
    expect(alphaRows).toHaveLength(1);
    expect(alphaRows[0].competitorType).toBe('llm');

    const betaRows = await db
      .select()
      .from(competitors)
      .where(eq(competitors.name, '__test_fixture_beta__'));
    expect(betaRows).toHaveLength(1);

    // Verify version rows
    const alphaVersions = await db
      .select()
      .from(competitorVersions)
      .where(eq(competitorVersions.competitorId, alphaRows[0].id));
    expect(alphaVersions).toHaveLength(1);
    expect(alphaVersions[0].version).toBe(1);
    expect(alphaVersions[0].modelIdentifier).toBe('anthropic/claude-opus-4-8');
    // system_prompt_ref should be resolved into the bundle
    expect(alphaVersions[0].promptBundleJson).toMatchObject({
      system_prompt: expect.stringContaining('fixture competitor alpha'),
    });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns unchanged on re-import with same content', async () => {
    const tmpDir = await buildTempDir(['fixture-alpha', 'fixture-beta']);

    const first = await importCompetitors(tmpDir);
    expect(first.created).toBe(2);

    const second = await importCompetitors(tmpDir);
    expect(second.created).toBe(0);
    expect(second.unchanged).toBe(2);

    // Ensure no duplicate version rows were created
    const alphaRow = (
      await db
        .select({ id: competitors.id })
        .from(competitors)
        .where(eq(competitors.name, '__test_fixture_alpha__'))
    )[0];
    const versions = await db
      .select()
      .from(competitorVersions)
      .where(eq(competitorVersions.competitorId, alphaRow.id));
    expect(versions).toHaveLength(1);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('inserts a new version when prompt content changes, preserving old version', async () => {
    const tmpDir = await buildTempDir(['fixture-alpha']);

    const first = await importCompetitors(tmpDir);
    expect(first.created).toBe(1);

    // Modify the prompt content in the temp dir
    const promptPath = path.join(tmpDir, 'fixture-alpha', 'prompts', 'system.md');
    const original = await fs.readFile(promptPath, 'utf-8');
    await fs.writeFile(promptPath, original + '\n\nExtra instruction added for v2.', 'utf-8');

    const second = await importCompetitors(tmpDir);
    expect(second.created).toBe(1);
    expect(second.unchanged).toBe(0);

    // Both versions should exist
    const alphaRow = (
      await db
        .select({ id: competitors.id })
        .from(competitors)
        .where(eq(competitors.name, '__test_fixture_alpha__'))
    )[0];
    const versions = await db
      .select()
      .from(competitorVersions)
      .where(eq(competitorVersions.competitorId, alphaRow.id))
      .orderBy(competitorVersions.version);

    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(1);
    expect(versions[1].version).toBe(2);

    // Old version should still have the original prompt
    const oldBundle = versions[0].promptBundleJson as { system_prompt: string };
    expect(oldBundle.system_prompt).not.toContain('Extra instruction');

    // New version should have updated prompt
    const newBundle = versions[1].promptBundleJson as { system_prompt: string };
    expect(newBundle.system_prompt).toContain('Extra instruction');

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves parent_competitor_version_id when parent exists', async () => {
    // Import fixture-alpha first (it's the parent), then fixture-child
    const tmpDir = await buildTempDir(['fixture-alpha', 'fixture-child']);

    const result = await importCompetitors(tmpDir);
    expect(result.created).toBe(2);

    // Verify child version has parent_competitor_version_id set
    const alphaRow = (
      await db
        .select({ id: competitors.id })
        .from(competitors)
        .where(eq(competitors.name, '__test_fixture_alpha__'))
    )[0];

    const alphaVersion = (
      await db
        .select({ id: competitorVersions.id })
        .from(competitorVersions)
        .where(eq(competitorVersions.competitorId, alphaRow.id))
    )[0];

    const childRow = (
      await db
        .select({ id: competitors.id })
        .from(competitors)
        .where(eq(competitors.name, '__test_fixture_child__'))
    )[0];

    const childVersion = (
      await db
        .select()
        .from(competitorVersions)
        .where(eq(competitorVersions.competitorId, childRow.id))
    )[0];

    expect(childVersion.parentCompetitorVersionId).toBe(alphaVersion.id);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when a version references a missing parent', async () => {
    // Create a temp dir with only fixture-child (parent fixture-alpha is absent)
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-import-test-missing-'));

    // Create a competitor that references a non-existent parent slug
    const compDir = path.join(tmpDir, 'fixture-missing-parent');
    const versionsDir = path.join(compDir, 'versions');
    await fs.mkdir(versionsDir, { recursive: true });

    await fs.writeFile(
      path.join(compDir, 'competitor.json'),
      JSON.stringify({ name: '__test_fixture_missing_parent__', competitor_type: 'llm' }),
    );
    await fs.writeFile(
      path.join(versionsDir, 'v1.json'),
      JSON.stringify({
        model_provider: 'openai',
        model_identifier: 'openai/gpt-5',
        prompt_bundle: { system_prompt: 'Test.' },
        model_parameters: { temperature: 0.5 },
        source_type: 'manual',
        parent: { slug: 'nonexistent-slug', version: 1 },
      }),
    );

    await expect(importCompetitors(tmpDir)).rejects.toThrow();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
