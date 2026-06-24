import { describe, it, expect } from 'vitest';
import type {
  BattlePayload,
  BattleTask,
  BattleOption,
  VoteRequest,
  Outcome,
  SourceBlock,
  OutputSpec,
  OutputSpecPart,
} from '@/types/contracts';

describe('API Contract Types', () => {
  it('BattlePayload round-trips through JSON and has 2 options', () => {
    const outputSpecPart: OutputSpecPart = {
      type: 'text',
      label: 'Quality',
      note: 'Overall quality assessment',
    };

    const outputSpec: OutputSpec = {
      target: 'response',
      parts: [outputSpecPart],
    };

    const sourceBlock: SourceBlock = {
      type: 'text',
      text: 'This is a test source block.',
    };

    const task: BattleTask = {
      case_external_ref: 'case-001',
      kind: 'comparison',
      title: 'Test Battle Task',
      guidance: 'Compare the two responses.',
      output_spec: outputSpec,
      source_blocks: [sourceBlock],
    };

    const optionA: BattleOption = {
      label: 'A',
      response_id: 'resp-001-a',
      body_text: 'Response A text',
      body_json: { content: 'A' },
    };

    const optionB: BattleOption = {
      label: 'B',
      response_id: 'resp-001-b',
      body_text: 'Response B text',
      body_json: { content: 'B' },
    };

    const fixture: BattlePayload = {
      assignment_id: 'assign-001',
      ui_version: '1.0.0',
      task,
      options: [optionA, optionB],
    };

    // Assert options length is 2
    expect(fixture.options).toHaveLength(2);

    // Assert round-trip through JSON
    const serialized = JSON.stringify(fixture);
    const deserialized = JSON.parse(serialized) as BattlePayload;
    expect(deserialized).toEqual(fixture);
    expect(deserialized.assignment_id).toBe('assign-001');
    expect(deserialized.ui_version).toBe('1.0.0');
    expect(deserialized.task.case_external_ref).toBe('case-001');
    expect(deserialized.options).toHaveLength(2);
  });

  it('VoteRequest round-trips through JSON', () => {
    const fixture: VoteRequest = {
      assignment_id: 'assign-001',
      outcome: 'left' as Outcome,
      reason_tags: ['clarity', 'accuracy'],
      free_text_comment: 'Option A was more clear.',
      time_to_first_action_ms: 1500,
      total_duration_ms: 5000,
      rewrite: {
        forked_from: 'a',
        body_text: 'Rewritten response based on A.',
      },
    };

    // Assert round-trip through JSON
    const serialized = JSON.stringify(fixture);
    const deserialized = JSON.parse(serialized) as VoteRequest;
    expect(deserialized).toEqual(fixture);
    expect(deserialized.assignment_id).toBe('assign-001');
    expect(deserialized.outcome).toBe('left');
    expect(deserialized.reason_tags).toHaveLength(2);
    expect(deserialized.time_to_first_action_ms).toBe(1500);
  });
});
