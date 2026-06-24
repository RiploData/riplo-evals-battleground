import { describe, it, expect } from 'vitest';
import { bootstrapIntervals } from '@/domain/ranking/bootstrap';
import { PrefRecord } from '@/domain/ranking/bradley-terry';

describe('bootstrapIntervals', () => {
  const twoCompetitorPrefs: PrefRecord[] = [
    { winner: 'A', loser: 'B', weight: 1 },
    { winner: 'A', loser: 'B', weight: 1 },
    { winner: 'A', loser: 'B', weight: 1 },
    { winner: 'B', loser: 'A', weight: 1 },
    { winner: 'B', loser: 'A', weight: 1 },
  ];

  it('same seed produces identical intervals (determinism)', () => {
    const r1 = bootstrapIntervals(['A', 'B'], twoCompetitorPrefs, 42, 100);
    const r2 = bootstrapIntervals(['A', 'B'], twoCompetitorPrefs, 42, 100);
    expect(r1).toEqual(r2);
  });

  it('different seeds produce different intervals (with sufficient data diversity)', () => {
    // Use 3 competitors with varied outcomes so resampling produces meaningfully different distributions
    const variedPrefs: PrefRecord[] = [
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'B', loser: 'A', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'C', loser: 'A', weight: 1 },
      { winner: 'B', loser: 'C', weight: 1 },
      { winner: 'C', loser: 'B', weight: 1 },
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'C', loser: 'A', weight: 1 },
      { winner: 'B', loser: 'C', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'B', loser: 'A', weight: 1 },
    ];
    const r1 = bootstrapIntervals(['A', 'B', 'C'], variedPrefs, 1, 200);
    const r2 = bootstrapIntervals(['A', 'B', 'C'], variedPrefs, 999999, 200);
    // With different seeds and varied data, at least one competitor's interval should differ
    const allSame = ['A', 'B', 'C'].every(
      id =>
        r1.scoreIntervals[id].lo === r2.scoreIntervals[id].lo &&
        r1.scoreIntervals[id].hi === r2.scoreIntervals[id].hi,
    );
    expect(allSame).toBe(false);
  });

  it('more data produces narrower confidence intervals', () => {
    const smallPrefs: PrefRecord[] = [
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'B', loser: 'A', weight: 1 },
    ];
    const largePrefs: PrefRecord[] = Array.from({ length: 40 }, (_, i) => ({
      winner: i % 2 === 0 ? 'A' : 'B',
      loser: i % 2 === 0 ? 'B' : 'A',
      weight: 1 as number,
    }));

    const small = bootstrapIntervals(['A', 'B'], smallPrefs, 42, 200);
    const large = bootstrapIntervals(['A', 'B'], largePrefs, 42, 200);

    const smallWidth = small.scoreIntervals['A'].hi - small.scoreIntervals['A'].lo;
    const largeWidth = large.scoreIntervals['A'].hi - large.scoreIntervals['A'].lo;
    expect(largeWidth).toBeLessThan(smallWidth);
  });

  it('returns lo <= hi for all competitors', () => {
    const result = bootstrapIntervals(['A', 'B'], twoCompetitorPrefs, 7, 100);
    for (const [, interval] of Object.entries(result.scoreIntervals)) {
      expect(interval.lo).toBeLessThanOrEqual(interval.hi);
    }
  });

  it('handles three competitors', () => {
    const prefs: PrefRecord[] = [
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'B', loser: 'C', weight: 1 },
    ];
    const result = bootstrapIntervals(['A', 'B', 'C'], prefs, 42, 100);
    expect(Object.keys(result.scoreIntervals)).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    for (const [, interval] of Object.entries(result.scoreIntervals)) {
      expect(interval.lo).toBeLessThanOrEqual(interval.hi);
    }
  });

  it('rank intervals: dominant competitor has narrow rank interval at 1', () => {
    // A beats B and C consistently across many prefs — dominant; should almost always rank 1
    const prefs: PrefRecord[] = [
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'B', loser: 'C', weight: 1 },
    ];
    const result = bootstrapIntervals(['A', 'B', 'C'], prefs, 42, 200);
    const aRank = result.rankIntervals['A'];
    // A is so dominant it should rank 1 in essentially every resample
    expect(aRank.lower).toBe(1);
    expect(aRank.upper).toBe(1);
  });

  it('rank intervals: uncertain pair has wider rank interval', () => {
    // Near-tie between A and B, clear loser C — A/B rank interval should be wide (1 or 2)
    const prefs: PrefRecord[] = [
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'B', loser: 'A', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'B', loser: 'C', weight: 1 },
    ];
    const result = bootstrapIntervals(['A', 'B', 'C'], prefs, 42, 200);
    const aRank = result.rankIntervals['A'];
    // A and B are interchangeable; A's rank interval should span both 1 and 2
    expect(aRank.lower).toBe(1);
    expect(aRank.upper).toBeGreaterThanOrEqual(2);
  });

  it('rank intervals: lower <= upper for all competitors', () => {
    const result = bootstrapIntervals(['A', 'B'], twoCompetitorPrefs, 7, 100);
    for (const [, ri] of Object.entries(result.rankIntervals)) {
      expect(ri.lower).toBeLessThanOrEqual(ri.upper);
    }
  });
});
