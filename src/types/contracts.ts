export type Outcome = 'left' | 'right' | 'tie' | 'both_unacceptable' | 'cannot_assess';
export type RewriteForkedFrom = 'a' | 'b' | 'scratch';

export interface OutputSpecPart { type: string; label: string; note?: string }
export interface OutputSpec { target: string; parts: OutputSpecPart[] }
export type SourceBlock =
  | { type: 'text'; text: string }
  | { type: 'bullets'; items: string[] };

export interface BattleTask {
  case_external_ref: string;
  kind: string;
  title: string;
  guidance?: string;
  output_spec: OutputSpec;
  source_blocks: SourceBlock[];
}
export interface BattleOption { label: 'A' | 'B'; response_id: string; body_text: string; body_json?: unknown }
export interface BattlePayload { assignment_id: string; ui_version: string; task: BattleTask; options: BattleOption[] }

export interface VoteRequest {
  assignment_id: string;
  outcome: Outcome;
  reason_tags?: string[];
  free_text_comment?: string;
  time_to_first_action_ms: number;
  total_duration_ms: number;
  rewrite?: { forked_from: RewriteForkedFrom; body_text: string };
}
export interface VoteResponse { judgment_id: string; next: '/battle' }

export interface ApiError { error: { code: string; message: string; details?: unknown } }

export interface LeaderboardRow {
  competitor_version_id: string; competitor_name: string; version: number;
  display_score: number | null; rank: number | null; rank_lower: number | null; rank_upper: number | null;
  confidence_lower: number | null; confidence_upper: number | null;
  judgment_count: number; case_count: number; tie_rate: number | null; unacceptable_rate: number | null;
}
