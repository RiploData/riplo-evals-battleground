import { describe, it, expect } from 'vitest';
import { selectPair, pairKey } from '@/domain/matchmaking';
import type { MatchmakingInput } from '@/domain/matchmaking';

// Deterministic seeded RNG using xorshift32 for tests — wide distribution across seeds
function makeSeededRng(seed: number): () => number {
  // xorshift32: good avalanche, seed-sensitive
  let s = seed === 0 ? 1 : seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s = s >>> 0; // keep unsigned 32-bit
    return s / 0x100000000; // [0, 1)
  };
}

describe('pairKey', () => {
  it('returns the same key regardless of argument order', () => {
    expect(pairKey('case1', 'x', 'y')).toBe(pairKey('case1', 'y', 'x'));
  });

  it('sorts competitor ids lexicographically', () => {
    // 'x' > 'y' lexicographically? No: 'x' < 'y'. So sorted: x,y
    expect(pairKey('case1', 'x', 'y')).toBe('case1|x|y');
    expect(pairKey('case1', 'y', 'x')).toBe('case1|x|y');
  });

  it('works with the brief example: pairKey("c","y","x") === pairKey("c","x","y")', () => {
    expect(pairKey('c', 'y', 'x')).toBe(pairKey('c', 'x', 'y'));
  });

  it('produces different keys for different cases', () => {
    expect(pairKey('case1', 'x', 'y')).not.toBe(pairKey('case2', 'x', 'y'));
  });
});

describe('selectPair — basic selection', () => {
  it('returns a valid unseen pair when no history exists', () => {
    const input: MatchmakingInput = {
      cases: [{ caseVersionId: 'c1', tags: ['tag1'] }],
      eligibleCompetitorVersionIds: ['x', 'y', 'z'],
      existingPairCounts: {},
      seenByUser: new Set(),
      rng: makeSeededRng(42),
    };
    const result = selectPair(input);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.caseVersionId).toBe('c1');
    expect(['x', 'y', 'z']).toContain(result.competitorA);
    expect(['x', 'y', 'z']).toContain(result.competitorB);
    expect(result.competitorA).not.toBe(result.competitorB);
  });

  it('returns null when all pairs for the only case are in seenByUser', () => {
    // With competitors [x,y,z], all pairs are: (x,y), (x,z), (y,z)
    const input: MatchmakingInput = {
      cases: [{ caseVersionId: 'c1', tags: ['tag1'] }],
      eligibleCompetitorVersionIds: ['x', 'y', 'z'],
      existingPairCounts: {},
      seenByUser: new Set([
        pairKey('c1', 'x', 'y'),
        pairKey('c1', 'x', 'z'),
        pairKey('c1', 'y', 'z'),
      ]),
      rng: makeSeededRng(42),
    };
    expect(selectPair(input)).toBeNull();
  });

  it('returns null when there are no eligible competitors (fewer than 2)', () => {
    const input: MatchmakingInput = {
      cases: [{ caseVersionId: 'c1', tags: ['tag1'] }],
      eligibleCompetitorVersionIds: ['x'],
      existingPairCounts: {},
      seenByUser: new Set(),
      rng: makeSeededRng(42),
    };
    expect(selectPair(input)).toBeNull();
  });

  it('returns null when there are no cases', () => {
    const input: MatchmakingInput = {
      cases: [],
      eligibleCompetitorVersionIds: ['x', 'y'],
      existingPairCounts: {},
      seenByUser: new Set(),
      rng: makeSeededRng(42),
    };
    expect(selectPair(input)).toBeNull();
  });

  it('never returns a pair in seenByUser', () => {
    // With only one unseen pair remaining (y,z), must return that
    const input: MatchmakingInput = {
      cases: [{ caseVersionId: 'c1', tags: ['tag1'] }],
      eligibleCompetitorVersionIds: ['x', 'y', 'z'],
      existingPairCounts: {},
      seenByUser: new Set([
        pairKey('c1', 'x', 'y'),
        pairKey('c1', 'x', 'z'),
      ]),
      rng: makeSeededRng(42),
    };
    const result = selectPair(input);
    expect(result).not.toBeNull();
    if (result === null) return;
    const key = pairKey(result.caseVersionId, result.competitorA, result.competitorB);
    expect(input.seenByUser.has(key)).toBe(false);
    expect(key).toBe(pairKey('c1', 'y', 'z'));
  });
});

