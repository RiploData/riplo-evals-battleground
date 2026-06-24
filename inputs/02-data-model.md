# 02 — Data Model

Postgres. Everything below is the v1 table set. Columns marked **(phased)** are not exercised by v1 features but are included now because they are cheap to add and costly to retrofit. UUID primary keys (`gen_random_uuid()`), `timestamptz` throughout.

## Relationship overview

```
suites ─< suite_versions
cases  ─< case_versions ─┐
competitors ─< competitor_versions ─┐
                                     ├─ generation_attempts ─< responses
                                     │                          │
campaigns (1 implicit in v1) ────────┘                          │
                                                                │
responses ──< comparisons (response_one, response_two) ─< assignments ─< judgments
                                                                              │
judgments.rewrite_response_id ─> responses (origin_type = post_battle_rewrite)

judgments ──(batch fit)──> ranking_runs ─< ranking_scores
users (WorkOS-mapped)
```

The chain: `case_version × competitor_version → generation_attempt → response`; `two responses, same case → comparison`; `comparison + evaluator + order → assignment`; `assignment → judgment`; `judgments → ranking_run → ranking_scores`.

## Identity & access

```sql
create table users (
  id              uuid primary key default gen_random_uuid(),
  workos_user_id  text unique not null,        -- external subject; no local password
  email           text not null,
  display_name    text,
  app_role        text not null default 'evaluator',  -- evaluator|suite_editor|operator|analyst|admin
  org_id          text not null,               -- validated server-side against allowlist
  created_at      timestamptz not null default now(),
  status          text not null default 'active'
);
```

Single-org for v1 (`org_id` checked against an allowlist on every request). Membership/role is modelled separately from identity so multi-org and richer RBAC are additive later.

## Suites & cases

```sql
create table suites (
  id uuid primary key default gen_random_uuid(),
  name text not null, purpose text, intended_reader text,
  created_by uuid references users(id), created_at timestamptz not null default now()
);

create table suite_versions (
  id uuid primary key default gen_random_uuid(),
  suite_id uuid not null references suites(id),
  version int not null,
  rubric_json jsonb not null default '{}',     -- default evaluation rubric / question wording
  weighting_json jsonb not null default '{}',  -- case/domain/difficulty weights for ranking
  frozen_at timestamptz,                       -- once a campaign begins, must be non-null
  created_at timestamptz not null default now(),
  unique (suite_id, version)
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  suite_id uuid not null references suites(id),
  external_ref text,                           -- human-friendly id, e.g. "0142"
  created_at timestamptz not null default now()
);

create table case_versions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id),
  version int not null,
  kind text not null,                          -- e.g. 'compression' | 'judgment'
  title text not null,
  guidance text,                               -- one-line rater guidance (display)
  output_spec_json jsonb not null,             -- { target, parts:[{type,label,note}] } — "what we're building"
  runner_input_json jsonb not null,            -- shared, competitor-agnostic payload sent to the model
  evaluator_context_json jsonb not null,       -- display: title/guidance/output_spec/source blocks
  source_blocks_json jsonb not null default '[]', -- typed blocks: [{type:'text'|'bullets'|'image'|'chart', ...}]
  hidden_metadata_json jsonb not null default '{}', -- difficulty/domain/language/compression_ratio/failure_cat...
  tags text[] not null default '{}',
  dataset_split text not null default 'dev',   -- 'dev' | 'validation' | 'holdout'
  sampling_weight double precision not null default 1.0,
  sensitivity text not null default 'internal',
  content_hash text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (case_id, version)
);
```

Large source blobs (images/charts/long source) live in S3; `source_blocks_json` holds the block descriptors with S3 keys, not the bytes.

## Competitors

```sql
create table competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,                          -- logical approach, e.g. "Concise consultant"
  competitor_type text not null,               -- model_runner|human_baseline|production_baseline|legacy|reference
  created_at timestamptz not null default now()
);

create table competitor_versions (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id),
  version int not null,
  parent_competitor_version_id uuid references competitor_versions(id),  -- lineage
  model_provider text,                         -- e.g. 'bedrock'
  model_identifier text,                       -- e.g. 'anthropic.claude-...'
  prompt_bundle_json jsonb not null default '{}', -- system prompt + skill refs (the full prompt contract)
  model_parameters_json jsonb not null default '{}', -- temperature, top_p, max_tokens, etc.
  tool_config_json jsonb not null default '{}',     -- (phased) tools/MCP config
  output_schema_json jsonb,                    -- (phased) expected structured output
  source_type text not null default 'manual',  -- manual|optimizer_generated|production_import|human_authored|external
  content_hash text not null,                  -- hash of the full execution contract; immutable
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  status text not null default 'active',       -- active|retired
  unique (competitor_id, version)
);
```

**Immutability:** a `competitor_version` is frozen on creation. Enforce with a trigger that blocks `UPDATE` on the contract columns (or app-level discipline for v1). Editing a prompt = insert a new version with `parent_competitor_version_id` set.

## Campaigns

```sql
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  suite_version_id uuid not null references suite_versions(id),
  case_selector_json jsonb not null default '{}',   -- which cases are eligible
  eligible_competitor_version_ids uuid[] not null default '{}',
  replicates int not null default 1,
  matchmaking_strategy text not null default 'coverage',
  required_judgments_per_battle int not null default 1,
  ranking_method text not null default 'bradley_terry',
  started_at timestamptz, ended_at timestamptz,
  created_at timestamptz not null default now()
);
```

v1 may run a single implicit default campaign. The table exists so that suite version, case distribution, weighting and method are always recorded against the evaluation exercise — and so ratings from different suite versions are never silently compared.

