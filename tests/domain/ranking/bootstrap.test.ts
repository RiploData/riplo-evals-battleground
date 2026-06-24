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
      id => r1[id].lo === r2[id].lo && r1[id].hi === r2[id].hi,
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

    const smallWidth = small['A'].hi - small['A'].lo;
    const largeWidth = large['A'].hi - large['A'].lo;
    expect(largeWidth).toBeLessThan(smallWidth);
  });

  it('returns lo <= hi for all competitors', () => {
    const result = bootstrapIntervals(['A', 'B'], twoCompetitorPrefs, 7, 100);
    for (const [, interval] of Object.entries(result)) {
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
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    for (const [, interval] of Object.entries(result)) {
      expect(interval.lo).toBeLessThanOrEqual(interval.hi);
    }
  });
});
