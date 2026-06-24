import 'dotenv/config';
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { eq, and, inArray, sql } from 'drizzle-orm';

import { db, pool } from '@/db/client';
import {
  suites,
  suiteVersions,
  campaigns,
  competitors,
  competitorVersions,
  cases,
  caseVersions,
} from '@/db/schema';
import { importConfig } from '@/corpus/import-config';
import { importCompetitors } from '@/corpus/import-competitors';
import { importCases } from '@/corpus/import-cases';

// ── Fixture paths ─────────────────────────────────────────────────────────────

// Fixture competitors live at tests/fixtures/competitors/
const FIXTURE_COMPETITORS_DIR = path.resolve(process.cwd(), 'tests/fixtures/competitors');

// Fixture cases live at tests/fixtures/cases/ and use "Fixture Suite v1"
const FIXTURE_CASES_DIR = path.resolve(process.cwd(), 'tests/fixtures/cases');

// Fixture config lives at tests/fixtures/config/
const FIXTURE_CONFIG_DIR = path.resolve(process.cwd(), 'tests/fixtures/config');

// We need a fake "rootDir" that has config/suites/default.json + config/campaign.json
// We'll build a temp dir that mirrors this structure for each test.

// Scoped names to avoid polluting other tests
const FIXTURE_SUITE_NAME = 'Fixture Suite v1';
const FIXTURE_CAMPAIGN_NAME = '__test_fixture_campaign__';
// Include fixture-child since it can be imported transitively and has a parent FK
const FIXTURE_COMPETITOR_NAMES = [
  '__test_fixture_alpha__',
  '__test_fixture_beta__',
  '__test_fixture_child__',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a temp root dir with config/ pointing to our fixture config files.
 * Returns the rootDir path.
 */
function buildFixtureRoot(): string {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-cfg-test-'));
  const configDir = path.join(tmpRoot, 'config', 'suites');
  fs.mkdirSync(configDir, { recursive: true });

  // Copy fixture config files
  fs.copyFileSync(
    path.join(FIXTURE_CONFIG_DIR, 'suites', 'default.json'),
    path.join(tmpRoot, 'config', 'suites', 'default.json'),
  );
  fs.copyFileSync(
    path.join(FIXTURE_CONFIG_DIR, 'campaign.json'),
    path.join(tmpRoot, 'config', 'campaign.json'),
  );

  return tmpRoot;
}

/**
 * Clean up all rows created by these tests (scoped to fixture names).
 */
async function cleanup(): Promise<void> {
  // Delete campaign rows for our test campaign name
  const campaignRows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.name, FIXTURE_CAMPAIGN_NAME));
  if (campaignRows.length > 0) {
    const ids = campaignRows.map((r) => r.id);
    await db.delete(campaigns).where(inArray(campaigns.id, ids));
  }

  // Delete suite_versions, cases, and suites for our test suite
  const suiteRows = await db
    .select({ id: suites.id })
    .from(suites)
    .where(eq(suites.name, FIXTURE_SUITE_NAME));
  if (suiteRows.length > 0) {
    const suiteIds = suiteRows.map((r) => r.id);
    // Must delete suite_versions before suites (FK)
    await db.delete(suiteVersions).where(inArray(suiteVersions.suiteId, suiteIds));
    // Must delete cases (and case_versions) before suites (FK)
    const caseRows = await db
      .select({ id: cases.id })
      .from(cases)
      .where(inArray(cases.suiteId, suiteIds));
    if (caseRows.length > 0) {
      const caseIds = caseRows.map((r) => r.id);
      await db.delete(caseVersions).where(inArray(caseVersions.caseId, caseIds));
      await db.delete(cases).where(inArray(cases.id, caseIds));
    }
    await db.delete(suites).where(inArray(suites.id, suiteIds));
  }

  // Delete competitor_versions and competitors for our fixture competitors
  const compRows = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(inArray(competitors.name, FIXTURE_COMPETITOR_NAMES));
  if (compRows.length > 0) {
    const compIds = compRows.map((r) => r.id);
    // Null out parent references first to avoid self-referential FK violation
    await db
      .update(competitorVersions)
      .set({ parentCompetitorVersionId: sql`NULL` })
      .where(inArray(competitorVersions.competitorId, compIds));
    await db.delete(competitorVersions).where(inArray(competitorVersions.competitorId, compIds));
    await db.delete(competitors).where(inArray(competitors.id, compIds));
  }
}

