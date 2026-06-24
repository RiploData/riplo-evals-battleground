/**
 * scripts/smoke.ts  (npm run cases:smoke)
 *
 * Runs ensureResponse for each eligible competitor on one sample case,
 * then flags empty or identical outputs.
 *
 * Requires:
 *   - DATABASE_URL (Postgres)
 *   - OPENROUTER_API_KEY (if unset, skips gracefully with exit 0)
 *
 * Usage: npx tsx scripts/smoke.ts
 */

import 'dotenv/config';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';

import { db, pool } from '@/db/client';
import {
  campaigns,
  caseVersions,
  cases,
  competitorVersions,
  responses,
} from '@/db/schema';
import { ensureResponse } from '@/services/generation/runner';

const ROOT = process.cwd();

async function main(): Promise<void> {
  console.log('=== Riplo Arena: Smoke Test ===');

  // Check for required API key
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('SKIP: OPENROUTER_API_KEY is not set. Smoke test requires a live API key.');
    console.log('      Set OPENROUTER_API_KEY and re-run to execute live generation.');
    process.exit(0);
  }

  // Find the most recent campaign
  const campaign = await db.query.campaigns.findFirst({
    orderBy: (c, { desc }) => desc(c.createdAt),
  });

  if (!campaign) {
    console.error('ERROR: No campaign found in DB. Run `npm run seed` first.');
    process.exit(1);
  }

  const eligibleVersionIds = campaign.eligibleCompetitorVersionIds;
  if (!eligibleVersionIds || eligibleVersionIds.length === 0) {
    console.error('ERROR: Campaign has no eligible_competitor_version_ids. Run seed first.');
    process.exit(1);
  }

  console.log(`Campaign: "${campaign.name}" (${campaign.id})`);
  console.log(`Eligible competitor versions: ${eligibleVersionIds.length}`);

  // Find a sample case version from the linked suite_version
  const suiteVersionId = campaign.suiteVersionId;

  // Get one case from this suite via suite_id from suite_version
  const suiteVersionRow = await db.query.suiteVersions.findFirst({
    where: eq((await import('@/db/schema')).suiteVersions.id, suiteVersionId),
  });

  if (!suiteVersionRow) {
    console.error('ERROR: suite_version not found.');
    process.exit(1);
  }

  // Find one case_version for this suite
  const sampleCaseVersion = await db
    .select({
      id: caseVersions.id,
      title: caseVersions.title,
      caseId: caseVersions.caseId,
    })
    .from(caseVersions)
    .innerJoin(cases, eq(caseVersions.caseId, cases.id))
    .where(eq(cases.suiteId, suiteVersionRow.suiteId))
    .orderBy(caseVersions.createdAt)
    .limit(1);

  if (sampleCaseVersion.length === 0) {
    console.error('ERROR: No case versions found for this suite. Run seed first.');
    process.exit(1);
  }

  const sampleCase = sampleCaseVersion[0];
  console.log(`\nSample case: "${sampleCase.title}" (${sampleCase.id})`);

  // Collect responses for each competitor
  const outputs: Array<{ competitorVersionId: string; text: string | null }> = [];

  for (const competitorVersionId of eligibleVersionIds) {
    const compVer = await db.query.competitorVersions.findFirst({
      where: eq(competitorVersions.id, competitorVersionId),
    });

    const label = compVer
      ? `${compVer.modelIdentifier ?? 'unknown'} v${compVer.version}`
      : competitorVersionId;

    console.log(`\nRunning: ${label}...`);

    try {
      const { responseId } = await ensureResponse(
        sampleCase.id,
        competitorVersionId,
        0,
        campaign.id,
      );

      // Fetch the response text
      const [resp] = await db
        .select({ bodyText: responses.bodyText })
        .from(responses)
        .where(eq(responses.id, responseId))
        .limit(1);

      const text = resp?.bodyText ?? null;
      outputs.push({ competitorVersionId, text });

      if (!text || text.trim().length === 0) {
        console.log(`  WARNING: empty response for ${label}`);
      } else {
        const preview = text.slice(0, 120).replace(/\n/g, ' ');
        console.log(`  OK (${text.length} chars): ${preview}...`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR for ${label}: ${message}`);
      outputs.push({ competitorVersionId, text: null });
    }
  }

  // ── Flag empty outputs ────────────────────────────────────────────────────

  const emptyOutputs = outputs.filter((o) => !o.text || o.text.trim().length === 0);
  if (emptyOutputs.length > 0) {
    console.warn(`\nWARNING: ${emptyOutputs.length} empty output(s) detected.`);
  }

  // ── Flag identical outputs ────────────────────────────────────────────────

  const nonEmpty = outputs.filter((o) => o.text && o.text.trim().length > 0);
  if (nonEmpty.length >= 2) {
    const allIdentical = nonEmpty.every((o) => o.text === nonEmpty[0].text);
    if (allIdentical) {
      console.warn('\nWARNING: All outputs are identical — possible prompt/config issue.');
    }
  }

  const anyEmpty = emptyOutputs.length > 0;
  console.log(`\n=== Smoke complete: ${outputs.length} competitors tested${anyEmpty ? ', issues detected' : ', all OK'} ===`);

  if (anyEmpty) {
    process.exit(1);
  }
}

main()
  .then(() => {
    void pool.end();
  })
  .catch((err: unknown) => {
    console.error('Smoke test failed:', err);
    void pool.end();
    process.exit(1);
  });
