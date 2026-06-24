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

/**
 * Compute bootstrap confidence intervals for BT scores.
 *
 * @param competitorIds - All competitors
 * @param prefs - Pairwise preference records
 * @param seed - Seed for the mulberry32 PRNG (same seed → identical output)
 * @param samples - Number of bootstrap samples (default 200)
 * @returns Per-competitor { lo, hi } at 2.5/97.5 percentiles
 */
export function bootstrapIntervals(
  competitorIds: string[],
  prefs: PrefRecord[],
  seed: number,
  samples = 200,
): Record<string, { lo: number; hi: number }> {
  const rng = mulberry32(seed);

  // Collect per-competitor score distributions
  const distributions: Record<string, number[]> = {};
  for (const id of competitorIds) {
    distributions[id] = [];
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

    for (const id of competitorIds) {
      // Use 0 as fallback for competitors that may have 0 wins in this resample
      distributions[id].push(result.scores[id] ?? 0);
    }
  }

  // Compute 2.5 and 97.5 percentiles
  const intervals: Record<string, { lo: number; hi: number }> = {};
  for (const id of competitorIds) {
    const sorted = distributions[id].slice().sort((a, b) => a - b);
    const loIdx = Math.floor(0.025 * samples);
    const hiIdx = Math.min(Math.ceil(0.975 * samples) - 1, samples - 1);
    intervals[id] = {
      lo: sorted[loIdx] ?? sorted[0],
      hi: sorted[hiIdx] ?? sorted[sorted.length - 1],
    };
  }

  return intervals;
}