## Generation & responses

```sql
create table generation_attempts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id),
  case_version_id uuid not null references case_versions(id),
  competitor_version_id uuid not null references competitor_versions(id),
  replicate_index int not null default 0,
  status text not null default 'queued',       -- queued|running|succeeded|failed
  rendered_request jsonb,                      -- exact request sent (analyst-only; never served in a battle)
  provider_request_id text,
  raw_provider_response_s3_key text,           -- large blob in S3
  model_reported_version text,
  seed bigint,
  latency_ms int, input_tokens int, output_tokens int, estimated_cost numeric(12,6),
  finish_reason text, error_code text,
  runner_code_version text,
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index gen_attempts_cell on generation_attempts (case_version_id, competitor_version_id);

create table responses (
  id uuid primary key default gen_random_uuid(),
  case_version_id uuid not null references case_versions(id),
  competitor_version_id uuid references competitor_versions(id),  -- NULL for human-authored
  origin_type text not null,                   -- model_generation|independent_human_baseline|post_battle_rewrite|reference
  generation_attempt_id uuid references generation_attempts(id),
  author_user_id uuid references users(id),    -- human authors / rewriters
  body_text text not null,
  body_json jsonb,                             -- structured output if output_spec demands it
  parent_response_ids uuid[],                  -- (phased/rewrite) lineage for rewrites/syntheses
  reuse_permission boolean,                    -- (phased) may this human-authored response re-enter battles
  authoring_protocol_json jsonb,               -- (phased) baseline protocol: time allowed, tools, expertise band
  length_chars int, length_tokens int,         -- computed; for bias analysis, never shown to raters
  content_hash text not null,
  created_at timestamptz not null default now(),
  status text not null default 'active'        -- active|invalidated
);
-- one model response per (case, competitor, replicate)
create unique index responses_model_cell
  on responses (case_version_id, competitor_version_id, replicate_index_from_attempt(generation_attempt_id))
  where origin_type = 'model_generation';
-- (simpler v1 alternative: enforce uniqueness in app code; the intent is one model response per cell+replicate)
```

`origin_type` keeps model outputs, **independent human baselines**, and **post-battle rewrites** distinct — a rewrite is influenced by having seen A and B and must never be treated as an independent baseline.

## Battles, assignments, judgments

```sql
create table comparisons (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id),
  case_version_id uuid not null references case_versions(id),
  response_one_id uuid not null references responses(id),   -- 'one'/'two' are storage labels, not A/B
  response_two_id uuid not null references responses(id),
  matchmaking_strategy text, matchmaking_reason text,
  created_at timestamptz not null default now(),
  status text not null default 'active'
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references comparisons(id),
  assigned_user_id uuid not null references users(id),
  left_response_id uuid not null references responses(id),   -- exact presentation order
  right_response_id uuid not null references responses(id),
  ui_version text, evaluator_instruction_version text,
  assigned_at timestamptz not null default now(),
  opened_at timestamptz, submitted_at timestamptz, expired_at timestamptz,
  status text not null default 'open'          -- open|submitted|expired
);

create table judgments (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id),
  user_id uuid not null references users(id),
  outcome text not null,                       -- left|right|tie|both_unacceptable|cannot_assess
  preferred_response_id uuid references responses(id),  -- resolved from outcome + order
  reason_tags text[] not null default '{}',    -- (phased v1.1) diagnostic, post-choice
  free_text_comment text,
  rewrite_response_id uuid references responses(id),    -- set if the rater rewrote
  rewrite_forked_from text,                    -- 'a'|'b'|'scratch' — secondary signal, NOT the preference label
  time_to_first_action_ms int, total_duration_ms int,
  submitted_at timestamptz not null default now(),
  status text not null default 'valid',        -- valid|retracted|invalidated|duplicate|adjudicated
  invalidated_at timestamptz, invalidation_reason text
);
```

Judgments are **append-only**. Corrections and invalidations are new rows / audited status changes, never destructive updates. `outcome` stores `left`/`right` (relative to presentation order); `preferred_response_id` is the resolved winner so the ranking job needn't re-derive it.

## Ranking (derived)

```sql
create table ranking_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id),
  algorithm text not null default 'bradley_terry',
  algorithm_version text,
  parameters_json jsonb not null default '{}',
  vote_cutoff_at timestamptz not null,         -- judgments up to this instant
  filters_json jsonb not null default '{}',
  code_version text,
  created_at timestamptz not null default now(),
  status text not null default 'complete'
);

create table ranking_scores (
  ranking_run_id uuid not null references ranking_runs(id),
  competitor_version_id uuid not null references competitor_versions(id),
  raw_score double precision, display_score double precision,  -- display = Elo-like transform
  rank int, rank_lower int, rank_upper int,
  confidence_lower double precision, confidence_upper double precision,
  judgment_count int, case_count int,
  unacceptable_rate double precision, tie_rate double precision,
  primary key (ranking_run_id, competitor_version_id)
);
```

A convenience current-leaderboard view may exist but must always point back to a `ranking_run`. Ratings are reproducible from `judgments` alone — wipe `ranking_runs`/`ranking_scores` and they rebuild.

## Invariants enforced here

- Immutable `competitor_versions` and `case_versions` (trigger or discipline); edits create new versions.
- Immutable `responses`; rewrites are new rows with `parent_response_ids`.
- Append-only `judgments` with a status enum, not a boolean override.
- `assignments` always carry left/right order.
- Ratings live only in `ranking_*`, derived from `judgments`.
