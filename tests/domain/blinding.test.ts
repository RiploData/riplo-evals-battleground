import { describe, it, expect } from 'vitest';
import { toBlindedOptions, StoredResponse } from '@/domain/blinding';

const BANNED_FIELDS = [
  'competitor_version_id',
  'origin_type',
  'author_user_id',
  'generation_attempt_id',
  'length_chars',
  'length_tokens',
];

const ALLOWED_KEYS_WITHOUT_JSON = new Set(['label', 'response_id', 'body_text']);
const ALLOWED_KEYS_WITH_JSON = new Set(['label', 'response_id', 'body_text', 'body_json']);

const fullLeft: StoredResponse = {
  id: 'resp-left-001',
  body_text: 'Left response body',
  body_json: { answer: 42 },
  competitor_version_id: 'cv-aaa',
  origin_type: 'model',
  author_user_id: 'user-xyz',
  generation_attempt_id: 'gen-001',
  length_chars: 18,
  length_tokens: 4,
};

const fullRight: StoredResponse = {
  id: 'resp-right-002',
  body_text: 'Right response body',
  competitor_version_id: 'cv-bbb',
  origin_type: 'human',
  author_user_id: 'user-abc',
  generation_attempt_id: 'gen-002',
  length_chars: 19,
  length_tokens: 4,
};

describe('toBlindedOptions', () => {
  it('returns exactly two options labeled A and B in order', () => {
    const result = toBlindedOptions(fullLeft, fullRight);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe('A');
    expect(result[1].label).toBe('B');
  });

  it('maps left to A with correct response_id and body_text', () => {
    const result = toBlindedOptions(fullLeft, fullRight);
    expect(result[0].response_id).toBe('resp-left-001');
    expect(result[0].body_text).toBe('Left response body');
  });

  it('maps right to B with correct response_id and body_text', () => {
    const result = toBlindedOptions(fullLeft, fullRight);
    expect(result[1].response_id).toBe('resp-right-002');
    expect(result[1].body_text).toBe('Right response body');
  });

  it('includes body_json when present on left', () => {
    const result = toBlindedOptions(fullLeft, fullRight);
    expect(result[0].body_json).toEqual({ answer: 42 });
  });

  it('omits body_json key when not present on right', () => {
    const result = toBlindedOptions(fullLeft, fullRight);
    expect(Object.keys(result[1])).not.toContain('body_json');
  });

  it('option A has exactly the allowed keys (with body_json)', () => {
    const result = toBlindedOptions(fullLeft, fullRight);
    const keysA = new Set(Object.keys(result[0]));
    expect(keysA).toEqual(ALLOWED_KEYS_WITH_JSON);
  });

  it('option B has exactly the allowed keys (without body_json)', () => {
    const result = toBlindedOptions(fullLeft, fullRight);
    const keysB = new Set(Object.keys(result[1]));
    expect(keysB).toEqual(ALLOWED_KEYS_WITHOUT_JSON);
  });

  it('no banned field names appear in JSON.stringify of the result', () => {
    const result = toBlindedOptions(fullLeft, fullRight);
    const serialized = JSON.stringify(result);
    for (const banned of BANNED_FIELDS) {
      expect(serialized, `banned field "${banned}" found in serialized output`).not.toContain(
        `"${banned}"`
      );
    }
  });

  it('works when neither option has body_json', () => {
    const noJsonLeft: StoredResponse = { id: 'l', body_text: 'left', competitor_version_id: 'cv-x' };
    const noJsonRight: StoredResponse = { id: 'r', body_text: 'right', length_chars: 5 };
    const result = toBlindedOptions(noJsonLeft, noJsonRight);
    expect(new Set(Object.keys(result[0]))).toEqual(ALLOWED_KEYS_WITHOUT_JSON);
    expect(new Set(Object.keys(result[1]))).toEqual(ALLOWED_KEYS_WITHOUT_JSON);
  });
});
