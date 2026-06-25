/**
 * Reports service: head-to-head, segments, position-bias.
 *
 * Segments approach (v1 documentation):
 *   We chose to compute per-segment win-rate summaries rather than a full BT refit
 *   per segment. Rationale: `computeRanking` from `src/domain/ranking/run.ts` is
 *   computationally cheap (pure in-memory BT + bootstrap), but the bootstrap with
 *   ~200 samples is only reliable when each competitor has enough judgments per
 *   segment (≥20+). In typical segment slices that threshold is rarely met, so a
 *   raw win-rate summary (wins / decisive_judgments) is both more honest and faster.
 *   We still return full LeaderboardRow shape; display_score/rank fields are null
 *   unless a segment has enough data. If you later want BT-per-segment, call
 *   `computeRanking(segmentJudgments, seed)` here and map to LeaderboardRow.
 */

import { db } from '@/db/client';
import {
  judgments,
  assignments,
  comparisons,
  responses,
  competitorVersions,
  competitors,
  caseVersions,
  rankingScores,
  rankingRuns,
} from '@/db/schema';
import { eq, and, inArray, isNull, or } from 'drizzle-orm';
import type { LeaderboardRow } from '@/types/contracts';

// ─────────────────────────────────────────────
// headToHead
// ─────────────────────────────────────────────

export interface HeadToHeadResult {
  competitors: string[];
  /** matrix[i][j] = win-count for competitor i against competitor j (ties = 0.5 each) */
  matrix: number[][];
  /** competitor-version id → human-readable label (e.g. "vanilla-openai v1") */
  labels: Record<string, string>;
}

export async function headToHead(rankingRunId?: string): Promise<HeadToHeadResult> {
  // 1. Gather judgments with full join to resolve competitor versions
  const rows = await db
    .select({
      judgmentId: judgments.id,
      outcome: judgments.outcome,
      preferredResponseId: judgments.preferredResponseId,
      leftResponseId: assignments.leftResponseId,
      rightResponseId: assignments.rightResponseId,
      responseOneCvId: responses.competitorVersionId,
    })
    .from(judgments)
    .innerJoin(assignments, eq(judgments.assignmentId, assignments.id))
    .innerJoin(comparisons, eq(assignments.comparisonId, comparisons.id))
    .innerJoin(responses, eq(comparisons.responseOneId, responses.id))
    .where(eq(judgments.status, 'valid'));

  // We need responseOne + responseTwo competitor version IDs
  // Re-query with both responses joined
  const fullRows = await db
    .select({
      judgmentId: judgments.id,
      outcome: judgments.outcome,
      preferredResponseId: judgments.preferredResponseId,
      leftResponseId: assignments.leftResponseId,
      rightResponseId: assignments.rightResponseId,
      comparisonId: comparisons.id,
      rankingRunId: rankingScores.rankingRunId,
      responseOneCvId: responses.competitorVersionId,
    })
    .from(judgments)
    .innerJoin(assignments, eq(judgments.assignmentId, assignments.id))
    .innerJoin(comparisons, eq(assignments.comparisonId, comparisons.id))
    .innerJoin(responses, eq(comparisons.responseOneId, responses.id))
    .leftJoin(
      rankingScores,
      eq(responses.competitorVersionId, rankingScores.competitorVersionId),
    )
    .where(eq(judgments.status, 'valid'));

  // That approach is messy — do two separate selects for the two response cvIds
  // and join in memory. Much simpler.
  const judgmentRows = await db
    .select({
      judgmentId: judgments.id,
      outcome: judgments.outcome,
      preferredResponseId: judgments.preferredResponseId,
      comparisonId: comparisons.id,
      campaignId: comparisons.campaignId,
      responseOneId: comparisons.responseOneId,
      responseTwoId: comparisons.responseTwoId,
      leftResponseId: assignments.leftResponseId,
      rightResponseId: assignments.rightResponseId,
    })
    .from(judgments)
    .innerJoin(assignments, eq(judgments.assignmentId, assignments.id))
    .innerJoin(comparisons, eq(assignments.comparisonId, comparisons.id))
    .where(eq(judgments.status, 'valid'));

  if (judgmentRows.length === 0) {
    return { competitors: [], matrix: [], labels: {} };
  }

  // Collect all response IDs we need to look up
  const responseIds = new Set<string>();
  for (const r of judgmentRows) {
    responseIds.add(r.responseOneId);
    responseIds.add(r.responseTwoId);
  }

  // Fetch competitor version IDs for all responses
  const responseCompetitorRows = await db
    .select({ id: responses.id, competitorVersionId: responses.competitorVersionId })
    .from(responses)
    .where(inArray(responses.id, Array.from(responseIds)));

  const responseToCv = new Map<string, string>();
  for (const r of responseCompetitorRows) {
    if (r.competitorVersionId) {
      responseToCv.set(r.id, r.competitorVersionId);
    }
  }

  // Filter by rankingRun if provided
  let filteredJudgments = judgmentRows;
  if (rankingRunId) {
    // Get the ranking run to find the campaign
    const [run] = await db
      .select()
      .from(rankingRuns)
      .where(eq(rankingRuns.id, rankingRunId));
    if (run?.campaignId) {
      filteredJudgments = judgmentRows.filter((j) => j.campaignId === run.campaignId);
    }
  }

  // Collect all competitor version IDs
  const cvSet = new Set<string>();
  for (const j of filteredJudgments) {
    const cvA = responseToCv.get(j.responseOneId);
    const cvB = responseToCv.get(j.responseTwoId);
    if (cvA) cvSet.add(cvA);
    if (cvB) cvSet.add(cvB);
  }

  const competitorList = Array.from(cvSet).sort();
  const n = competitorList.length;
  const indexMap = new Map(competitorList.map((cv, i) => [cv, i]));

  // Build n×n matrix
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (const j of filteredJudgments) {
    const cvA = responseToCv.get(j.responseOneId);
    const cvB = responseToCv.get(j.responseTwoId);
    if (!cvA || !cvB || cvA === cvB) continue;

    const idxA = indexMap.get(cvA)!;
    const idxB = indexMap.get(cvB)!;

    const outcome = j.outcome;

    if (outcome === 'tie') {
      matrix[idxA][idxB] += 0.5;
      matrix[idxB][idxA] += 0.5;
    } else if (outcome === 'left' || outcome === 'right') {
      // preferred response → winning competitor
      const preferredCv = j.preferredResponseId
        ? responseToCv.get(j.preferredResponseId)
        : undefined;

      if (preferredCv) {
        const winnerIdx = indexMap.get(preferredCv);
        const loserCv = preferredCv === cvA ? cvB : cvA;
        const loserIdx = indexMap.get(loserCv);
        if (winnerIdx !== undefined && loserIdx !== undefined) {
          matrix[winnerIdx][loserIdx] += 1;
        }
      }
    }
    // both_unacceptable / cannot_assess → skip
  }

  // Resolve human-readable labels for each competitor version in play
  const labels: Record<string, string> = {};
  if (competitorList.length > 0) {
    const labelRows = await db
      .select({
        cvId: competitorVersions.id,
        version: competitorVersions.version,
        name: competitors.name,
      })
      .from(competitorVersions)
      .innerJoin(competitors, eq(competitorVersions.competitorId, competitors.id))
      .where(inArray(competitorVersions.id, competitorList));
    for (const r of labelRows) {
      labels[r.cvId] = `${r.name} v${r.version}`;
    }
  }

  return { competitors: competitorList, matrix, labels };
}