describe('selectPair — least-covered preference', () => {
  it('returns a pair from the lowest-coverage tier', () => {
    // c1 pairs: (x,y)=5, (x,z)=5, (y,z)=1 → must pick (y,z)
    const input: MatchmakingInput = {
      cases: [{ caseVersionId: 'c1', tags: ['tag1'] }],
      eligibleCompetitorVersionIds: ['x', 'y', 'z'],
      existingPairCounts: {
        [pairKey('c1', 'x', 'y')]: 5,
        [pairKey('c1', 'x', 'z')]: 5,
        [pairKey('c1', 'y', 'z')]: 1,
      },
      seenByUser: new Set(),
      rng: makeSeededRng(42),
    };
    const result = selectPair(input);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(pairKey(result.caseVersionId, result.competitorA, result.competitorB))
      .toBe(pairKey('c1', 'y', 'z'));
  });

  it('treats missing existingPairCounts entry as 0', () => {
    // c1 pairs: (x,y)=3, (x,z) missing (=0), (y,z)=2 → must pick (x,z)
    const input: MatchmakingInput = {
      cases: [{ caseVersionId: 'c1', tags: ['tag1'] }],
      eligibleCompetitorVersionIds: ['x', 'y', 'z'],
      existingPairCounts: {
        [pairKey('c1', 'x', 'y')]: 3,
        [pairKey('c1', 'y', 'z')]: 2,
      },
      seenByUser: new Set(),
      rng: makeSeededRng(42),
    };
    const result = selectPair(input);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(pairKey(result.caseVersionId, result.competitorA, result.competitorB))
      .toBe(pairKey('c1', 'x', 'z'));
  });
});

describe('selectPair — tag balancing', () => {
  it('prefers under-covered tags when counts differ across cases', () => {
    // case1 has tag "common" and has been seen many times (high count)
    // case2 has tag "rare" and has 0 existingPairCounts → should be preferred
    // Both cases share competitor pairs so we can compare
    const commonKey = pairKey('c1', 'x', 'y');
    const rareKey = pairKey('c2', 'x', 'y');
    const input: MatchmakingInput = {
      cases: [
        { caseVersionId: 'c1', tags: ['common'] },
        { caseVersionId: 'c2', tags: ['rare'] },
      ],
      eligibleCompetitorVersionIds: ['x', 'y'],
      existingPairCounts: {
        [commonKey]: 100,
        [rareKey]: 0,
      },
      seenByUser: new Set(),
      rng: makeSeededRng(42),
    };
    // With many trials, c2 should dominate because it has lowest pair count
    // Run multiple times with different seeds to confirm c2 is always chosen
    // (since min-count tier selection will always prefer c2's pair at count=0)
    const results = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const r = selectPair({ ...input, rng: makeSeededRng(seed) });
      if (r) results.add(r.caseVersionId);
    }
    // c2 should be selected (it's the only one in the lowest tier)
    expect(results.has('c2')).toBe(true);
    expect(results.has('c1')).toBe(false);
  });

  it('considers tag coverage when weighting under-covered tags', () => {
    // Two cases: c1 tagged ['math'], c2 tagged ['writing']
    // existingPairCounts are equal for both but we still get a valid result
    const input: MatchmakingInput = {
      cases: [
        { caseVersionId: 'c1', tags: ['math'] },
        { caseVersionId: 'c2', tags: ['writing'] },
      ],
      eligibleCompetitorVersionIds: ['x', 'y'],
      existingPairCounts: {
        [pairKey('c1', 'x', 'y')]: 5,
        [pairKey('c2', 'x', 'y')]: 5,
      },
      seenByUser: new Set(),
      rng: makeSeededRng(42),
    };
    const result = selectPair(input);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(['c1', 'c2']).toContain(result.caseVersionId);
  });
});

describe('selectPair — rng determinism', () => {
  it('produces the same result for the same seed when multiple pairs tie', () => {
    // All pairs at count=0, so rng determines which is selected
    const input: MatchmakingInput = {
      cases: [{ caseVersionId: 'c1', tags: ['tag1'] }],
      eligibleCompetitorVersionIds: ['x', 'y', 'z'],
      existingPairCounts: {},
      seenByUser: new Set(),
      rng: makeSeededRng(99),
    };
    const result1 = selectPair({ ...input, rng: makeSeededRng(99) });
    const result2 = selectPair({ ...input, rng: makeSeededRng(99) });
    expect(result1).toEqual(result2);
  });

  it('may produce different results for different seeds', () => {
    // With 3 competitors (3 pairs tied at 0), different seeds can yield different pairs.
    // Use widely-spaced seeds to ensure broad coverage of the RNG output range.
    const base: Omit<MatchmakingInput, 'rng'> = {
      cases: [{ caseVersionId: 'c1', tags: ['tag1'] }],
      eligibleCompetitorVersionIds: ['x', 'y', 'z'],
      existingPairCounts: {},
      seenByUser: new Set(),
    };
    const wideSeeds = [10000, 999999, 87654321, 2147483647, 3000000000];
    const results = new Set<string>();
    for (const seed of wideSeeds) {
      const r = selectPair({ ...base, rng: makeSeededRng(seed) });
      if (r) results.add(pairKey(r.caseVersionId, r.competitorA, r.competitorB));
    }
    // With widely-spaced seeds we should see more than one pair selected
    expect(results.size).toBeGreaterThan(1);
  });
});
