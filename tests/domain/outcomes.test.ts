import { describe, it, expect } from 'vitest';
import { resolvePreferredResponse, effectiveOutcome } from '@/domain/outcomes';
import type { Outcome } from '@/types/contracts';

describe('resolvePreferredResponse', () => {
  it('returns leftResponseId when outcome is "left"', () => {
    expect(resolvePreferredResponse('left', 'left-id', 'right-id')).toBe('left-id');
  });

  it('returns rightResponseId when outcome is "right"', () => {
    expect(resolvePreferredResponse('right', 'left-id', 'right-id')).toBe('right-id');
  });

  it('returns null when outcome is "tie"', () => {
    expect(resolvePreferredResponse('tie', 'left-id', 'right-id')).toBe(null);
  });

  it('returns null when outcome is "both_unacceptable"', () => {
    expect(resolvePreferredResponse('both_unacceptable', 'left-id', 'right-id')).toBe(null);
  });

  it('returns null when outcome is "cannot_assess"', () => {
    expect(resolvePreferredResponse('cannot_assess', 'left-id', 'right-id')).toBe(null);
  });
});

describe('effectiveOutcome', () => {
  it('returns "both_unacceptable" when outcome is undefined and hasRewrite is true', () => {
    expect(effectiveOutcome(undefined, true)).toBe('both_unacceptable');
  });

  it('returns the outcome unchanged when outcome is "left" and hasRewrite is true', () => {
    expect(effectiveOutcome('left', true)).toBe('left');
  });

  it('returns the outcome unchanged when outcome is "left" and hasRewrite is false', () => {
    expect(effectiveOutcome('left', false)).toBe('left');
  });

  it('returns the outcome unchanged when outcome is "right" and hasRewrite is false', () => {
    expect(effectiveOutcome('right', false)).toBe('right');
  });

  it('returns the outcome unchanged when outcome is "tie" and hasRewrite is false', () => {
    expect(effectiveOutcome('tie', false)).toBe('tie');
  });

  it('returns the outcome unchanged when outcome is "both_unacceptable" and hasRewrite is false', () => {
    expect(effectiveOutcome('both_unacceptable', false)).toBe('both_unacceptable');
  });

  it('returns the outcome unchanged when outcome is "cannot_assess" and hasRewrite is false', () => {
    expect(effectiveOutcome('cannot_assess', false)).toBe('cannot_assess');
  });

  it('returns the outcome unchanged when outcome is defined and hasRewrite is true (for all outcomes)', () => {
    const outcomes: Outcome[] = ['left', 'right', 'tie', 'both_unacceptable', 'cannot_assess'];
    outcomes.forEach(outcome => {
      expect(effectiveOutcome(outcome, true)).toBe(outcome);
    });
  });
});
