import { describe, it, expect } from 'vitest';
import { isCaseEligible } from '@/domain/eligibility';

describe('isCaseEligible', () => {
  it('override=true makes any case eligible (even retired)', () => {
    expect(
      isCaseEligible({ retiredAt: new Date(), eligibleOverride: true, latestSplit: 'holdout' }),
    ).toBe(true);
  });

  it('override=false makes any case ineligible (even fresh dev case)', () => {
    expect(
      isCaseEligible({ retiredAt: null, eligibleOverride: false, latestSplit: 'dev' }),
    ).toBe(false);
  });

  it('default: dev split + not retired → eligible', () => {
    expect(
      isCaseEligible({ retiredAt: null, eligibleOverride: null, latestSplit: 'dev' }),
    ).toBe(true);
  });

  it('default: holdout split → ineligible', () => {
    expect(
      isCaseEligible({ retiredAt: null, eligibleOverride: null, latestSplit: 'holdout' }),
    ).toBe(false);
  });

  it('default: validation split → ineligible', () => {
    expect(
      isCaseEligible({ retiredAt: null, eligibleOverride: null, latestSplit: 'validation' }),
    ).toBe(false);
  });

  it('default: retired + dev split → ineligible', () => {
    expect(
      isCaseEligible({ retiredAt: new Date(), eligibleOverride: null, latestSplit: 'dev' }),
    ).toBe(false);
  });
});
