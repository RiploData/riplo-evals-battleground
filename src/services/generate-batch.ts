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

export interface EligibleCells {
  /** Latest eligible case_version id per eligible case. */
  eligibleCaseVersionIds: string[];
  /** Competitor_version ids whose competitor is enabled AND status='active'. */
  eligibleCompetitorVersionIds: string[];
  /** Replicates per cell (campaign.replicates ?? 1). */
  replicates: number;
}

/**
 * Resolves the eligible cell matrix for a campaign: the latest eligible case
 * version per case (isCaseEligible) × enabled+active competitor versions, plus
 * the replicate count. This is the single source of truth for "which cells should
 * exist", shared by the battleground, batch generation, and the status report.
 *
 * Returns empty arrays (replicates ≥ 1) when the campaign, suite, cases, or
 * competitors resolve to nothing.
 */
export async function resolveEligibleCells(campaignId: string): Promise<EligibleCells> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  const replicates = campaign?.replicates ?? 1;
  const empty: EligibleCells = {
    eligibleCaseVersionIds: [],
    eligibleCompetitorVersionIds: [],
    replicates,
  };

  if (!campaign) return empty;

  const rawEligibleCvIds = campaign.eligibleCompetitorVersionIds as string[];
  if (rawEligibleCvIds.length === 0) return empty;

  // Competitor versions: enabled competitor + active status.
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

  const eligibleCompetitorVersionIds = enabledCvRows.map((r) => r.id);
  if (eligibleCompetitorVersionIds.length === 0) return empty;

  // Suite → cases → latest version per case → filter by isCaseEligible.
  const [sv] = await db
    .select({ suiteId: suiteVersions.suiteId })
    .from(suiteVersions)
    .where(eq(suiteVersions.id, campaign.suiteVersionId))
    .limit(1);

  if (!sv) return empty;

  const allCases = await db
    .select({
      id: cases.id,
      retiredAt: cases.retiredAt,
      eligibleOverride: cases.eligibleOverride,
    })
    .from(cases)
    .where(eq(cases.suiteId, sv.suiteId));

  if (allCases.length === 0) return empty;

  const caseIds = allCases.map((c) => c.id);

  const allCvRows = await db
    .select({
      id: caseVersions.id,
      caseId: caseVersions.caseId,
      version: caseVersions.version,
      datasetSplit: caseVersions.datasetSplit,
    })
    .from(caseVersions)
    .where(inArray(caseVersions.caseId, caseIds));

  const latestByCaseId = new Map<string, (typeof allCvRows)[0]>();
  for (const cv of allCvRows) {
    const existing = latestByCaseId.get(cv.caseId);
    if (!existing || cv.version > existing.version) {
      latestByCaseId.set(cv.caseId, cv);
    }
  }

  const eligibleCaseVersionIds = allCases
    .map((c) => {
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

  return { eligibleCaseVersionIds, eligibleCompetitorVersionIds, replicates };
}

export interface CampaignCellState {
  /** Eligible cells: cases × competitors × replicates. */
  total: number;
  /** Cells with a cached model_generation response (serveable in the battleground). */
  ready: number;
  /** Cells with no cached response yet (total − ready). */
  missing: number;
  /** Missing cells that have ≥1 failed generation attempt — the genuinely-broken ones. */
  missingWithFailures: number;
}

function cellTriple(caseVersionId: string, competitorVersionId: string, replicateIndex: number): string {
  return `${caseVersionId}|${competitorVersionId}|${replicateIndex}`;
}

/**
 * Reports the CURRENT state of a campaign's eligible cells, by distinct cell —
 * not the historical generation_attempts log. Re-running generation on a fixed set
 * of broken cells leaves these counts stable (the attempt log still grows, but it's
 * no longer surfaced as if it were current state).
 */
export async function campaignCellState(campaignId: string): Promise<CampaignCellState> {
  const { eligibleCaseVersionIds, eligibleCompetitorVersionIds, replicates } =
    await resolveEligibleCells(campaignId);

  const total = eligibleCaseVersionIds.length * eligibleCompetitorVersionIds.length * replicates;
  if (total === 0) {
    return { total: 0, ready: 0, missing: 0, missingWithFailures: 0 };
  }

  // Ready cells: one model_generation response per (case, competitor, replicate).
  const readyRows = await db
    .select({
      caseVersionId: responses.caseVersionId,
      competitorVersionId: responses.competitorVersionId,
      replicateIndex: responses.replicateIndex,
    })
    .from(responses)
    .where(
      and(
        inArray(responses.caseVersionId, eligibleCaseVersionIds),
        inArray(responses.competitorVersionId, eligibleCompetitorVersionIds),
        eq(responses.originType, 'model_generation'),
      ),
    );

  const readySet = new Set<string>();
  for (const r of readyRows) {
    if (!r.competitorVersionId || r.replicateIndex >= replicates) continue;
    readySet.add(cellTriple(r.caseVersionId, r.competitorVersionId, r.replicateIndex));
  }
  const ready = readySet.size;
  const missing = total - ready;

  // Missing cells that have logged a failure: distinct failing cells, not attempt rows.
  const failedRows = await db
    .select({
      caseVersionId: generationAttempts.caseVersionId,
      competitorVersionId: generationAttempts.competitorVersionId,
      replicateIndex: generationAttempts.replicateIndex,
    })
    .from(generationAttempts)
    .where(
      and(
        eq(generationAttempts.campaignId, campaignId),
        eq(generationAttempts.status, 'failed'),
        inArray(generationAttempts.caseVersionId, eligibleCaseVersionIds),
        inArray(generationAttempts.competitorVersionId, eligibleCompetitorVersionIds),
      ),
    );

  const failingMissing = new Set<string>();
  for (const r of failedRows) {
    if (r.replicateIndex >= replicates) continue;
    const key = cellTriple(r.caseVersionId, r.competitorVersionId, r.replicateIndex);
    if (!readySet.has(key)) failingMissing.add(key);
  }

  return { total, ready, missing, missingWithFailures: failingMissing.size };
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

  // 1-3. Resolve the eligible cell matrix (cases × competitors × replicates).
  const { eligibleCaseVersionIds, eligibleCompetitorVersionIds: eligibleCvIds, replicates } =
    await resolveEligibleCells(campaignId);

  if (eligibleCaseVersionIds.length === 0 || eligibleCvIds.length === 0) {
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
