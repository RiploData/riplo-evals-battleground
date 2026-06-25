import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  generationAttempts,
  responses,
  campaigns,
  suiteVersions,
  cases,
  caseVersions,
  competitors,
  competitorVersions,
} from '@/db/schema';
import { ensureResponse } from '@/services/generation/runner';
import { isCaseEligible } from '@/domain/eligibility';
import type { SessionUser } from '@/auth/workos';
import type { GenerationProvider } from '@/services/generation/provider';

export interface EnqueueBody {
  campaignId: string;
  caseVersionIds: string[];
  competitorVersionIds: string[];
  replicates?: number;
}

export interface EnqueueResult {
  enqueued: number;
  completed: number;
}

/**
 * Synchronously calls ensureResponse for each (caseVersionId × competitorVersionId × replicateIndex)
 * cell. Cells already cached are no-ops; the queued-row contract is upheld inside ensureResponse.
 *
 * Returns `enqueued` (total cells attempted) and `completed` (responses that now exist, including
 * those that were already cached before this call).
 */
export async function enqueueGeneration(
  _user: SessionUser,
  body: EnqueueBody,
  provider?: GenerationProvider,
): Promise<EnqueueResult> {
  const { campaignId, caseVersionIds, competitorVersionIds, replicates = 1 } = body;

  let enqueued = 0;
  let completed = 0;

  for (const caseVersionId of caseVersionIds) {
    for (const competitorVersionId of competitorVersionIds) {
      for (let replicateIndex = 0; replicateIndex < replicates; replicateIndex++) {
        enqueued++;
        try {
          await ensureResponse(
            caseVersionId,
            competitorVersionId,
            replicateIndex,
            campaignId,
            provider,
          );
          completed++;
        } catch {
          // Provider failure — cell was attempted but not completed; continue with remaining cells
        }
      }
    }
  }

  return { enqueued, completed };
}

/**
 * Returns counts of generation_attempts grouped by status for the given campaign.
 */
export async function generationStatus(campaignId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: generationAttempts.status,
    })
    .from(generationAttempts)
    .where(eq(generationAttempts.campaignId, campaignId));

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

// ── Bounded concurrency helper ────────────────────────────────────────────────

async function runWithConcurrency(
  tasks: (() => Promise<void>)[],
  limit: number,
  deadlineAt?: number,
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < tasks.length) {
      // Stop launching new cells once the time budget is exhausted (the caller
      // returns `remaining` so the client can resume with another request).
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) return;
      const i = index++;
      await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
}

export interface EnqueueMissingResult {
  generated: number;
  skipped: number;
  failed: number;
  total: number;
  /** Cells still missing a response after this call (call again to continue). */
  remaining: number;
}

export interface EnqueueMissingOpts {
  /** Stop launching new cells after this many ms (default 40s, to fit a 60s function limit). */
  deadlineMs?: number;
  /** Max cells in flight (default 6). */
  concurrency?: number;
}

/**
 * Resolves eligible case_versions × enabled competitor_versions × replicates for
 * the given campaign and calls ensureResponse for each missing cell.
 *
 * - already-cached cells → skipped
 * - newly generated cells → generated
 * - provider errors → failed (does not abort remaining cells)
 * - max 4 cells in-flight concurrently
 *
 * Eligibility uses the same logic as battle: isCaseEligible on the latest case
 * version, and competitor must be enabled + status='active'.
 */
