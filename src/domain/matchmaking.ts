export interface Cell {
  caseVersionId: string;
  competitorVersionId: string;
}

export interface PairCandidate {
  caseVersionId: string;
  competitorA: string;
  competitorB: string;
}

export interface MatchmakingInput {
  cases: { caseVersionId: string; tags: string[] }[];
  eligibleCompetitorVersionIds: string[];
  existingPairCounts: Record<string, number>; // key `${caseVersionId}|${a}|${b}` (a<b sorted)
  seenByUser: Set<string>;                     // keys already shown to this user
  /**
   * Cells (caseVersionId × competitorVersionId) that have a precomputed response,
   * keyed via cellKey(). When provided, only pairs where BOTH cells are present are
   * eligible — the battleground never generates responses at view time. When omitted,
   * no precomputed filtering is applied (back-compat for callers/tests that don't gate).
   */
  precomputedCells?: Set<string>;
  rng: () => number;                           // injectable for determinism
}

/**
 * Returns a canonical pair key with competitor ids sorted lexicographically.
 * This ensures the key is order-independent.
 */
export function pairKey(caseVersionId: string, a: string, b: string): string {
  const [first, second] = a <= b ? [a, b] : [b, a];
  return `${caseVersionId}|${first}|${second}`;
}

/**
 * Returns a stable key for a single (case × competitor) cell. Used to test whether
 * a cell has a precomputed response.
 */
export function cellKey(caseVersionId: string, competitorVersionId: string): string {
  return `${caseVersionId}|${competitorVersionId}`;
}

/**
 * Enumerate all unique competitor pairs from a list of eligible competitor ids.
 */
function allPairs(competitorIds: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < competitorIds.length; i++) {
    for (let j = i + 1; j < competitorIds.length; j++) {
      pairs.push([competitorIds[i], competitorIds[j]]);
    }
  }
  return pairs;
}

/**
 * Compute total existingPairCounts coverage for a given tag across all cases.
 */
function tagCoverage(
  tag: string,
  cases: { caseVersionId: string; tags: string[] }[],
  existingPairCounts: Record<string, number>,
  pairs: [string, string][]
): number {
  let total = 0;
  for (const c of cases) {
    if (!c.tags.includes(tag)) continue;
    for (const [a, b] of pairs) {
      const key = pairKey(c.caseVersionId, a, b);
      total += existingPairCounts[key] ?? 0;
    }
  }
  return total;
}

/**
 * Select a pair for the user to evaluate, using a coverage-based strategy:
 * - Prefer (case, pair) combinations with the lowest existingPairCounts
 * - Never return a pair already in seenByUser
 * - Balance across case tags by weighting under-covered tags more
 * - Pick randomly (via injected rng) within the lowest-evidence tier
 * - Return null when every eligible pair has been seen by this user
 */
export function selectPair(input: MatchmakingInput): PairCandidate | null {
  const { cases, eligibleCompetitorVersionIds, existingPairCounts, seenByUser, precomputedCells, rng } = input;

  if (cases.length === 0 || eligibleCompetitorVersionIds.length < 2) {
    return null;
  }

  const pairs = allPairs(eligibleCompetitorVersionIds);

  // Build the full candidate list: (case, pairA, pairB) x all pairs
  // Filter out seenByUser entries
  interface ScoredCandidate {
    caseVersionId: string;
    a: string;
    b: string;
    count: number;
    tagWeight: number;
  }

  // Collect all unique tags from cases
  const allTags = Array.from(new Set(cases.flatMap(c => c.tags)));

  // Compute coverage per tag (total counts across all pairs in that tag's cases)
  const tagCoverageMap: Record<string, number> = {};
  for (const tag of allTags) {
    tagCoverageMap[tag] = tagCoverage(tag, cases, existingPairCounts, pairs);
  }

  // Maximum tag coverage for computing inverse weights
  const maxTagCoverage = Math.max(0, ...Object.values(tagCoverageMap));

  // Weight for a case = sum of inverse-coverage weights for its tags
  // Under-covered tags get higher weight
  function caseTagWeight(tags: string[]): number {
    if (allTags.length === 0) return 1;
    let weight = 0;
    for (const tag of tags) {
      // inverse coverage: maxCov - thisCov gives higher weight to under-covered
      weight += maxTagCoverage - (tagCoverageMap[tag] ?? 0);
    }
    // Ensure at least weight 1 so all cases remain eligible
    return Math.max(1, weight);
  }

  // Build unseen candidates with their scores
  const candidates: ScoredCandidate[] = [];

  for (const c of cases) {
    const tagWeight = caseTagWeight(c.tags);
    for (const [a, b] of pairs) {
      const key = pairKey(c.caseVersionId, a, b);
      if (seenByUser.has(key)) continue;
      // Read-only battleground: never offer a pair whose cells aren't already
      // generated. Both cells must have a precomputed response.
      if (
        precomputedCells &&
        (!precomputedCells.has(cellKey(c.caseVersionId, a)) ||
          !precomputedCells.has(cellKey(c.caseVersionId, b)))
      ) {
        continue;
      }
      const count = existingPairCounts[key] ?? 0;
      candidates.push({ caseVersionId: c.caseVersionId, a, b, count, tagWeight });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Find minimum existingPairCount across all unseen candidates
  const minCount = Math.min(...candidates.map(c => c.count));

  // Keep only candidates in the lowest-evidence tier
  const lowestTier = candidates.filter(c => c.count === minCount);

  // Within the lowest tier, weight by tag under-coverage
  // Build a weighted selection array
  const totalWeight = lowestTier.reduce((sum, c) => sum + c.tagWeight, 0);
  let pick = rng() * totalWeight;

  for (const candidate of lowestTier) {
    pick -= candidate.tagWeight;
    if (pick <= 0) {
      // Sort a,b for consistency with pairKey
      const [competitorA, competitorB] =
        candidate.a <= candidate.b
          ? [candidate.a, candidate.b]
          : [candidate.b, candidate.a];
      return {
        caseVersionId: candidate.caseVersionId,
        competitorA,
        competitorB,
      };
    }
  }

  // Fallback: return last candidate (handles floating-point edge cases)
  const last = lowestTier[lowestTier.length - 1];
  const [competitorA, competitorB] =
    last.a <= last.b ? [last.a, last.b] : [last.b, last.a];
  return {
    caseVersionId: last.caseVersionId,
    competitorA,
    competitorB,
  };
}
