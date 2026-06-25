import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { cases, caseVersions, competitors, competitorVersions } from '@/db/schema';
import { isCaseEligible } from '@/domain/eligibility';

export interface CaseEligibilityRow {
  caseId: string;
  caseVersionId: string;
  externalRef: string | null;
  kind: string;
  title: string;
  datasetSplit: string;
  version: number;
  retiredAt: Date | null;
  eligibleOverride: boolean | null;
  defaultEligible: boolean;
  effectiveEligible: boolean;
}

/**
 * Returns one row per case (latest version), with default and effective eligibility computed.
 * Default eligibility ignores the override; effective eligibility applies it.
 */
export async function listCasesWithEligibility(): Promise<CaseEligibilityRow[]> {
  const allCases = await db
    .select({
      id: cases.id,
      externalRef: cases.externalRef,
      retiredAt: cases.retiredAt,
      eligibleOverride: cases.eligibleOverride,
    })
    .from(cases);

  if (allCases.length === 0) return [];

  const caseIds = allCases.map(c => c.id);

  const allCvRows = await db
    .select({
      id: caseVersions.id,
      caseId: caseVersions.caseId,
      version: caseVersions.version,
      kind: caseVersions.kind,
      title: caseVersions.title,
      datasetSplit: caseVersions.datasetSplit,
    })
    .from(caseVersions)
    .where(inArray(caseVersions.caseId, caseIds));

  // Find latest version per case
  const latestByCaseId = new Map<string, (typeof allCvRows)[0]>();
  for (const cv of allCvRows) {
    const existing = latestByCaseId.get(cv.caseId);
    if (!existing || cv.version > existing.version) {
      latestByCaseId.set(cv.caseId, cv);
    }
  }

  const result: CaseEligibilityRow[] = [];
  for (const c of allCases) {
    const latestCv = latestByCaseId.get(c.id);
    if (!latestCv) continue;

    const defaultEligible = isCaseEligible({
      retiredAt: c.retiredAt,
      eligibleOverride: null,
      latestSplit: latestCv.datasetSplit,
    });
    const effectiveEligible = isCaseEligible({
      retiredAt: c.retiredAt,
      eligibleOverride: c.eligibleOverride,
      latestSplit: latestCv.datasetSplit,
    });

    result.push({
      caseId: c.id,
      caseVersionId: latestCv.id,
      externalRef: c.externalRef,
      kind: latestCv.kind,
      title: latestCv.title,
      datasetSplit: latestCv.datasetSplit,
      version: latestCv.version,
      retiredAt: c.retiredAt,
      eligibleOverride: c.eligibleOverride,
      defaultEligible,
      effectiveEligible,
    });
  }

  return result;
}

/**
 * Set or clear the admin eligibility override for a case.
 * Pass null to clear the override (revert to default rule).
 * Does NOT touch retired_at (importer-owned).
 */
export async function setCaseEligibility(
  caseId: string,
  override: boolean | null,
): Promise<void> {
  await db
    .update(cases)
    .set({ eligibleOverride: override })
    .where(eq(cases.id, caseId));
}

export interface CompetitorStatusRow {
  competitorId: string;
  name: string;
  enabled: boolean;
  versionCount: number;
  latestModelIdentifier: string | null;
}

/**
 * Returns one row per competitor with aggregated version info.
 */
export async function listCompetitorsWithStatus(): Promise<CompetitorStatusRow[]> {
  const allCompetitors = await db
    .select({
      id: competitors.id,
      name: competitors.name,
      enabled: competitors.enabled,
    })
    .from(competitors);

  if (allCompetitors.length === 0) return [];

  const allVersions = await db
    .select({
      competitorId: competitorVersions.competitorId,
      version: competitorVersions.version,
      modelIdentifier: competitorVersions.modelIdentifier,
    })
    .from(competitorVersions);

  const versionsByCompetitorId = new Map<string, (typeof allVersions)>();
  for (const v of allVersions) {
    const existing = versionsByCompetitorId.get(v.competitorId) ?? [];
    existing.push(v);
    versionsByCompetitorId.set(v.competitorId, existing);
  }

  return allCompetitors.map(comp => {
    const versions = versionsByCompetitorId.get(comp.id) ?? [];
    const latest = versions.reduce<(typeof versions)[0] | null>((best, v) => {
      return best === null || v.version > best.version ? v : best;
    }, null);

    return {
      competitorId: comp.id,
      name: comp.name,
      enabled: comp.enabled,
      versionCount: versions.length,
      latestModelIdentifier: latest?.modelIdentifier ?? null,
    };
  });
}

/**
 * Enable or disable a competitor. Disabled competitors are excluded from battle
 * and generate-missing eligibility checks.
 */
export async function setCompetitorEnabled(
  competitorId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .update(competitors)
    .set({ enabled })
    .where(eq(competitors.id, competitorId));
}