// ── Teardown ─────────────────────────────────────────────────────────────────

afterAll(async () => {
  await cleanup();
  await pool.end();
});

beforeEach(async () => {
  await cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('importConfig', () => {
  it('creates a suite, a frozen suite_version, and a campaign', async () => {
    const rootDir = buildFixtureRoot();

    const result = await importConfig(rootDir);

    expect(result.suiteVersionId).toBeTruthy();
    expect(result.campaignId).toBeTruthy();

    // Verify suite_version was created and is frozen
    const sv = await db.query.suiteVersions.findFirst({
      where: eq(suiteVersions.id, result.suiteVersionId),
    });
    expect(sv).toBeTruthy();
    expect(sv!.frozenAt).not.toBeNull();
    expect(sv!.version).toBe(1);

    // Verify suite row
    const suite = await db.query.suites.findFirst({
      where: eq(suites.id, sv!.suiteId),
    });
    expect(suite).toBeTruthy();
    expect(suite!.name).toBe(FIXTURE_SUITE_NAME);

    // Verify campaign row
    const campaign = await db.query.campaigns.findFirst({
      where: eq(campaigns.id, result.campaignId),
    });
    expect(campaign).toBeTruthy();
    expect(campaign!.name).toBe(FIXTURE_CAMPAIGN_NAME);
    expect(campaign!.suiteVersionId).toBe(result.suiteVersionId);
    // eligible_competitor_version_ids starts empty (populated by seed)
    expect(campaign!.eligibleCompetitorVersionIds).toHaveLength(0);

    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('is idempotent — re-running returns the same ids', async () => {
    const rootDir = buildFixtureRoot();

    const r1 = await importConfig(rootDir);
    const r2 = await importConfig(rootDir);

    expect(r2.suiteVersionId).toBe(r1.suiteVersionId);
    expect(r2.campaignId).toBe(r1.campaignId);

    // Confirm only one suite_version was created
    const sv = await db.query.suiteVersions.findFirst({
      where: eq(suiteVersions.id, r1.suiteVersionId),
    });
    expect(sv!.version).toBe(1);

    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates a new suite_version when rubric changes', async () => {
    const rootDir = buildFixtureRoot();

    const r1 = await importConfig(rootDir);
    expect(r1.suiteVersionId).toBeTruthy();

    // Modify the default.json to have a different rubric
    const suiteCfgPath = path.join(rootDir, 'config', 'suites', 'default.json');
    const suiteCfg = JSON.parse(fs.readFileSync(suiteCfgPath, 'utf-8'));
    suiteCfg.rubric_json = { dimensions: [{ id: 'new', label: 'New dimension', weight: 1.0 }] };
    fs.writeFileSync(suiteCfgPath, JSON.stringify(suiteCfg, null, 2));

    const r2 = await importConfig(rootDir);
    expect(r2.suiteVersionId).not.toBe(r1.suiteVersionId);

    // Both suite_versions should exist
    const sv1 = await db.query.suiteVersions.findFirst({
      where: eq(suiteVersions.id, r1.suiteVersionId),
    });
    const sv2 = await db.query.suiteVersions.findFirst({
      where: eq(suiteVersions.id, r2.suiteVersionId),
    });
    expect(sv1!.version).toBe(1);
    expect(sv2!.version).toBe(2);

    // Old suite_version remains frozen and unchanged
    expect(sv1!.frozenAt).not.toBeNull();
    expect(sv2!.frozenAt).not.toBeNull();

    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});

describe('full seed flow (importConfig + importCompetitors + importCases)', () => {
  it('yields a campaign with eligible_competitor_version_ids populated', async () => {
    const rootDir = buildFixtureRoot();

    // Step 1: import config
    const { suiteVersionId, campaignId } = await importConfig(rootDir);

    // Step 2: import competitors from fixture dir
    await importCompetitors(FIXTURE_COMPETITORS_DIR);

    // Step 3: import cases from fixture dir
    await importCases(FIXTURE_CASES_DIR);

    // Step 4: resolve eligible_competitor_version_ids (like seed.ts does)
    // The campaign config references fixture-alpha v1 and fixture-beta v1
    const alphaComp = await db.query.competitors.findFirst({
      where: eq(competitors.name, '__test_fixture_alpha__'),
    });
    const betaComp = await db.query.competitors.findFirst({
      where: eq(competitors.name, '__test_fixture_beta__'),
    });

    expect(alphaComp).toBeTruthy();
    expect(betaComp).toBeTruthy();

    const [alphaVer] = await db
      .select({ id: competitorVersions.id })
      .from(competitorVersions)
      .where(
        and(
          eq(competitorVersions.competitorId, alphaComp!.id),
          eq(competitorVersions.version, 1),
        ),
      );
    const [betaVer] = await db
      .select({ id: competitorVersions.id })
      .from(competitorVersions)
      .where(
        and(
          eq(competitorVersions.competitorId, betaComp!.id),
          eq(competitorVersions.version, 1),
        ),
      );

    expect(alphaVer).toBeTruthy();
    expect(betaVer).toBeTruthy();

    // Update campaign with resolved ids
    const eligibleIds = [alphaVer.id, betaVer.id];
    const { campaigns: campaignsTable } = await import('@/db/schema');
    await db
      .update(campaignsTable)
      .set({ eligibleCompetitorVersionIds: eligibleIds })
      .where(eq(campaignsTable.id, campaignId));

    // Verify campaign has eligible_competitor_version_ids populated
    const campaign = await db.query.campaigns.findFirst({
      where: eq(campaignsTable.id, campaignId),
    });
    expect(campaign).toBeTruthy();
    expect(campaign!.eligibleCompetitorVersionIds).toHaveLength(2);
    expect(campaign!.eligibleCompetitorVersionIds).toContain(alphaVer.id);
    expect(campaign!.eligibleCompetitorVersionIds).toContain(betaVer.id);
    expect(campaign!.suiteVersionId).toBe(suiteVersionId);

    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('is idempotent — running the full flow twice yields same campaign id and version ids', async () => {
    const rootDir = buildFixtureRoot();

    // Run flow twice
    const run = async () => {
      const { suiteVersionId, campaignId } = await importConfig(rootDir);
      await importCompetitors(FIXTURE_COMPETITORS_DIR);
      await importCases(FIXTURE_CASES_DIR);

      const alphaComp = await db.query.competitors.findFirst({
        where: eq(competitors.name, '__test_fixture_alpha__'),
      });
      const betaComp = await db.query.competitors.findFirst({
        where: eq(competitors.name, '__test_fixture_beta__'),
      });

      const [alphaVer] = await db
        .select({ id: competitorVersions.id })
        .from(competitorVersions)
        .where(
          and(
            eq(competitorVersions.competitorId, alphaComp!.id),
            eq(competitorVersions.version, 1),
          ),
        );
      const [betaVer] = await db
        .select({ id: competitorVersions.id })
        .from(competitorVersions)
        .where(
          and(
            eq(competitorVersions.competitorId, betaComp!.id),
            eq(competitorVersions.version, 1),
          ),
        );

      const eligibleIds = [alphaVer.id, betaVer.id];
      await db
        .update(campaigns)
        .set({ eligibleCompetitorVersionIds: eligibleIds })
        .where(eq(campaigns.id, campaignId));

      return { suiteVersionId, campaignId, eligibleIds };
    };

    const r1 = await run();
    // cleanup between runs to simulate fresh re-run against existing DB state
    // NOTE: we do NOT cleanup between runs here — that's the idempotency test
    const r2 = await run();

    expect(r2.suiteVersionId).toBe(r1.suiteVersionId);
    expect(r2.campaignId).toBe(r1.campaignId);
    expect(r2.eligibleIds).toEqual(r1.eligibleIds);

    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});
