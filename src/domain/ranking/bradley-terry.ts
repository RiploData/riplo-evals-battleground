/**
 * Bradley–Terry model: iterative MM (minorization-maximization) algorithm.
 *
 * Given a set of pairwise preference records, estimates log-strengths for each
 * competitor. Strengths are mean-centered in log space so the result is identifiable.
 *
 * Reference: Hunter (2004) "MM algorithms for generalized Bradley-Terry models"
 */

export interface PrefRecord {
  winner: string;
  loser: string;
  weight: number; // 1 for decisive wins, 0.5 for ties (creates two symmetric records)
}

export interface BTResult {
  /** Log-strengths, mean-centered (sum of values ≈ 0). Higher = stronger. */
  scores: Record<string, number>;
}

/**
 * Fit a Bradley–Terry model using iterative MM updates in natural parameter space.
 *
 * Includes a small prior regularization (alpha = 0.3): every competitor is given
 * `alpha` virtual wins and `alpha` virtual losses against a phantom opponent of
 * average strength (geometric mean of all strengths). This prevents 0-win
 * competitors from being pinned at 1.0 (the initial value) and prevents
 * astronomically large strengths in near-separable data, while having negligible
 * effect on well-determined fits.
 *
 * @param competitorIds - All competitor IDs (even those with no prefs)
 * @param prefs - Pairwise preference records (ties pre-split into two 0.5-weight records)
 * @param opts.iters - Max iterations (default 1000)
 * @param opts.tol - Convergence tolerance on max |Δ log-strength| (default 1e-9)
 * @param opts.alpha - Prior weight for regularization (default 0.3)
 */
export function fitBradleyTerry(
  competitorIds: string[],
  prefs: PrefRecord[],
  opts?: { iters?: number; tol?: number; alpha?: number },
): BTResult {
  const iters = opts?.iters ?? 1000;
  const tol = opts?.tol ?? 1e-9;
  const alpha = opts?.alpha ?? 0.3;

  if (competitorIds.length === 0) {
    return { scores: {} };
  }

  if (competitorIds.length === 1) {
    return { scores: { [competitorIds[0]]: 0 } };
  }

  // Initialize strengths (positive, in strength space — not log)
  const strength: Record<string, number> = {};
  for (const id of competitorIds) {
    strength[id] = 1.0;
  }

  // Pre-compute wins per competitor (weighted)
  const wins: Record<string, number> = {};
  for (const id of competitorIds) {
    wins[id] = 0;
  }
  for (const pref of prefs) {
    wins[pref.winner] = (wins[pref.winner] ?? 0) + pref.weight;
  }

  // MM update: for each competitor i,
  //   strength[i] = W_i / sum_{j != i} (n_{ij} / (strength[i] + strength[j]))
  // where W_i = total wins for i, n_{ij} = total comparisons between i and j
  // We need to compute n_{ij} (comparisons count) for each pair
  const comparisons: Map<string, Map<string, number>> = new Map();
  const pairKey = (a: string, b: string): [string, string] =>
    a < b ? [a, b] : [b, a];

  for (const pref of prefs) {
    const [a, b] = pairKey(pref.winner, pref.loser);
    if (!comparisons.has(a)) comparisons.set(a, new Map());
    if (!comparisons.has(b)) comparisons.set(b, new Map());
    comparisons.get(a)!.set(b, (comparisons.get(a)!.get(b) ?? 0) + pref.weight);
    comparisons.get(b)!.set(a, (comparisons.get(b)!.get(a) ?? 0) + pref.weight);
  }

  const n = competitorIds.length;

  for (let iter = 0; iter < iters; iter++) {
    // Compute geometric-mean strength (phantom opponent strength for the prior)
    let logSum = 0;
    for (const id of competitorIds) {
      logSum += Math.log(strength[id]);
    }
    const phantomStrength = Math.exp(logSum / n);

    let maxDelta = 0;

    for (const id of competitorIds) {
      const wi = wins[id] ?? 0;

      // Regularized wins and denominator: add alpha virtual wins + alpha virtual losses
      // against the phantom average opponent.
      const regWins = wi + alpha;

      let denom = 0;
      const rivals = comparisons.get(id);
      if (rivals) {
        for (const [rival, n_ij] of rivals.entries()) {
          denom += n_ij / (strength[id] + strength[rival]);
        }
      }
      // Prior contribution: 2*alpha comparisons against the phantom (alpha wins + alpha losses)
      denom += (2 * alpha) / (strength[id] + phantomStrength);

      if (denom === 0) continue;

      const newStrength = regWins / denom;
      maxDelta = Math.max(maxDelta, Math.abs(Math.log(newStrength) - Math.log(strength[id])));
      strength[id] = newStrength;
    }

    if (maxDelta < tol) break;
  }

  // Convert to log-space and mean-center
  const logStrengths: Record<string, number> = {};
  for (const id of competitorIds) {
    logStrengths[id] = Math.log(strength[id]);
  }

  const vals = Object.values(logStrengths);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;

  const scores: Record<string, number> = {};
  for (const id of competitorIds) {
    scores[id] = logStrengths[id] - mean;
  }

  return { scores };
}