export async function enqueueMissingForCampaign(
  _user: SessionUser,
  campaignId: string,
  provider?: GenerationProvider,
  opts?: EnqueueMissingOpts,
): Promise<EnqueueMissingResult> {
  const deadlineAt = Date.now() + (opts?.deadlineMs ?? 40_000);
  const concurrency = opts?.concurrency ?? 6;
  // 1. Load campaign
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const rawEligibleCvIds = campaign.eligibleCompetitorVersionIds as string[];
  const replicates = campaign.replicates ?? 1;

  if (rawEligibleCvIds.length === 0) {
    return { generated: 0, skipped: 0, failed: 0, total: 0, remaining: 0 };
  }

  // 2. Filter competitor versions: enabled competitor + active status
  const enabledCvRows = await db
    .select({ id: competitorVersions.id })
    .from(competitorVersions)
    .innerJoin(competitors, eq(competitors.id, competitorVersions.competitorId))
    .where(
      and(
        inArray(competitorVersions.id, rawEligibleCvIds),
        eq(competitors.enabled, true),
        eq(competitorVersions.status, 'active'),
      ),
    );

  const eligibleCvIds = enabledCvRows.map(r => r.id);

  if (eligibleCvIds.length === 0) {
    return { generated: 0, skipped: 0, failed: 0, total: 0, remaining: 0 };
  }

  // 3. Resolve eligible case versions
  const [sv] = await db
    .select({ suiteId: suiteVersions.suiteId })
    .from(suiteVersions)
    .where(eq(suiteVersions.id, campaign.suiteVersionId))
    .limit(1);

  if (!sv) {
    return { generated: 0, skipped: 0, failed: 0, total: 0, remaining: 0 };
  }

  const allCases = await db
    .select({
      id: cases.id,
      retiredAt: cases.retiredAt,
      eligibleOverride: cases.eligibleOverride,
    })
    .from(cases)
    .where(eq(cases.suiteId, sv.suiteId));

  if (allCases.length === 0) {
    return { generated: 0, skipped: 0, failed: 0, total: 0, remaining: 0 };
  }

  const caseIds = allCases.map(c => c.id);

  const allCvRows = await db
    .select({
      id: caseVersions.id,
      caseId: caseVersions.caseId,
      version: caseVersions.version,
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

  const eligibleCaseVersionIds = allCases
    .map(c => {
      const latestCv = latestByCaseId.get(c.id);
      if (!latestCv) return null;
      if (
        !isCaseEligible({
          retiredAt: c.retiredAt,
          eligibleOverride: c.eligibleOverride,
          latestSplit: latestCv.datasetSplit,
        })
      ) {
        return null;
      }
      return latestCv.id;
    })
    .filter((id): id is string => id !== null);

  if (eligibleCaseVersionIds.length === 0) {
    return { generated: 0, skipped: 0, failed: 0, total: 0, remaining: 0 };
  }

  // 4. Build cell list
  type Cell = { caseVersionId: string; competitorVersionId: string; replicateIndex: number };
  const cells: Cell[] = [];
  for (const caseVersionId of eligibleCaseVersionIds) {
    for (const competitorVersionId of eligibleCvIds) {
      for (let replicateIndex = 0; replicateIndex < replicates; replicateIndex++) {
        cells.push({ caseVersionId, competitorVersionId, replicateIndex });
      }
    }
  }

  const total = cells.length;
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  // 5. Process with bounded concurrency (max 4 in-flight)
  const tasks = cells.map(cell => async () => {
    // Cache check: if a response already exists, count as skipped
    const existing = await db
      .select({ id: responses.id })
      .from(responses)
      .where(
        and(
          eq(responses.caseVersionId, cell.caseVersionId),
          eq(responses.competitorVersionId, cell.competitorVersionId),
          eq(responses.replicateIndex, cell.replicateIndex),
          eq(responses.originType, 'model_generation'),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      return;
    }

    try {
      await ensureResponse(
        cell.caseVersionId,
        cell.competitorVersionId,
        cell.replicateIndex,
        campaignId,
        provider,
      );
      generated++;
    } catch {
      failed++;
    }
  });

  await runWithConcurrency(tasks, concurrency, deadlineAt);

  // Cells still missing after this call (unreached due to the time budget, or failed).
  const remaining = total - skipped - generated;
  return { generated, skipped, failed, total, remaining };
}
