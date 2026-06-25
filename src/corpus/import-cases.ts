import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { glob } from 'glob';
import { eq, and, isNull, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { suites, cases, caseVersions } from '@/db/schema';
import { contentHash } from '@/domain/content-hash';
import { validateCaseFile, type CaseFile } from './case-schema';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive external_ref from the case.json path.
 * Uses the path relative to rootDir, minus the trailing "/case.json".
 * e.g. "pe-diligence/compression/fm-diligence" → external_ref
 */
function deriveExternalRef(rootDir: string, caseJsonPath: string): string {
  const rel = relative(rootDir, caseJsonPath);
  // strip trailing /case.json
  return rel.replace(/[\\/]case\.json$/, '');
}

/**
 * Upsert a suite row by name. Returns the suite id.
 */
async function upsertSuite(suiteName: string): Promise<string> {
  const existing = await db.query.suites.findFirst({
    where: eq(suites.name, suiteName),
  });
  if (existing) return existing.id;
  const [inserted] = await db
    .insert(suites)
    .values({ name: suiteName })
    .returning({ id: suites.id });
  return inserted.id;
}

/**
 * Upsert a cases row by (suiteId, externalRef). Returns the case id.
 */
async function upsertCase(suiteId: string, externalRef: string): Promise<string> {
  const existing = await db.query.cases.findFirst({
    where: and(eq(cases.suiteId, suiteId), eq(cases.externalRef, externalRef)),
  });
  if (existing) return existing.id;
  const [inserted] = await db
    .insert(cases)
    .values({ suiteId, externalRef })
    .returning({ id: cases.id });
  return inserted.id;
}

/**
 * Find the latest case_version for a given caseId.
 */
async function latestCaseVersion(caseId: string) {
  return db.query.caseVersions.findFirst({
    where: eq(caseVersions.caseId, caseId),
    orderBy: (cv, { desc }) => desc(cv.version),
  });
}

/**
 * Insert a new case_version for a case.
 */
async function insertCaseVersion(
  caseId: string,
  version: number,
  cf: CaseFile,
  hash: string,
): Promise<void> {
  const evaluatorContext = {
    title: cf.title,
    guidance: cf.guidance,
    output_spec: cf.output_spec,
    source_blocks: cf.source_blocks,
  };

  await db.insert(caseVersions).values({
    caseId,
    version,
    kind: cf.kind,
    title: cf.title,
    guidance: cf.guidance ?? null,
    outputSpecJson: cf.output_spec as unknown as Record<string, unknown>,
    runnerInputJson: cf.runner_input,
    evaluatorContextJson: evaluatorContext as unknown as Record<string, unknown>,
    sourceBlocksJson: cf.source_blocks as unknown as Record<string, unknown>[],
    hiddenMetadataJson: cf.hidden_metadata,
    tags: cf.tags,
    datasetSplit: cf.dataset_split,
    samplingWeight: 1.0,
    contentHash: hash,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ImportResult {
  created: number;
  unchanged: number;
  retired: number;
  unretired: number;
}

/**
 * Walk all case.json files under rootDir, validate each, and upsert into the DB.
 * Idempotent + content-addressed: re-running with unchanged files is a no-op.
 * An edited file gets a new case_version row (never mutates prior versions).
 *
 * Reconciliation: cases whose external_ref was NOT seen this run AND have
 * retired_at IS NULL are retired (retired_at = now()). Cases that were seen
 * this run AND already have retired_at set are un-retired (retired_at = null).
 * eligible_override is never touched (admin-owned).
 */
export async function importCases(rootDir: string): Promise<ImportResult> {
  const pattern = join(rootDir, '**/case.json').replace(/\\/g, '/');
  const files = await glob(pattern, { nodir: true });

  let created = 0;
  let unchanged = 0;
  let unretired = 0;

  const seenCaseIds = new Set<string>();

  for (const filePath of files) {
    // Parse + validate
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const cf = validateCaseFile(raw);

    // Compute content hash over the canonical CaseFile
    const hash = contentHash(cf);

    // Derive external_ref from path
    const externalRef = deriveExternalRef(rootDir, filePath);

    // Upsert suite + case rows
    const suiteId = await upsertSuite(cf.suite);
    const caseId = await upsertCase(suiteId, externalRef);
    seenCaseIds.add(caseId);

    // Un-retire if the file returned (regardless of content change)
    const caseRow = await db
      .select({ retiredAt: cases.retiredAt })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);
    if (caseRow[0]?.retiredAt !== null && caseRow[0]?.retiredAt !== undefined) {
      await db.update(cases).set({ retiredAt: null }).where(eq(cases.id, caseId));
      unretired++;
    }

    // Check latest version
    const latest = await latestCaseVersion(caseId);

    if (latest && latest.contentHash === hash) {
      unchanged++;
      continue;
    }

    // Insert new version (never mutate old)
    const nextVersion = latest ? latest.version + 1 : 1;
    await insertCaseVersion(caseId, nextVersion, cf, hash);
    created++;
  }

  // Reconcile: retire cases in the same suites that were not seen this run
  let retired = 0;
  if (seenCaseIds.size > 0) {
    const seenCaseIdArray = Array.from(seenCaseIds);

    // Find suiteIds for the cases we did see
    const seenCaseRows = await db
      .select({ suiteId: cases.suiteId })
      .from(cases)
      .where(inArray(cases.id, seenCaseIdArray));

    const seenSuiteIds = [...new Set(seenCaseRows.map(r => r.suiteId))];

    if (seenSuiteIds.length > 0) {
      // Find active cases in these suites that we did NOT see this run
      const activeSiblings = await db
        .select({ id: cases.id })
        .from(cases)
        .where(and(inArray(cases.suiteId, seenSuiteIds), isNull(cases.retiredAt)));

      const toRetire = activeSiblings.filter(c => !seenCaseIds.has(c.id));
      if (toRetire.length > 0) {
        const now = new Date();
        for (const c of toRetire) {
          await db.update(cases).set({ retiredAt: now }).where(eq(cases.id, c.id));
          retired++;
        }
      }
    }
  }

  return { created, unchanged, retired, unretired };
}
