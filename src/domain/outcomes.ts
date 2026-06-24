import type { Outcome } from '@/types/contracts';

export function resolvePreferredResponse(
  outcome: Outcome,
  leftResponseId: string,
  rightResponseId: string
): string | null {
  if (outcome === 'left') {
    return leftResponseId;
  }
  if (outcome === 'right') {
    return rightResponseId;
  }
  return null;
}

export function effectiveOutcome(outcome: Outcome | undefined, hasRewrite: boolean): Outcome {
  if (outcome === undefined && hasRewrite) {
    return 'both_unacceptable';
  }
  return outcome ?? 'both_unacceptable';
}