// ─────────────────────────────────────────────
// segments
// ─────────────────────────────────────────────

export async function segments(
  rankingRunId: string | undefined,
  by: 'tag' | 'kind' | 'difficulty',
): Promise<Array<{ segment: string; rows: LeaderboardRow[] }>> {
  // Pull judgments with case metadata
  const judgmentRows = await db
    .select({
      judgmentId: judgments.id,
      outcome: judgments.outcome,
      preferredResponseId: judgments.preferredResponseId,
      responseOneId: comparisons.responseOneId,
      responseTwoId: comparisons.responseTwoId,
      caseVersionId: comparisons.caseVersionId,
      campaignId: comparisons.campaignId,
      kind: caseVersions.kind,
      tags: caseVersions.tags,
      hiddenMetadataJson: caseVersions.hiddenMetadataJson,
    })
    .from(judgments)
    .innerJoin(assignments, eq(judgments.assignmentId, assignments.id))
    .innerJoin(comparisons, eq(assignments.comparisonId, comparisons.id))
    .innerJoin(caseVersions, eq(comparisons.caseVersionId, caseVersions.id))
    .where(eq(judgments.status, 'valid'));

  // Filter by ranking run if provided
  let filtered = judgmentRows;
  if (rankingRunId) {
    const [run] = await db
      .select()
      .from(rankingRuns)
      .where(eq(rankingRuns.id, rankingRunId));
    if (run?.campaignId) {
      filtered = judgmentRows.filter((j) => j.campaignId === run.campaignId);
    }
  }

  // Collect response IDs for CV lookup
  const responseIds = new Set<string>();
  for (const r of filtered) {
    responseIds.add(r.responseOneId);
    responseIds.add(r.responseTwoId);
  }

  const responseCompetitorRows = await db
    .select({
      id: responses.id,
      competitorVersionId: responses.competitorVersionId,
    })
    .from(responses)
    .where(inArray(responses.id, Array.from(responseIds)));

  const responseToCv = new Map<string, string>();
  for (const r of responseCompetitorRows) {
    if (r.competitorVersionId) responseToCv.set(r.id, r.competitorVersionId);
  }

  // Gather competitor version metadata for display
  const allCvIds = Array.from(new Set(Array.from(responseToCv.values())));
  const cvMeta =
    allCvIds.length > 0
      ? await db
          .select({
            id: competitorVersions.id,
            version: competitorVersions.version,
            competitorId: competitorVersions.competitorId,
          })
          .from(competitorVersions)
          .where(inArray(competitorVersions.id, allCvIds))
      : [];

  const competitorMeta =
    cvMeta.length > 0
      ? await db
          .select({ id: competitors.id, name: competitors.name })
          .from(competitors)
          .where(inArray(competitors.id, cvMeta.map((c) => c.competitorId)))
      : [];

  const competitorNameMap = new Map(competitorMeta.map((c) => [c.id, c.name]));
  const cvMetaMap = new Map(cvMeta.map((c) => [c.id, c]));

  // Group judgments by segment key
  type JRow = (typeof filtered)[0];
  const getSegments = (j: JRow): string[] => {
    if (by === 'kind') return [j.kind];
    if (by === 'tag') {
      const t = j.tags ?? [];
      return t.length > 0 ? t : ['(untagged)'];
    }
    if (by === 'difficulty') {
      const meta = j.hiddenMetadataJson as Record<string, unknown> | null;
      const diff = meta?.difficulty as string | undefined;
      return [diff ?? '(unknown)'];
    }
    return ['(unknown)'];
  };

  // Build per-segment, per-competitor accumulators
  // segment → cvId → { wins, losses, ties, unacceptable, judgments, cases }
  type CvStats = {
    wins: number;
    losses: number;
    ties: number;
    unacceptable: number;
    judgmentCount: number;
    caseSet: Set<string>;
  };

  const segmentMap = new Map<string, Map<string, CvStats>>();

  const getOrCreateCvStats = (seg: string, cvId: string): CvStats => {
    if (!segmentMap.has(seg)) segmentMap.set(seg, new Map());
    const m = segmentMap.get(seg)!;
    if (!m.has(cvId)) {
      m.set(cvId, { wins: 0, losses: 0, ties: 0, unacceptable: 0, judgmentCount: 0, caseSet: new Set() });
    }
    return m.get(cvId)!;
  };

  for (const j of filtered) {
    const cvA = responseToCv.get(j.responseOneId);
    const cvB = responseToCv.get(j.responseTwoId);
    if (!cvA || !cvB) continue;

    const segs = getSegments(j);

    for (const seg of segs) {
      const statsA = getOrCreateCvStats(seg, cvA);
      const statsB = getOrCreateCvStats(seg, cvB);

      const outcome = j.outcome;

      if (outcome === 'cannot_assess') continue;

      statsA.judgmentCount++;
      statsB.judgmentCount++;
      statsA.caseSet.add(j.caseVersionId);
      statsB.caseSet.add(j.caseVersionId);

      if (outcome === 'both_unacceptable') {
        statsA.unacceptable++;
        statsB.unacceptable++;
        continue;
      }

      if (outcome === 'tie') {
        statsA.ties++;
        statsB.ties++;
        continue;
      }

      // left/right
      const preferredCv = j.preferredResponseId
        ? responseToCv.get(j.preferredResponseId)
        : undefined;

      if (preferredCv === cvA) {
        statsA.wins++;
        statsB.losses++;
      } else if (preferredCv === cvB) {
        statsB.wins++;
        statsA.losses++;
      }
    }
  }

  // Build output
  const result: Array<{ segment: string; rows: LeaderboardRow[] }> = [];

  for (const [seg, cvMap] of segmentMap.entries()) {
    const rows: LeaderboardRow[] = [];

    // Sort by win rate descending for ranking
    const entries = Array.from(cvMap.entries());
    const decisive = (s: CvStats) => s.wins + s.losses + s.ties * 0.5;
    const winRate = (s: CvStats): number => {
      const d = decisive(s);
      return d > 0 ? (s.wins + s.ties * 0.5) / d : 0;
    };

    entries.sort(([, a], [, b]) => winRate(b) - winRate(a));

    let rank = 1;
    for (const [cvId, stats] of entries) {
      const meta = cvMetaMap.get(cvId);
      const competitorName = meta
        ? (competitorNameMap.get(meta.competitorId) ?? cvId)
        : cvId;

      rows.push({
        competitor_version_id: cvId,
        competitor_name: competitorName,
        version: meta?.version ?? 0,
        display_score: null,       // No BT refit per segment in v1 (see module-level docstring)
        rank: rank++,
        rank_lower: null,
        rank_upper: null,
        confidence_lower: null,
        confidence_upper: null,
        judgment_count: stats.judgmentCount,
        case_count: stats.caseSet.size,
        tie_rate: stats.judgmentCount > 0 ? stats.ties / stats.judgmentCount : null,
        unacceptable_rate:
          stats.judgmentCount > 0 ? stats.unacceptable / stats.judgmentCount : null,
      });
    }

    result.push({ segment: seg, rows });
  }

  // Sort segments alphabetically for determinism
  result.sort((a, b) => a.segment.localeCompare(b.segment));

  return result;
}

