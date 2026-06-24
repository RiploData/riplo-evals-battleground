import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/db/client';
import { competitors, competitorVersions } from '@/db/schema';
import { contentHash } from '@/domain/content-hash';
import { validateCompetitor, validateCompetitorVersion } from './competitor-schema';
import { eq, and } from 'drizzle-orm';

// ── Types ────────────────────────────────────────────────────────────────────

interface ImportResult {
  created: number;
  unchanged: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Upsert a logical competitor row by slug (name). Returns the competitor id.
 * If a row with this name already exists, return its id (do not mutate it).
 */
async function upsertCompetitor(name: string, competitorType: string): Promise<string> {
  const existing = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(eq(competitors.name, name))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  const inserted = await db
    .insert(competitors)
    .values({ name, competitorType })
    .returning({ id: competitors.id });

  return inserted[0].id;
}

/**
 * Resolve the parent competitor_version id from a {slug, version} reference.
 * The slug maps to the competitor name that should already exist in the DB.
 * Throws if the parent is not found.
 */
async function resolveParentVersionId(
  slug: string,
  version: number,
  slugToName: Map<string, string>,
): Promise<string> {
  const name = slugToName.get(slug);
  if (!name) {
    throw new Error(
      `Parent competitor slug "${slug}" not found in current import batch. ` +
        `Import parent before child.`,
    );
  }

  // Find competitor by name
  const comp = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(eq(competitors.name, name))
    .limit(1);

  if (comp.length === 0) {
    throw new Error(`Parent competitor with slug "${slug}" (name "${name}") not found in DB.`);
  }

  // Find the specific version
  const parentVer = await db
    .select({ id: competitorVersions.id })
    .from(competitorVersions)
    .where(
      and(
        eq(competitorVersions.competitorId, comp[0].id),
        eq(competitorVersions.version, version),
      ),
    )
    .limit(1);

  if (parentVer.length === 0) {
    throw new Error(
      `Parent competitor version "${slug}" v${version} not found in DB. ` +
        `Referenced version must be imported first.`,
    );
  }

  return parentVer[0].id;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Import all competitor configs from a root directory.
 *
 * Directory layout expected:
 *   <rootDir>/<slug>/competitor.json
 *   <rootDir>/<slug>/versions/v1.json
 *   <rootDir>/<slug>/versions/v2.json   (optional additional versions)
 *   <rootDir>/<slug>/prompts/*.md       (optional prompt files referenced by system_prompt_ref)
 *
 * Semantics:
 * - Competitors are upserted by name (slug maps to name field).
 * - Versions are content-addressed (content_hash). Existing hash → unchanged.
 * - New versions get the next monotonically increasing version number.
 * - Prior versions are NEVER mutated (immutability invariant).
 * - A version referencing a missing parent throws.
 */
export async function importCompetitors(rootDir: string): Promise<ImportResult> {
  let created = 0;
  let unchanged = 0;

  // Collect all slugs first so we can resolve cross-references
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const slugDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(); // deterministic order

  // Build slug → name map by reading competitor.json files
  const slugToName = new Map<string, string>();
  for (const slug of slugDirs) {
    const competitorJsonPath = path.join(rootDir, slug, 'competitor.json');
    if (!(await fileExists(competitorJsonPath))) continue;
    const competitorData = validateCompetitor(await readJsonFile(competitorJsonPath));
    slugToName.set(slug, competitorData.name);
  }

  // Process each competitor directory
  for (const slug of slugDirs) {
    const slugDir = path.join(rootDir, slug);
    const competitorJsonPath = path.join(slugDir, 'competitor.json');

    if (!(await fileExists(competitorJsonPath))) continue;

    const competitorData = validateCompetitor(await readJsonFile(competitorJsonPath));
    const competitorId = await upsertCompetitor(competitorData.name, competitorData.competitor_type);

    // Process versions
    const versionsDir = path.join(slugDir, 'versions');
    if (!(await dirExists(versionsDir))) continue;

    const versionFiles = (await fs.readdir(versionsDir))
      .filter((f) => f.endsWith('.json'))
      .sort(); // e.g. v1.json, v2.json — alphabetical gives version order

    for (const versionFile of versionFiles) {
      const versionFilePath = path.join(versionsDir, versionFile);
      const versionData = validateCompetitorVersion(await readJsonFile(versionFilePath));

      // Resolve system_prompt_ref if present
      let resolvedSystemPrompt = versionData.prompt_bundle.system_prompt;
      if (versionData.prompt_bundle.system_prompt_ref) {
        const promptPath = path.join(
          slugDir,
          'prompts',
          versionData.prompt_bundle.system_prompt_ref,
        );
        resolvedSystemPrompt = await fs.readFile(promptPath, 'utf-8');
      }

      // Clean up undefined fields for content-addressing
      const cleanBundle: Record<string, unknown> = {};
      if (resolvedSystemPrompt !== undefined) cleanBundle['system_prompt'] = resolvedSystemPrompt;
      if (versionData.prompt_bundle.skills !== undefined)
        cleanBundle['skills'] = versionData.prompt_bundle.skills;

      const executionContract = {
        model_provider: versionData.model_provider,
        model_identifier: versionData.model_identifier,
        prompt_bundle: cleanBundle,
        model_parameters: versionData.model_parameters,
        source_type: versionData.source_type,
      };

      const hash = contentHash(executionContract);

      // Check if this exact content hash already exists for THIS competitor
      const existingByHash = await db
        .select({ id: competitorVersions.id })
        .from(competitorVersions)
        .where(and(eq(competitorVersions.competitorId, competitorId), eq(competitorVersions.contentHash, hash)))
        .limit(1);

      if (existingByHash.length > 0) {
        unchanged++;
        continue;
      }

      // Resolve parent if specified
      let parentVersionId: string | null = null;
      if (versionData.parent) {
        parentVersionId = await resolveParentVersionId(
          versionData.parent.slug,
          versionData.parent.version,
          slugToName,
        );
      }

      // Determine next version number for this competitor
      const existingVersions = await db
        .select({ version: competitorVersions.version })
        .from(competitorVersions)
        .where(eq(competitorVersions.competitorId, competitorId));

      const nextVersion =
        existingVersions.length === 0
          ? 1
          : Math.max(...existingVersions.map((v) => v.version)) + 1;

      // Insert new immutable version
      await db.insert(competitorVersions).values({
        competitorId,
        version: nextVersion,
        parentCompetitorVersionId: parentVersionId ?? undefined,
        modelProvider: versionData.model_provider,
        modelIdentifier: versionData.model_identifier,
        promptBundleJson: cleanBundle,
        modelParametersJson: versionData.model_parameters,
        sourceType: versionData.source_type,
        contentHash: hash,
      });

      created++;
    }
  }

  return { created, unchanged };
}
