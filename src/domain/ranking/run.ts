/**
 * computeRanking: assembles pairwise preferences from judgments, fits Bradley–Terry,
 * computes bootstrap confidence intervals, and returns ranked competitors.
 *
 * Display score formula (Elo-like):
 *   displayScore = 1500 + (400 / ln(10)) * rawScore
 *
 * This maps the mean-centered log-strength directly onto an Elo scale:
 * - A competitor at average strength gets displayScore ≈ 1500
 * - A competitor 1 natural-log-unit above average gets +173.7 points
 * - The 400/ln(10) ≈ 173.7 factor matches the standard Elo logistic interpretation
 */

import type { Outcome } from '@/types/contracts';
import { fitBradleyTerry, PrefRecord } from './bradley-terry';
import { bootstrapIntervals } from './bootstrap';
import type { BootstrapResult } from './bootstrap';

export type { Outcome };

export interface JudgmentForFit {
  competitorVersionIdA: string;
  competitorVersionIdB: string;
  caseVersionId: string;
  outcome: Outcome; // left/right already resolved to A/B by caller
  preferredCompetitorVersionId: string | null;
}

export interface RankingScore {
  competitorVersionId: string;
  rawScore: number;
  /** displayScore = 1500 + (400 / ln(10)) * rawScore */
  displayScore: number;
  rank: number;
  rankLower: number;
  rankUpper: number;
  confidenceLower: number;
  confidenceUpper: number;
  judgmentCount: number;
  caseCount: number;
  tieRate: number;
  unacceptableRate: number;
}

const DISPLAY_SCALE = 400 / Math.log(10); // ≈ 173.7

/**
 * Compute rankings from a list of judgments using Bradley–Terry + bootstrap CIs.
 *
 * @param judgments - List of pairwise judgments with outcomes resolved to A/B
 * @param seed - Seed for bootstrap PRNG (same seed → identical output)
 * @param bootstrapSamples - Number of bootstrap samples (default 200)
 */
export function computeRanking(
  judgments: JudgmentForFit[],
  seed: number,
  bootstrapSamples = 200,
): RankingScore[] {
  // Collect all competitor IDs
  const competitorSet = new Set<string>();
  for (const j of judgments) {
    competitorSet.add(j.competitorVersionIdA);
    competitorSet.add(j.competitorVersionIdB);
  }
  const competitorIds = Array.from(competitorSet).sort();

  // Per-competitor stats accumulators (excluding cannot_assess)
  const judgmentCounts: Record<string, number> = {};
  const caseSets: Record<string, Set<string>> = {};
  const tieCounts: Record<string, number> = {};
  const unacceptableCounts: Record<string, number> = {};

  for (const id of competitorIds) {
    judgmentCounts[id] = 0;
    caseSets[id] = new Set();
    tieCounts[id] = 0;
    unacceptableCounts[id] = 0;
  }

  // Build pairwise preferences
  const prefs: PrefRecord[] = [];

  for (const j of judgments) {
    const { competitorVersionIdA: a, competitorVersionIdB: b, outcome, caseVersionId } = j;

    // Skip cannot_assess entirely
    if (outcome === 'cannot_assess') continue;

    // Count this judgment for both competitors
    judgmentCounts[a]++;
    judgmentCounts[b]++;
    caseSets[a].add(caseVersionId);
    caseSets[b].add(caseVersionId);

    if (outcome === 'both_unacceptable') {
      // Count toward unacceptableRate but exclude from preference fit
      unacceptableCounts[a]++;
      unacceptableCounts[b]++;
      continue;
    }

    if (outcome === 'tie') {
      // Tie → half-win to each side (two 0.5-weight records)
      prefs.push({ winner: a, loser: b, weight: 0.5 });
      prefs.push({ winner: b, loser: a, weight: 0.5 });
      tieCounts[a]++;
      tieCounts[b]++;
    } else {
      // Decisive outcome: preferred competitor is in preferredCompetitorVersionId
      const winner = j.preferredCompetitorVersionId;
      if (winner === null) continue; // shouldn't happen for left/right but guard anyway
      const loser = winner === a ? b : a;
      prefs.push({ winner, loser, weight: 1 });
    }
  }

  // Fit Bradley–Terry
  const btResult = fitBradleyTerry(competitorIds, prefs);

  // Bootstrap intervals (scores and ranks)
  const bootstrap: BootstrapResult = bootstrapIntervals(competitorIds, prefs, seed, bootstrapSamples);

  // Determine point-estimate ranks (1 = highest score, dense ranking)
  const sortedByScore = [...competitorIds].sort(
    (a, b) => (btResult.scores[b] ?? 0) - (btResult.scores[a] ?? 0),
  );

  const ranks: Record<string, number> = {};
  let currentRank = 1;
  for (let i = 0; i < sortedByScore.length; i++) {
    if (
      i > 0 &&
      Math.abs(
        (btResult.scores[sortedByScore[i]] ?? 0) -
          (btResult.scores[sortedByScore[i - 1]] ?? 0),
      ) > 1e-12
    ) {
      currentRank = i + 1;
    }
    ranks[sortedByScore[i]] = currentRank;
  }

  const result: RankingScore[] = [];

  for (const id of competitorIds) {
    const rawScore = btResult.scores[id] ?? 0;
    const displayScore = 1500 + DISPLAY_SCALE * rawScore;
    const rank = ranks[id];

    const ci = bootstrap.scoreIntervals[id] ?? { lo: rawScore, hi: rawScore };
    const confidenceLower = ci.lo;
    const confidenceUpper = ci.hi;

    // Rank interval from bootstrap rank distribution (2.5/97.5 percentiles).
    // rankLower = best (smallest) rank, rankUpper = worst (largest) rank.
    // Clamp so that the point-estimate rank is always within [rankLower, rankUpper].
    const ri = bootstrap.rankIntervals[id] ?? { lower: rank, upper: rank };
    const rankLower = Math.min(ri.lower, rank);
    const rankUpper = Math.max(ri.upper, rank);

    const jCount = judgmentCounts[id] ?? 0;
    const tieCount = tieCounts[id] ?? 0;
    const unacceptableCount = unacceptableCounts[id] ?? 0;

    result.push({
      competitorVersionId: id,
      rawScore,
      displayScore,
      rank,
      rankLower,
      rankUpper,
      confidenceLower,
      confidenceUpper,
      judgmentCount: jCount,
      caseCount: caseSets[id]?.size ?? 0,
      tieRate: jCount > 0 ? tieCount / jCount : 0,
      unacceptableRate: jCount > 0 ? unacceptableCount / jCount : 0,
    });
  }

  return result;
}