// ─────────────────────────────────────────────
// positionBias
// ─────────────────────────────────────────────

export interface PositionBiasRow {
  competitorVersionId: string;
  topWinRate: number;
  bottomWinRate: number;
  n: number;
}

export async function positionBias(campaignId: string): Promise<PositionBiasRow[]> {
  // Fetch all valid judgments for the campaign, with assignment order (left/right)
  const rows = await db
    .select({
      judgmentId: judgments.id,
      outcome: judgments.outcome,
      preferredResponseId: judgments.preferredResponseId,
      leftResponseId: assignments.leftResponseId,
      rightResponseId: assignments.rightResponseId,
      responseOneId: comparisons.responseOneId,
      responseTwoId: comparisons.responseTwoId,
    })
    .from(judgments)
    .innerJoin(assignments, eq(judgments.assignmentId, assignments.id))
    .innerJoin(comparisons, eq(assignments.comparisonId, comparisons.id))
    .where(
      and(
        eq(judgments.status, 'valid'),
        eq(comparisons.campaignId, campaignId),
      ),
    );

  if (rows.length === 0) return [];

  // Collect response IDs
  const responseIds = new Set<string>();
  for (const r of rows) {
    responseIds.add(r.responseOneId);
    responseIds.add(r.responseTwoId);
  }

  const responseCompetitorRows = await db
    .select({ id: responses.id, competitorVersionId: responses.competitorVersionId })
    .from(responses)
    .where(inArray(responses.id, Array.from(responseIds)));

  const responseToCv = new Map<string, string>();
  for (const r of responseCompetitorRows) {
    if (r.competitorVersionId) responseToCv.set(r.id, r.competitorVersionId);
  }

  // Per CV, track top (left) vs bottom (right) position wins
  // topWins/topTotal = when CV's response was shown LEFT (top position)
  // bottomWins/bottomTotal = when CV's response was shown RIGHT (bottom position)
  type BiasStats = {
    topWins: number;
    topTotal: number;
    bottomWins: number;
    bottomTotal: number;
  };

  const cvStats = new Map<string, BiasStats>();

  const getStats = (cvId: string): BiasStats => {
    if (!cvStats.has(cvId)) {
      cvStats.set(cvId, { topWins: 0, topTotal: 0, bottomWins: 0, bottomTotal: 0 });
    }
    return cvStats.get(cvId)!;
  };

  for (const row of rows) {
    const outcome = row.outcome;
    if (outcome === 'cannot_assess' || outcome === 'both_unacceptable') continue;

    // Resolve which CV is on which side
    // leftResponseId is the response shown LEFT (top position) in the UI
    const leftCv = responseToCv.get(row.leftResponseId);
    const rightCv = responseToCv.get(row.rightResponseId);

    if (!leftCv || !rightCv) continue;

    // Determine the winner (if decisive)
    const preferredCv = row.preferredResponseId
      ? responseToCv.get(row.preferredResponseId)
      : undefined;

    const isTie = outcome === 'tie';

    // Left (top) competitor stats
    const leftStats = getStats(leftCv);
    leftStats.topTotal++;
    if (isTie) {
      leftStats.topWins += 0.5;
    } else if (preferredCv === leftCv) {
      leftStats.topWins++;
    }

    // Right (bottom) competitor stats
    const rightStats = getStats(rightCv);
    rightStats.bottomTotal++;
    if (isTie) {
      rightStats.bottomWins += 0.5;
    } else if (preferredCv === rightCv) {
      rightStats.bottomWins++;
    }
  }

  const result: PositionBiasRow[] = [];
  for (const [cvId, stats] of cvStats.entries()) {
    const topWinRate = stats.topTotal > 0 ? stats.topWins / stats.topTotal : 0;
    const bottomWinRate = stats.bottomTotal > 0 ? stats.bottomWins / stats.bottomTotal : 0;
    const n = stats.topTotal + stats.bottomTotal;
    result.push({ competitorVersionId: cvId, topWinRate, bottomWinRate, n });
  }

  return result;
}
