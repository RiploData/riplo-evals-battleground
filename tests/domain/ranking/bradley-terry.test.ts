import { describe, it, expect } from 'vitest';
import { fitBradleyTerry, PrefRecord } from '@/domain/ranking/bradley-terry';

describe('fitBradleyTerry', () => {
  it('dominant competitor (beats all others) gets the highest score', () => {
    // A beats B, A beats C, B beats C
    const prefs: PrefRecord[] = [
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'B', loser: 'C', weight: 1 },
    ];
    const result = fitBradleyTerry(['A', 'B', 'C'], prefs);
    expect(result.scores['A']).toBeGreaterThan(result.scores['B']);
    expect(result.scores['A']).toBeGreaterThan(result.scores['C']);
    expect(result.scores['B']).toBeGreaterThan(result.scores['C']);
  });

  it('symmetric 1-1 between two competitors yields approximately equal scores', () => {
    const prefs: PrefRecord[] = [
      { winner: 'X', loser: 'Y', weight: 1 },
      { winner: 'Y', loser: 'X', weight: 1 },
    ];
    const result = fitBradleyTerry(['X', 'Y'], prefs);
    expect(Math.abs(result.scores['X'] - result.scores['Y'])).toBeLessThan(1e-6);
  });

  it('log-strengths are mean-centered (sum ≈ 0)', () => {
    const prefs: PrefRecord[] = [
      { winner: 'A', loser: 'B', weight: 1 },
      { winner: 'A', loser: 'C', weight: 1 },
      { winner: 'B', loser: 'C', weight: 1 },
    ];
    const result = fitBradleyTerry(['A', 'B', 'C'], prefs);
    const vals = Object.values(result.scores);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    expect(Math.abs(mean)).toBeLessThan(1e-9);
  });

  it('converges within default iters and returns finite values', () => {
    const prefs: PrefRecord[] = [
      { winner: 'A', loser: 'B', weight: 2 },
      { winner: 'B', loser: 'C', weight: 3 },
    ];
    const result = fitBradleyTerry(['A', 'B', 'C'], prefs);
    for (const val of Object.values(result.scores)) {
      expect(isFinite(val)).toBe(true);
    }
  });

  it('handles weighted (tie) prefs (weight 0.5)', () => {
    // Ties: A vs B → 0.5 weight each direction
    const prefs: PrefRecord[] = [
      { winner: 'A', loser: 'B', weight: 0.5 },
      { winner: 'B', loser: 'A', weight: 0.5 },
    ];
    const result = fitBradleyTerry(['A', 'B'], prefs);
    expect(Math.abs(result.scores['A'] - result.scores['B'])).toBeLessThan(1e-6);
  });

  it('handles single competitor (no prefs) with zero score', () => {
    const result = fitBradleyTerry(['Solo'], []);
    expect(result.scores['Solo']).toBeCloseTo(0, 10);
  });
});
