import { eq, and, lte, inArray, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  judgments,
  assignments,
  comparisons,
  responses,
  competitorVersions,
  competitors,
  rankingRuns,
  rankingScores,
} from '@/db/schema';
import { requireRole, type SessionUser } from '@/auth/workos';
import { computeRanking, type JudgmentForFit } from '@/domain/ranking/run';
import type { LeaderboardRow, Outcome } from '@/types/contracts';

const DEFAULT_SEED = 42;

export interface CreateRankingRunOpts {
  campaignId: string;
  voteCutoffAt?: string;
  filters?: unknown;
  seed?: number;
}

export async function createRankingRun(
  user: SessionUser,
  opts: CreateRankingRunOpts,
): Promise<{ rankingRunId: string }> {
  requireRole(user, 'operator', 'analyst', 'admin');

  const { campaignId, voteCutoffAt, filters, seed } = opts;
  const effectiveSeed = seed ?? DEFAULT_SEED;
  const cutoff = voteCutoffAt ? new Date(voteCutoffAt) : new Date();

  // Load valid judgments up to the cutoff, joining through assignments → comparisons
  const rows = await db
    .select({
      judgmentId: judgments.id,
      outcome: judgments.outcome,
      preferredResponseId: judgments.preferredResponseId,
      leftResponseId: assignments.leftResponseId,
      rightResponseId: assignments.rightResponseId,
      responseOneId: comparisons.responseOneId,
      responseTwoId: comparisons.responseTwoId,
      caseVersionId: comparisons.caseVersionId,
    })
    .from(judgments)
    .innerJoin(assignments, eq(judgments.assignmentId, assignments.id))
    .innerJoin(comparisons, eq(assignments.comparisonId, comparisons.id))
    .where(
      and(
        eq(judgments.status, 'valid'),
        eq(comparisons.campaignId, campaignId),
        lte(judgments.submittedAt, cutoff),
      ),
    );

  // Collect all response IDs that need competitor version resolution
  const allResponseIds = new Set<string>();
  for (const row of rows) {
    allResponseIds.add(row.responseOneId);
    allResponseIds.add(row.responseTwoId);
    allResponseIds.add(row.leftResponseId);
    allResponseIds.add(row.rightResponseId);
  }

  const responseCompetitorMap = new Map<string, string | null>();

  if (allResponseIds.size > 0) {
    const responseIdList = Array.from(allResponseIds);
    const allResponses = await db
      .select({ id: responses.id, competitorVersionId: responses.competitorVersionId })
      .from(responses)
      .where(inArray(responses.id, responseIdList));

    for (const r of allResponses) {
      responseCompetitorMap.set(r.id, r.competitorVersionId ?? null);
    }
  }

  // Map judgments to JudgmentForFit
  const judgmentsForFit: JudgmentForFit[] = [];

  for (const row of rows) {
    // responseOne and responseTwo are the two competitors in the comparison
    const cvA = responseCompetitorMap.get(row.responseOneId);
    const cvB = responseCompetitorMap.get(row.responseTwoId);

    if (!cvA || !cvB) continue; // skip if we can't resolve competitor versions

    const outcome = row.outcome as Outcome;

    // Determine preferredCompetitorVersionId based on left/right outcome
    let preferredCompetitorVersionId: string | null = null;

    if (outcome === 'left') {
      preferredCompetitorVersionId = responseCompetitorMap.get(row.leftResponseId) ?? null;
    } else if (outcome === 'right') {
      preferredCompetitorVersionId = responseCompetitorMap.get(row.rightResponseId) ?? null;
    }
    // tie, both_unacceptable, cannot_assess → preferredCompetitorVersionId stays null

    judgmentsForFit.push({
      competitorVersionIdA: cvA,
      competitorVersionIdB: cvB,
      caseVersionId: row.caseVersionId,
      outcome,
      preferredCompetitorVersionId,
    });
  }

  // Compute rankings (empty array → no scores written, but run is still recorded)
  const scores = judgmentsForFit.length > 0
    ? computeRanking(judgmentsForFit, effectiveSeed)
    : [];

  // Write ranking_runs row
  const [runRow] = await db
    .insert(rankingRuns)
    .values({
      campaignId,
      algorithm: 'bradley_terry',
      parametersJson: { seed: effectiveSeed },
      voteCutoffAt: cutoff,
      filtersJson: filters ?? {},
    })
    .returning({ id: rankingRuns.id });

  const rankingRunId = runRow.id;

  // Write ranking_scores rows
  if (scores.length > 0) {
    await db.insert(rankingScores).values(
      scores.map((s) => ({
        rankingRunId,
        competitorVersionId: s.competitorVersionId,
        rawScore: s.rawScore,
        displayScore: s.displayScore,
        rank: s.rank,
        rankLower: s.rankLower,
        rankUpper: s.rankUpper,
        confidenceLower: s.confidenceLower,
        confidenceUpper: s.confidenceUpper,
        judgmentCount: s.judgmentCount,
        caseCount: s.caseCount,
        tieRate: s.tieRate,
        unacceptableRate: s.unacceptableRate,
      })),
    );
  }

  return { rankingRunId };
}

export async function getLeaderboard(rankingRunId?: string): Promise<LeaderboardRow[]> {
  let resolvedRunId: string;

  if (rankingRunId) {
    resolvedRunId = rankingRunId;
  } else {
    // Get the latest ranking run
    const [latest] = await db
      .select({ id: rankingRuns.id })
      .from(rankingRuns)
      .orderBy(desc(rankingRuns.createdAt))
      .limit(1);

    if (!latest) return [];
    resolvedRunId = latest.id;
  }

  const rows = await db
    .select({
      competitor_version_id: rankingScores.competitorVersionId,
      competitor_name: competitors.name,
      version: competitorVersions.version,
      display_score: rankingScores.displayScore,
      rank: rankingScores.rank,
      rank_lower: rankingScores.rankLower,
      rank_upper: rankingScores.rankUpper,
      confidence_lower: rankingScores.confidenceLower,
      confidence_upper: rankingScores.confidenceUpper,
      judgment_count: rankingScores.judgmentCount,
      case_count: rankingScores.caseCount,
      tie_rate: rankingScores.tieRate,
      unacceptable_rate: rankingScores.unacceptableRate,
    })
    .from(rankingScores)
    .innerJoin(competitorVersions, eq(rankingScores.competitorVersionId, competitorVersions.id))
    .innerJoin(competitors, eq(competitorVersions.competitorId, competitors.id))
    .where(eq(rankingScores.rankingRunId, resolvedRunId))
    .orderBy(rankingScores.rank);

  return rows.map((r) => ({
    competitor_version_id: r.competitor_version_id,
    competitor_name: r.competitor_name,
    version: r.version,
    display_score: r.display_score,
    rank: r.rank,
    rank_lower: r.rank_lower,
    rank_upper: r.rank_upper,
    confidence_lower: r.confidence_lower,
    confidence_upper: r.confidence_upper,
    judgment_count: r.judgment_count ?? 0,
    case_count: r.case_count ?? 0,
    tie_rate: r.tie_rate,
    unacceptable_rate: r.unacceptable_rate,
  }));
}
