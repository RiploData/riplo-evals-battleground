import type { BattleOption } from '@/types/contracts';

export interface StoredResponse {
  id: string;
  body_text: string;
  body_json?: unknown;
  competitor_version_id?: string | null;
  origin_type?: string;
  author_user_id?: string | null;
  generation_attempt_id?: string | null;
  length_chars?: number | null;
  length_tokens?: number | null;
}

/**
 * Blinding boundary (security invariant #3).
 *
 * Returns [optionA, optionB] containing ONLY the fields allowed in BattleOption.
 * Each object is constructed via an explicit allowlist — inputs are NEVER spread —
 * so no banned metadata field can leak to the UI layer.
 */
export function toBlindedOptions(
  left: StoredResponse,
  right: StoredResponse,
): BattleOption[] {
  const optionA: BattleOption =
    left.body_json !== undefined
      ? { label: 'A', response_id: left.id, body_text: left.body_text, body_json: left.body_json }
      : { label: 'A', response_id: left.id, body_text: left.body_text };

  const optionB: BattleOption =
    right.body_json !== undefined
      ? { label: 'B', response_id: right.id, body_text: right.body_text, body_json: right.body_json }
      : { label: 'B', response_id: right.id, body_text: right.body_text };

  return [optionA, optionB];
}
