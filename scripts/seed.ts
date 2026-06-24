/**
 * scripts/seed.ts
 *
 * Seed orchestrator: imports config → competitors → cases → links campaign.
 * Fully idempotent: safe to run multiple times.
 *
 * Usage: npx tsx scripts/seed.ts
 */

import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { eq, and, inArray } from 'drizzle-orm';

import { db, pool } from '@/db/client';
import { competitors, competitorVersions, campaigns } from '@/db/schema';
import { importConfig } from '@/corpus/import-config';
import { importCompetitors } from '@/corpus/import-competitors';
import { importCases } from '@/corpus/import-cases';
import { validateCampaignConfig } from '@/corpus/config-schema';

const ROOT = path.resolve(process.cwd());

async function main() {
  console.log('=== Riplo Arena Seed ===');
  console.log(`Root: ${ROOT}`);

  // ── Step 1: import config (suite + suite_version + campaign shell) ──────────
  console.log('\n[1/4] Importing suite/campaign config...');
  const { suiteVersionId, campaignId } = await importConfig(ROOT);
  console.log(`  suite_version: ${suiteVersionId}`);
  console.log(`  campaign:      ${campaignId}`);

  // ── Step 2: import competitors ─────────────────────────────────────────────
  const competitorsDir = path.join(ROOT, 'competitors');
  console.log(`\n[2/4] Importing competitors from ${competitorsDir}...`);
  const compResult = await importCompetitors(competitorsDir);
  console.log(`  created: ${compResult.created}, unchanged: ${compResult.unchanged}`);

  // ── Step 3: import cases ───────────────────────────────────────────────────
  const casesDir = path.join(ROOT, 'cases');
  console.log(`\n[3/4] Importing cases from ${casesDir}...`);
  const caseResult = await importCases(casesDir);
  console.log(`  created: ${caseResult.created}, unchanged: ${caseResult.unchanged}`);

  // ── Step 4: resolve eligible competitor version ids and update campaign ─────
  console.log('\n[4/4] Resolving eligible competitor versions...');

  // Re-read campaign config to get the eligible_competitors list
  const campaignConfigRaw = JSON.parse(
    await fs.readFile(path.join(ROOT, 'config', 'campaign.json'), 'utf-8'),
  );
  const campaignConfig = validateCampaignConfig(campaignConfigRaw);

  // Collect all slugs
  const slugs = campaignConfig.eligible_competitors.map((ec) => ec.slug);

  // Load competitor dirs to build slug → name map
  const competitorEntries = await fs.readdir(competitorsDir, { withFileTypes: true });
  const slugToName = new Map<string, string>();

  for (const entry of competitorEntries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const competitorJsonPath = path.join(competitorsDir, slug, 'competitor.json');
    try {
      const raw = JSON.parse(await fs.readFile(competitorJsonPath, 'utf-8')) as { name: string };
      slugToName.set(slug, raw.name);
    } catch {
      // skip dirs without competitor.json
    }
  }

  // Resolve each {slug, version} → competitor_version.id
  const eligibleVersionIds: string[] = [];

  for (const ref of campaignConfig.eligible_competitors) {
    const competitorName = slugToName.get(ref.slug);
    if (!competitorName) {
      throw new Error(
        `Slug "${ref.slug}" not found in competitors directory. ` +
          `Available slugs: ${[...slugToName.keys()].join(', ')}`,
      );
    }

    // Find the competitor row
    const [comp] = await db
      .select({ id: competitors.id })
      .from(competitors)
      .where(eq(competitors.name, competitorName))
      .limit(1);

    if (!comp) {
      throw new Error(
        `Competitor "${competitorName}" (slug "${ref.slug}") not found in DB. ` +
          `Run importCompetitors first.`,
      );
    }

    // Find the specific version
    const [compVer] = await db
      .select({ id: competitorVersions.id })
      .from(competitorVersions)
      .where(
        and(
          eq(competitorVersions.competitorId, comp.id),
          eq(competitorVersions.version, ref.version),
        ),
      )
      .limit(1);

    if (!compVer) {
      throw new Error(
        `Competitor version "${ref.slug}" v${ref.version} not found in DB. ` +
          `Ensure the version file exists and was imported.`,
      );
    }

    eligibleVersionIds.push(compVer.id);
    console.log(`  resolved "${ref.slug}" v${ref.version} → ${compVer.id}`);
  }

  // Update campaign with resolved ids (idempotent: same ids on re-run)
  await db
    .update(campaigns)
    .set({ eligibleCompetitorVersionIds: eligibleVersionIds })
    .where(eq(campaigns.id, campaignId));

  console.log(`\n  campaign.eligible_competitor_version_ids updated (${eligibleVersionIds.length} entries)`);

  console.log('\n=== Seed complete ===');
  console.log(`  suite_version_id:                   ${suiteVersionId}`);
  console.log(`  campaign_id:                        ${campaignId}`);
  console.log(`  eligible_competitor_version_ids:    [${eligibleVersionIds.join(', ')}]`);
}

main()
  .then(() => {
    void pool.end();
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    void pool.end();
    process.exit(1);
  });
