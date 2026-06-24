import { describe, it, expect } from 'vitest';
import { computeRanking, JudgmentForFit } from '@/domain/ranking/run';

const makeJ = (
  a: string,
  b: string,
  outcome: JudgmentForFit['outcome'],
  preferred: string | null,
  caseId = 'case1',
): JudgmentForFit => ({
  competitorVersionIdA: a,
  competitorVersionIdB: b,
  caseVersionId: caseId,
  outcome,
  preferredCompetitorVersionId: preferred,
});

describe('computeRanking', () => {
  it('dominant competitor ranks 1', () => {
    const judgments: JudgmentForFit[] = [
      makeJ('A', 'B', 'left', 'A', 'c1'),
      makeJ('A', 'B', 'left', 'A', 'c2'),
      makeJ('A', 'B', 'left', 'A', 'c3'),
      makeJ('A', 'C', 'left', 'A', 'c4'),
      makeJ('A', 'C', 'left', 'A', 'c5'),
      makeJ('B', 'C', 'left', 'B', 'c6'),
    ];
    const ranking = computeRanking(judgments, 42);
    const a = ranking.find(r => r.competitorVersionId === 'A')!;
    const b = ranking.find(r => r.competitorVersionId === 'B')!;
    const c = ranking.find(r => r.competitorVersionId === 'C')!;
    expect(a.rank).toBe(1);
    expect(b.rank).toBeLessThan(c.rank);
  });

  it('ties contribute half-wins (competitors with only ties get equal scores)', () => {
    const judgments: JudgmentForFit[] = [
      makeJ('A', 'B', 'tie', null, 'c1'),
      makeJ('A', 'B', 'tie', null, 'c2'),
      makeJ('A', 'B', 'tie', null, 'c3'),
    ];
    const ranking = computeRanking(judgments, 42);
    const a = ranking.find(r => r.competitorVersionId === 'A')!;
    const b = ranking.find(r => r.competitorVersionId === 'B')!;
    expect(Math.abs(a.rawScore - b.rawScore)).toBeLessThan(1e-6);
  });

  it('both_unacceptable raises unacceptableRate but does not affect head-to-head', () => {
    // 3 normal wins for A, 1 both_unacceptable
    const judgmentsWithout: JudgmentForFit[] = [
      makeJ('A', 'B', 'left', 'A', 'c1'),
      makeJ('A', 'B', 'left', 'A', 'c2'),
      makeJ('A', 'B', 'left', 'A', 'c3'),
    ];
    const judgmentsWith: JudgmentForFit[] = [
      ...judgmentsWithout,
      makeJ('A', 'B', 'both_unacceptable', null, 'c4'),
    ];

    const r1 = computeRanking(judgmentsWithout, 42);
    const r2 = computeRanking(judgmentsWith, 42);

    const aWithout = r1.find(r => r.competitorVersionId === 'A')!;
    const aWith = r2.find(r => r.competitorVersionId === 'A')!;

    // unacceptableRate should be higher with the both_unacceptable judgment
    expect(aWith.unacceptableRate).toBeGreaterThan(aWithout.unacceptableRate);

    // Rank should stay the same (A still wins head-to-head)
    expect(aWith.rank).toBe(aWithout.rank);
  });

  it('cannot_assess judgments are ignored entirely', () => {
    const judgmentsClean: JudgmentForFit[] = [
      makeJ('A', 'B', 'left', 'A', 'c1'),
      makeJ('A', 'B', 'left', 'A', 'c2'),
    ];
    const judgmentsWithCA: JudgmentForFit[] = [
      ...judgmentsClean,
      makeJ('A', 'B', 'cannot_assess', null, 'c3'),
      makeJ('A', 'B', 'cannot_assess', null, 'c4'),
    ];

    const r1 = computeRanking(judgmentsClean, 42);
    const r2 = computeRanking(judgmentsWithCA, 42);

    const a1 = r1.find(r => r.competitorVersionId === 'A')!;
    const a2 = r2.find(r => r.competitorVersionId === 'A')!;

    // Scores should be identical since cannot_assess is excluded
    expect(a1.rawScore).toBeCloseTo(a2.rawScore, 10);
  });

  it('tieRate reflects ties in competitor judgments', () => {
    const judgments: JudgmentForFit[] = [
      makeJ('A', 'B', 'left', 'A', 'c1'),  // A wins
      makeJ('A', 'B', 'tie', null, 'c2'),   // tie
      makeJ('A', 'B', 'tie', null, 'c3'),   // tie
    ];
    const ranking = computeRanking(judgments, 42);
    const a = ranking.find(r => r.competitorVersionId === 'A')!;
    // 2 ties out of 3 judgments
    expect(a.tieRate).toBeCloseTo(2 / 3, 5);
  });

  it('judgmentCount reflects non-cannot_assess judgments', () => {
    const judgments: JudgmentForFit[] = [
      makeJ('A', 'B', 'left', 'A', 'c1'),
      makeJ('A', 'B', 'left', 'A', 'c2'),
      makeJ('A', 'B', 'cannot_assess', null, 'c3'),
    ];
    const ranking = computeRanking(judgments, 42);
    const a = ranking.find(r => r.competitorVersionId === 'A')!;
    // Only 2 judgments counted (cannot_assess excluded)
    expect(a.judgmentCount).toBe(2);
  });

  it('reproducible across two calls with same seed', () => {
    const judgments: JudgmentForFit[] = [
      makeJ('A', 'B', 'left', 'A', 'c1'),
      makeJ('B', 'C', 'left', 'B', 'c2'),
      makeJ('A', 'C', 'tie', null, 'c3'),
    ];
    const r1 = computeRanking(judgments, 123);
    const r2 = computeRanking(judgments, 123);
    expect(r1).toEqual(r2);
  });

  it('displayScore is Elo-like (around 1500 for equal competitors)', () => {
    const judgments: JudgmentForFit[] = [
      makeJ('A', 'B', 'left', 'A', 'c1'),
      makeJ('B', 'A', 'left', 'B', 'c2'),
    ];
    const ranking = computeRanking(judgments, 42);
    const a = ranking.find(r => r.competitorVersionId === 'A')!;
    const b = ranking.find(r => r.competitorVersionId === 'B')!;
    // Both near 1500 when symmetric
    expect(Math.abs(a.displayScore - 1500)).toBeLessThan(50);
    expect(Math.abs(b.displayScore - 1500)).toBeLessThan(50);
  });

  it('caseCount counts unique case versions for a competitor', () => {
    const judgments: JudgmentForFit[] = [
      makeJ('A', 'B', 'left', 'A', 'c1'),
      makeJ('A', 'B', 'left', 'A', 'c1'), // same case
      makeJ('A', 'B', 'left', 'A', 'c2'), // different case
    ];
    const ranking = computeRanking(judgments, 42);
    const a = ranking.find(r => r.competitorVersionId === 'A')!;
    expect(a.caseCount).toBe(2);
  });

  it('rankLower <= rank <= rankUpper', () => {
    const judgments: JudgmentForFit[] = [
      makeJ('A', 'B', 'left', 'A', 'c1'),
      makeJ('A', 'B', 'left', 'A', 'c2'),
      makeJ('B', 'C', 'left', 'B', 'c3'),
      makeJ('A', 'C', 'left', 'A', 'c4'),
    ];
    const ranking = computeRanking(judgments, 42);
    for (const r of ranking) {
      expect(r.rankLower).toBeLessThanOrEqual(r.rank);
      expect(r.rank).toBeLessThanOrEqual(r.rankUpper);
    }
  });
});
