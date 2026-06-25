export interface EligibilityInput {
  retiredAt: Date | null;
  eligibleOverride: boolean | null;
  latestSplit: string;
}

/**
 * Resolves whether a case is eligible for battle.
 *
 * Priority:
 * 1. eligibleOverride=true  → always eligible (admin force-in)
 * 2. eligibleOverride=false → always ineligible (admin force-out)
 * 3. Default rule: not retired AND latest version is on 'dev' split
 */
export function isCaseEligible(p: EligibilityInput): boolean {
  if (p.eligibleOverride === true) return true;
  if (p.eligibleOverride === false) return false;
  return p.retiredAt === null && p.latestSplit === 'dev';
}
