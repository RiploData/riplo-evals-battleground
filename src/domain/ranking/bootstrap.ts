/**
 * Bootstrap confidence intervals for Bradley–Terry scores.
 *
 * Uses a seeded PRNG (mulberry32) for deterministic resampling.
 * Samples `prefs` with replacement `samples` times, refits BT each time,
 * then derives per-competitor 2.5/97.5 percentile intervals.
 */

import { fitBradleyTerry, PrefRecord } from './bradley-terry';

/**
 * mulberry32: a fast, high-quality 32-bit PRNG seeded with a 32-bit integer.
 * Returns a function that yields uniformly distributed floats in [0, 1).
 *
 * Source: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0; // ensure unsigned 32-bit
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapResult {
  /** 2.5/97.5 percentile score intervals per competitor */
  scoreIntervals: Record<string, { lo: number; hi: number }>;
  /** 2.5/97.5 percentile rank intervals per competitor (1 = best) */
  rankIntervals: Record<string, { lower: number; upper: number }>;
}

/**
 * Compute bootstrap confidence intervals for BT scores and ranks.
 *
 * For each bootstrap resample the BT model is refit, each competitor's rank
 * within that resample is computed (dense ranking, 1 = highest score), and
 * the per-competitor rank distribution is collected. Score and rank intervals
 * are the 2.5/97.5 percentiles across all samples.
 *
 * @param competitorIds - All competitors
 * @param prefs - Pairwise preference records
 * @param seed - Seed for the mulberry32 PRNG (same seed → identical output)
 * @param samples - Number of bootstrap samples (default 200)
 * @returns Per-competitor score and rank intervals at 2.5/97.5 percentiles
 */
export function bootstrapIntervals(
  competitorIds: string[],
  prefs: PrefRecord[],
  seed: number,
  samples = 200,
): BootstrapResult {
  const rng = mulberry32(seed);

  // Collect per-competitor score and rank distributions
  const scoreDistributions: Record<string, number[]> = {};
  const rankDistributions: Record<string, number[]> = {};
  for (const id of competitorIds) {
    scoreDistributions[id] = [];
    rankDistributions[id] = [];
  }

  const n = prefs.length;

  for (let s = 0; s < samples; s++) {
    // Resample with replacement
    const resample: PrefRecord[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      resample.push(prefs[idx]);
    }

    const result = fitBradleyTerry(competitorIds, resample);

    // Compute ranks within this resample (dense ranking, 1 = highest)
    const sorted = [...competitorIds].sort(
      (a, b) => (result.scores[b] ?? 0) - (result.scores[a] ?? 0),
    );
    const sampleRanks: Record<string, number> = {};
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (
        i > 0 &&
        Math.abs(
          (result.scores[sorted[i]] ?? 0) - (result.scores[sorted[i - 1]] ?? 0),
        ) > 1e-12
      ) {
        currentRank = i + 1;
      }
      sampleRanks[sorted[i]] = currentRank;
    }

    for (const id of competitorIds) {
      scoreDistributions[id].push(result.scores[id] ?? 0);
      rankDistributions[id].push(sampleRanks[id] ?? competitorIds.length);
    }
  }

  // Compute 2.5 and 97.5 percentiles
  const loIdx = Math.floor(0.025 * samples);
  const hiIdx = Math.min(Math.ceil(0.975 * samples) - 1, samples - 1);

  const scoreIntervals: Record<string, { lo: number; hi: number }> = {};
  const rankIntervals: Record<string, { lower: number; upper: number }> = {};

  for (const id of competitorIds) {
    const sortedScores = scoreDistributions[id].slice().sort((a, b) => a - b);
    scoreIntervals[id] = {
      lo: sortedScores[loIdx] ?? sortedScores[0],
      hi: sortedScores[hiIdx] ?? sortedScores[sortedScores.length - 1],
    };

    // Ranks: lower percentile means better (smaller rank number = better)
    const sortedRanks = rankDistributions[id].slice().sort((a, b) => a - b);
    rankIntervals[id] = {
      lower: sortedRanks[loIdx] ?? sortedRanks[0],
      upper: sortedRanks[hiIdx] ?? sortedRanks[sortedRanks.length - 1],
    };
  }

  return { scoreIntervals, rankIntervals };
}
