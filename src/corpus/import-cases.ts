import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { glob } from 'glob';
import { eq, and, desc } from 'drizzle-orm';

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
  if (existing) {
    return existing.id;
  }
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
  if (existing) {
    return existing.id;
  }
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
    orderBy: desc(caseVersions.version),
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
}

/**
 * Walk all case.json files under rootDir, validate each, and upsert into the DB.
 * Idempotent + content-addressed: re-running with unchanged files is a no-op.
 * An edited file gets a new case_version row (never mutates prior versions).
 */
export async function importCases(rootDir: string): Promise<ImportResult> {
  const pattern = join(rootDir, '**/case.json').replace(/\\/g, '/');
  const files = await glob(pattern, { nodir: true });

  let created = 0;
  let unchanged = 0;

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

  return { created, unchanged };
}
