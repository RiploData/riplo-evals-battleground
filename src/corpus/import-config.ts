import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, and } from 'drizzle-orm';

import { db } from '@/db/client';
import { suites, suiteVersions, campaigns } from '@/db/schema';
import { contentHash } from '@/domain/content-hash';
import { validateSuiteConfig, validateCampaignConfig } from './config-schema';

// ── Result type ───────────────────────────────────────────────────────────────

export interface ImportConfigResult {
  suiteVersionId: string;
  campaignId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Upsert a suite row by name. Returns the suite id.
 * Does not overwrite purpose/intended_reader if row already exists.
 */
async function upsertSuite(
  name: string,
  purpose: string | undefined,
  intendedReader: string | undefined,
): Promise<string> {
  const existing = await db.query.suites.findFirst({
    where: eq(suites.name, name),
  });
  if (existing) {
    return existing.id;
  }
  const [inserted] = await db
    .insert(suites)
    .values({ name, purpose: purpose ?? null, intendedReader: intendedReader ?? null })
    .returning({ id: suites.id });
  return inserted.id;
}

/**
 * Find or create a suite_version for the given suiteId + content hash.
 * Returns the suite_version id.
 *
 * Idempotency: if a suite_version with the same rubric+weighting content hash
 * already exists for this suite, return its id. Otherwise create a new frozen version.
 */
async function upsertSuiteVersion(
  suiteId: string,
  rubricJson: Record<string, unknown>,
  weightingJson: Record<string, unknown>,
): Promise<string> {
  // Content-address the rubric+weighting pair
  const hash = contentHash({ rubric_json: rubricJson, weighting_json: weightingJson });

  // Check for existing versions in this suite
  const existingVersions = await db
    .select({
      id: suiteVersions.id,
      version: suiteVersions.version,
      rubricJson: suiteVersions.rubricJson,
      weightingJson: suiteVersions.weightingJson,
    })
    .from(suiteVersions)
    .where(eq(suiteVersions.suiteId, suiteId));

  // Look for an existing version with identical content (content-addressed)
  for (const sv of existingVersions) {
    const existingHash = contentHash({
      rubric_json: sv.rubricJson,
      weighting_json: sv.weightingJson,
    });
    if (existingHash === hash) {
      return sv.id;
    }
  }

  // Determine next version number
  const nextVersion =
    existingVersions.length === 0
      ? 1
      : Math.max(...existingVersions.map((sv) => sv.version)) + 1;

  // Insert a new frozen suite_version (invariant: always frozen on creation from config)
  const [inserted] = await db
    .insert(suiteVersions)
    .values({
      suiteId,
      version: nextVersion,
      rubricJson: rubricJson as Record<string, unknown>,
      weightingJson: weightingJson as Record<string, unknown>,
      frozenAt: new Date(),
    })
    .returning({ id: suiteVersions.id });

  return inserted.id;
}

/**
 * Find or create a campaign for the given suiteVersionId + campaign name.
 * Returns the campaign id.
 *
 * Idempotency: if a campaign with this name + suiteVersionId already exists, return its id.
 * eligible_competitor_version_ids is populated later by the seed orchestrator.
 */
async function upsertCampaign(
  name: string,
  suiteVersionId: string,
  caseSelectorJson: Record<string, unknown>,
  replicates: number,
  matchmakingStrategy: string,
): Promise<string> {
  const existing = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.name, name), eq(campaigns.suiteVersionId, suiteVersionId)),
  });
  if (existing) {
    return existing.id;
  }

  const [inserted] = await db
    .insert(campaigns)
    .values({
      name,
      suiteVersionId,
      caseSelectorJson: caseSelectorJson as Record<string, unknown>,
      eligibleCompetitorVersionIds: [], // populated later by seed
      replicates,
      matchmakingStrategy,
    })
    .returning({ id: campaigns.id });

  return inserted.id;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read config/suites/default.json and config/campaign.json from rootDir,
 * then upsert a suite, a frozen suite_version, and a default campaign.
 *
 * Returns { suiteVersionId, campaignId }.
 * Idempotent: re-running with the same configs is a no-op.
 */
export async function importConfig(rootDir: string): Promise<ImportConfigResult> {
  // Read and validate suite config
  const suiteConfigRaw = JSON.parse(
    readFileSync(join(rootDir, 'config', 'suites', 'default.json'), 'utf-8'),
  );
  const suiteConfig = validateSuiteConfig(suiteConfigRaw);

  // Read and validate campaign config
  const campaignConfigRaw = JSON.parse(
    readFileSync(join(rootDir, 'config', 'campaign.json'), 'utf-8'),
  );
  const campaignConfig = validateCampaignConfig(campaignConfigRaw);

  // Upsert suite
  const suiteId = await upsertSuite(
    suiteConfig.name,
    suiteConfig.purpose,
    suiteConfig.intended_reader,
  );

  // Upsert suite_version (frozen)
  const suiteVersionId = await upsertSuiteVersion(
    suiteId,
    suiteConfig.rubric_json,
    suiteConfig.weighting_json,
  );

  // Upsert campaign (invariant #8: always records its suite_version)
  const campaignId = await upsertCampaign(
    campaignConfig.name,
    suiteVersionId,
    campaignConfig.case_selector_json,
    campaignConfig.replicates,
    campaignConfig.matchmaking_strategy,
  );

  return { suiteVersionId, campaignId };
}
