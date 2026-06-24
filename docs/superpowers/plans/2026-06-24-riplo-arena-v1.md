# Riplo Arena v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running, local-first v1 of the Riplo Arena blinded-preference evaluation loop — author cases & competitor setups in git, generate responses via OpenRouter, serve blinded A/B battles, capture judgments + rewrites, compute a Bradley–Terry Arena rating, and view leaderboard/reports/export.

**Architecture:** Next.js (App Router, TypeScript) single app. `domain/` holds pure, framework-free logic (matchmaking, blinding, outcome resolution, ranking math, content-hash) that is unit-tested in isolation. `services/` orchestrates Postgres (Drizzle) + domain inside transactions. `app/api/` is a thin HTTP shell enforcing WorkOS auth + the blinding boundary. Cases, competitor setups, and the default suite/campaign are git-authored config-as-code ingested by idempotent, content-addressed importers (`npm run seed`).

**Tech Stack:** Next.js 15 (App Router), TypeScript (strict), Drizzle ORM + drizzle-kit, Postgres 16 (Docker Compose), WorkOS AuthKit (`@workos-inc/authkit-nextjs`), OpenRouter (via `openai` SDK pointed at OpenRouter base URL), Zod, Vitest, Playwright.

Full requirements live in the spec: `docs/superpowers/specs/2026-06-24-riplo-arena-v1-design.md` and the handover pack in `inputs/`.

## Global Constraints

- **Immutability (invariant #4, #5, #6):** `competitor_versions`, `case_versions`, and `responses` are frozen on creation. Edits create new versions/rows; never `UPDATE` contract columns. `judgments` are append-only; corrections are status changes, never destructive updates.
- **Blinding (invariant #3):** `GET /battle` and `POST /vote` payloads pass through `domain/blinding.ts` ONLY. No competitor identity, model, prompt, origin_type, author, generation_attempt, latency, `length_chars`, or `length_tokens` may reach a rater.
- **Derived ratings (invariant #7):** ratings live only in `ranking_runs`/`ranking_scores`; reproducible from `judgments` alone with a recorded bootstrap seed.
- **Order recorded (invariant #2):** every `assignment` persists exact `left_response_id`/`right_response_id`; presentation order is randomised per assignment, server-side.
- **Distinct signals (invariant #9):** `tie`, `both_unacceptable`, `cannot_assess` stay distinct in storage and analytics.
- **TypeScript strict mode**, ESLint clean, all code formatted with Prettier defaults.
- **Content-addressing:** `content_hash` is a SHA-256 hex of canonical-JSON (sorted keys) of the addressed object. Use ONE helper (`domain/content-hash.ts`) everywhere.
- **DB access:** all queries go through the pooled client in `src/db/client.ts`; bounded pool (`max: 5`) for RDS-Proxy parity. Never open ad-hoc connections.
- **Commit cadence:** commit after each task's tests pass. Conventional Commits (`feat:`, `test:`, `chore:`).

---

## Wave 0 — Foundation (blocking; do these first, in order)

### Task 1: Repo scaffold + toolchain + Docker Postgres

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.eslintrc.json`, `.prettierrc`, `.gitignore`, `.env.example`, `docker-compose.yml`, `drizzle.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`
- Test: `tests/smoke/scaffold.test.ts`

**Interfaces:**
- Produces: a runnable Next.js app (`npm run dev`), `npm test` (Vitest), `npm run test:e2e` (Playwright), `npm run db:migrate`/`db:generate` (drizzle-kit), `docker compose up -d` for Postgres on `localhost:5432`.

- [ ] **Step 1:** Scaffold dependencies in `package.json`:
  - deps: `next`, `react`, `react-dom`, `drizzle-orm`, `pg`, `zod`, `@workos-inc/authkit-nextjs`, `openai`, `lucide-react`
  - devDeps: `typescript`, `@types/node`, `@types/react`, `@types/pg`, `drizzle-kit`, `vitest`, `@vitest/coverage-v8`, `@playwright/test`, `eslint`, `eslint-config-next`, `prettier`, `tsx`
  - scripts: `dev`, `build`, `start`, `lint`, `test` (`vitest run`), `test:watch`, `test:e2e` (`playwright test`), `db:generate` (`drizzle-kit generate`), `db:migrate` (`tsx src/db/migrate.ts`), `seed` (`tsx scripts/seed.ts`), `cases:validate` (`tsx scripts/validate.ts`), `cases:smoke` (`tsx scripts/smoke.ts`)
- [ ] **Step 2:** `docker-compose.yml` — `postgres:16` service, db `arena`, user/pass `arena`/`arena`, port `5432:5432`, named volume.
- [ ] **Step 3:** `.env.example` with every variable + comments:

```dotenv
# Postgres (matches docker-compose.yml)
DATABASE_URL=postgres://arena:arena@localhost:5432/arena

# WorkOS AuthKit — populate locally (https://dashboard.workos.com)
WORKOS_API_KEY=
WORKOS_CLIENT_ID=
WORKOS_COOKIE_PASSWORD=   # >=32 chars, generate with: openssl rand -base64 32
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
# Only members of this WorkOS organization may use the app:
ALLOWED_ORG_ID=

# OpenRouter (https://openrouter.ai/keys)
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

- [ ] **Step 4:** `tsconfig.json` strict, path alias `@/*` → `src/*`. `vitest.config.ts` with the same alias and `environment: 'node'`.
- [ ] **Step 5 (test):** `tests/smoke/scaffold.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
describe('scaffold', () => {
  it('resolves the @ alias and env contract', () => {
    expect(typeof process.versions.node).toBe('string');
  });
});
```

- [ ] **Step 6:** Run `npm install && npm test`. Expected: scaffold test PASS.
- [ ] **Step 7:** Commit `chore: scaffold next.js + drizzle + vitest + docker postgres`.

---

### Task 2: Database schema, migration, immutability guards

**Files:**
- Create: `src/db/schema/identity.ts`, `src/db/schema/suites-cases.ts`, `src/db/schema/competitors.ts`, `src/db/schema/campaigns.ts`, `src/db/schema/generation.ts`, `src/db/schema/battles.ts`, `src/db/schema/ranking.ts`, `src/db/schema/index.ts`, `src/db/client.ts`, `src/db/migrate.ts`
- Create (generated): `src/db/migrations/0001_*.sql` + `src/db/migrations/0002_immutability.sql` (hand-written guards)
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL`.
- Produces: Drizzle table objects exported from `@/db/schema`; `db` (Drizzle client) + `pool` from `@/db/client`. Table set EXACTLY matches `inputs/02-data-model.md` including all `(phased)` columns.

- [ ] **Step 1:** Translate every table in `inputs/02-data-model.md` into Drizzle schema files, grouped as listed. Include phased columns (`tool_config_json`, `output_schema_json`, `parent_response_ids`, `reuse_permission`, `authoring_protocol_json`, `reason_tags`, etc.). Use `uuid().defaultRandom()`, `timestamp({withTimezone:true}).defaultNow()`, `jsonb`, `text[]` via `text().array()`.
- [ ] **Step 2:** `src/db/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
export const db = drizzle(pool, { schema });
```

- [ ] **Step 3:** Run `npm run db:generate` to emit `0001_*.sql`.
- [ ] **Step 4:** Hand-write `0002_immutability.sql`: a trigger function blocking `UPDATE` of contract columns on `competitor_versions` (model_*, prompt_bundle_json, model_parameters_json, content_hash), `case_versions` (content_hash, output_spec_json, runner_input_json), and `responses` (body_text, content_hash) — raise exception. Plus the partial unique index on `responses` for model cells (app-enforced fallback acceptable; document the chosen approach in a comment).
- [ ] **Step 5:** `src/db/migrate.ts` runs drizzle migrator then executes `0002_immutability.sql`.
- [ ] **Step 6 (test):** `tests/integration/schema.test.ts` (requires `docker compose up -d`): migrate, then assert: inserting a `competitor_versions` row then `UPDATE`-ing its `content_hash` throws; inserting a `responses` row then `UPDATE`-ing `body_text` throws; a basic insert into `users` succeeds.
- [ ] **Step 7:** Run `npm run db:migrate && npm test tests/integration/schema.test.ts`. Expected: PASS (update attempts rejected).
- [ ] **Step 8:** Commit `feat: drizzle schema, migrations, immutability guards`.

---

### Task 3: Shared contract types (API boundary)

**Files:**
- Create: `src/types/contracts.ts`
- Test: `tests/domain/contracts.test.ts`

**Interfaces:**
- Produces: the TypeScript types every API route and the UI build against, transcribed from `inputs/03-api-contract.md`. Other tasks import these by name; keep names stable.

- [ ] **Step 1:** Define and export:

```ts
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
```

- [ ] **Step 2 (test):** `tests/domain/contracts.test.ts` — a compile-time check via a typed fixture object for `BattlePayload` and `VoteRequest`; assert `JSON.parse(JSON.stringify(fixture))` round-trips and `options` length is 2.
- [ ] **Step 3:** Run `npm test tests/domain/contracts.test.ts`. Expected: PASS.
- [ ] **Step 4:** Commit `feat: shared API contract types`.

---

## Wave 1 — Parallel build (each task is independent given Wave 0)

### Task 4: `domain/content-hash`

**Files:** Create `src/domain/content-hash.ts`; Test `tests/domain/content-hash.test.ts`

**Interfaces:** Produces `contentHash(value: unknown): string` (SHA-256 hex over canonical JSON with recursively sorted object keys; arrays order-preserved).

- [ ] **Step 1 (test):** assert `contentHash({a:1,b:2}) === contentHash({b:2,a:1})`; differs for `{a:1}` vs `{a:2}`; stable across calls; arrays `[1,2]` ≠ `[2,1]`.
- [ ] **Step 2:** Run — FAIL (not defined).
- [ ] **Step 3:** Implement with `node:crypto` `createHash('sha256')` over a `canonicalize(value)` that sorts keys.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: content-addressing helper`.

---

### Task 5: `domain/blinding`

**Files:** Create `src/domain/blinding.ts`; Test `tests/domain/blinding.test.ts`

**Interfaces:**
- Consumes: `BattleOption` from `@/types/contracts`.
- Produces:

```ts
export interface StoredResponse { id: string; body_text: string; body_json?: unknown;
  competitor_version_id?: string | null; origin_type?: string; author_user_id?: string | null;
  generation_attempt_id?: string | null; length_chars?: number | null; length_tokens?: number | null }
export function toBlindedOptions(
  left: StoredResponse, right: StoredResponse
): BattleOption[]; // [{label:'A',...left}, {label:'B',...right}] — ONLY id + body
```

- [ ] **Step 1 (test):** call `toBlindedOptions(full, full)` where inputs carry `competitor_version_id`, `origin_type`, `length_chars`, etc.; assert each returned option's keys are exactly `['label','response_id','body_text']` (or `+body_json` when present); assert labels are `A`,`B` in order; assert no banned key leaks via `JSON.stringify`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement by explicitly constructing the object (allowlist, never spread).
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: blinding boundary`.

---

### Task 6: `domain/outcomes`

**Files:** Create `src/domain/outcomes.ts`; Test `tests/domain/outcomes.test.ts`

**Interfaces:**
```ts
export function resolvePreferredResponse(
  outcome: Outcome, leftResponseId: string, rightResponseId: string
): string | null; // left->left id, right->right id, else null
export function effectiveOutcome(outcome: Outcome | undefined, hasRewrite: boolean): Outcome;
// undefined+rewrite -> 'both_unacceptable'; otherwise pass through
```

- [ ] **Step 1 (test):** `left`→leftId; `right`→rightId; `tie`/`both_unacceptable`/`cannot_assess`→null. `effectiveOutcome(undefined,true)` → `both_unacceptable`; `effectiveOutcome('left',true)` → `left`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: outcome resolution`.

---

### Task 7: `domain/matchmaking`

**Files:** Create `src/domain/matchmaking.ts`; Test `tests/domain/matchmaking.test.ts`

**Interfaces:**
```ts
export interface Cell { caseVersionId: string; competitorVersionId: string }
export interface PairCandidate { caseVersionId: string; competitorA: string; competitorB: string }
export interface MatchmakingInput {
  cases: { caseVersionId: string; tags: string[] }[];
  eligibleCompetitorVersionIds: string[];
  existingPairCounts: Record<string, number>;      // key `${caseVersionId}|${a}|${b}` (a<b sorted)
  seenByUser: Set<string>;                          // keys `${caseVersionId}|${a}|${b}` already shown to this user
  rng: () => number;                                // injectable for determinism
}
export function selectPair(input: MatchmakingInput): PairCandidate | null;
export function pairKey(caseVersionId: string, a: string, b: string): string; // sorts a,b
```
Strategy (v1 coverage): prefer pairs with the lowest `existingPairCounts`; never return a pair in `seenByUser`; balance across case tags by weighting under-covered tags; pick randomly (via `rng`) within the lowest-evidence tier; return `null` when every eligible pair has been seen by this user.

- [ ] **Step 1 (test):** with 1 case + competitors [x,y,z], no history, seeded rng → returns a valid unseen pair; when all pairs for the only case are in `seenByUser` → `null`; given uneven `existingPairCounts`, the returned pair is among the least-covered; `pairKey('c','y','x')===pairKey('c','x','y')`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (pure; rng injected). **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: coverage matchmaking`.

---

### Task 8: `domain/ranking` (Bradley–Terry + bootstrap)

**Files:** Create `src/domain/ranking/bradley-terry.ts`, `src/domain/ranking/bootstrap.ts`, `src/domain/ranking/run.ts`; Test `tests/domain/ranking/*.test.ts`

**Interfaces:**
```ts
export interface PrefRecord { winner: string; loser: string; weight: number } // tie -> two 0.5-weight records
export interface BTResult { scores: Record<string, number> } // log-strength, mean-centered
export function fitBradleyTerry(competitorIds: string[], prefs: PrefRecord[], opts?: {iters?: number; tol?: number}): BTResult;

export interface RankingScore {
  competitorVersionId: string; rawScore: number; displayScore: number;  // display = 400/ln(10) * raw + 1500 anchor? -> see run.ts
  rank: number; rankLower: number; rankUpper: number;
  confidenceLower: number; confidenceUpper: number;
  judgmentCount: number; caseCount: number; tieRate: number; unacceptableRate: number;
}
export interface JudgmentForFit {
  competitorVersionIdA: string; competitorVersionIdB: string; // the two competitors in the comparison
  caseVersionId: string;
  outcome: Outcome;            // left/right already resolved to A/B by the caller
  preferredCompetitorVersionId: string | null;
}
export function computeRanking(judgments: JudgmentForFit[], seed: number): RankingScore[];
export function bootstrapIntervals(competitorIds: string[], prefs: PrefRecord[], seed: number, samples?: number): Record<string,{lo:number;hi:number}>;
```
Rules (spec §8): tie → half-win each; exclude `cannot_assess`; exclude `both_unacceptable` from the preference fit but count toward each competitor's `unacceptableRate`; deterministic bootstrap via a seeded PRNG (mulberry32); `displayScore` is an Elo-like transform documented in `run.ts`.

- [ ] **Step 1 (test) bradley-terry:** a dominant competitor (beats all) gets the highest score; a symmetric 1–1 between two yields ~equal scores; converges within `iters`.
- [ ] **Step 2 (test) bootstrap:** same seed → identical intervals (determinism); more data → narrower interval.
- [ ] **Step 3 (test) run:** ties contribute half-wins (a competitor with only ties ranks mid); `both_unacceptable` raises `unacceptableRate` but doesn't move the head-to-head; `cannot_assess` ignored entirely; reproducible across two calls with the same seed.
- [ ] **Step 4:** Run all — FAIL. **Step 5:** Implement (MM/iterative algorithm for BT; mulberry32 PRNG). **Step 6:** Run — PASS.
- [ ] **Step 7:** Commit `feat: bradley-terry ranking + bootstrap CIs`.

---

### Task 9: Auth (WorkOS + RBAC)

**Files:** Create `src/auth/workos.ts`, `src/auth/rbac.ts`, `src/middleware.ts`, `src/app/callback/route.ts`; Test `tests/integration/auth.test.ts`

**Interfaces:**
```ts
export type AppRole = 'evaluator' | 'suite_editor' | 'operator' | 'analyst' | 'admin';
export interface SessionUser { id: string; workosUserId: string; email: string; appRole: AppRole; orgId: string }
export async function requireUser(): Promise<SessionUser>;        // validates session, org allowlist, upserts users row
export function requireRole(user: SessionUser, ...roles: AppRole[]): void; // throws ForbiddenError if not permitted
export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}
```
`requireUser`: use `@workos-inc/authkit-nextjs` `withAuth()`; reject if the authenticated org ≠ `ALLOWED_ORG_ID` (throw `UnauthorizedError`); upsert local `users` row keyed by `workos_user_id` (default `app_role='evaluator'`, set `org_id`); return `SessionUser`. `middleware.ts` runs AuthKit middleware. `callback/route.ts` is the AuthKit redirect handler.

- [ ] **Step 1 (test):** mock `withAuth` → user in `ALLOWED_ORG_ID` upserts a `users` row and returns it; user in another org → `UnauthorizedError`; `requireRole(evaluatorUser,'admin')` → `ForbiddenError`; `requireRole(adminUser,'admin')` → ok.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: workos auth + org allowlist + rbac`.

---

### Task 10: Generation (OpenRouter runner)

**Files:** Create `src/services/generation/providers/openrouter.ts`, `src/services/generation/runner.ts`; Test `tests/integration/generation.test.ts`

**Interfaces:**
```ts
export interface ProviderRequest { model: string; system: string; user: string; params: Record<string, unknown> }
export interface ProviderResult { text: string; inputTokens: number; outputTokens: number; finishReason: string;
  providerRequestId?: string; modelReportedVersion?: string; raw: unknown }
export interface GenerationProvider { execute(req: ProviderRequest): Promise<ProviderResult> }
export const openRouterProvider: GenerationProvider;

// runner.ts
export async function ensureResponse(caseVersionId: string, competitorVersionId: string, replicateIndex?: number, campaignId?: string): Promise<{ responseId: string }>;
```
`ensureResponse`: if a `responses` row already exists for the cell+replicate, return it (cache). Else insert `generation_attempts` (`queued`→`running`), render the request from the case `runner_input_json` + competitor `prompt_bundle_json`/`model_parameters_json`, call the provider keyed by `model_identifier`, on success write an immutable content-hashed `responses` row (`origin_type='model_generation'`, compute `length_chars`/`length_tokens`) and mark attempt `succeeded`; on error mark `failed` with `error_code`. Provider uses the `openai` SDK with `baseURL=OPENROUTER_BASE_URL`, `apiKey=OPENROUTER_API_KEY`.

- [ ] **Step 1 (test):** inject a fake `GenerationProvider`; `ensureResponse` writes one attempt + one response; calling again returns the same `responseId` and creates no second attempt (idempotent cache); a provider throw marks the attempt `failed` and writes no response.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (runner takes an optional provider arg defaulting to `openRouterProvider` for test injection). **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: openrouter generation runner with queued-row contract`.

---

### Task 11: Case importer + Zod schema + first cases

**Files:** Create `src/corpus/case-schema.ts`, `src/corpus/import-cases.ts`, `src/corpus/storage.ts`, `cases/<authored cases>`; Test `tests/integration/import-cases.test.ts`

**Interfaces:**
```ts
export const caseFileSchema: import('zod').ZodType<CaseFile>;
export interface CaseFile { kind: string; title: string; guidance?: string; output_spec: OutputSpec;
  runner_input: Record<string, unknown>; source_blocks: SourceBlock[]; hidden_metadata: Record<string, unknown>;
  tags: string[]; dataset_split: 'dev'|'validation'|'holdout'; rubric_notes?: string[]; suite: string }
export function validateCaseFile(json: unknown): CaseFile;        // throws ZodError
export async function importCases(rootDir: string): Promise<{ created: number; unchanged: number }>;
// storage.ts: putBlob(key,bytes)/getBlobUrl(key) — local-fs driver under ./.storage
```
`importCases`: walk `cases/**/case.json`; derive `external_ref` from path; upsert `cases` row; compute `content_hash` over the canonical `CaseFile`; if the latest `case_version` for that case has the same hash → unchanged; else insert a NEW `case_version` (next `version`) building `output_spec_json`, `runner_input_json`, `evaluator_context_json` (`{title,guidance,output_spec,source_blocks}`), `source_blocks_json`, `hidden_metadata_json`, `tags`, `dataset_split`, `sampling_weight`. Never mutate prior versions.

- [ ] **Step 1 (test):** `validateCaseFile` rejects a missing `output_spec` and an invalid `dataset_split`. `importCases` on a fixture dir creates N versions; re-running → `created:0, unchanged:N`; editing one fixture's title then re-running → `created:1` and two versions exist for that case.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement importer + author 6–8 synthetic Stream-A cases (2 domains e.g. `pe-diligence`,`market-sizing` × kinds `compression`,`judgment`, all `dataset_split:dev`), reusing the two worked examples in `arena-rater-view.jsx`/`03` as starting content. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: case zod schema + idempotent importer + seed cases`.

---

### Task 12: Competitor importer + first setups

**Files:** Create `src/corpus/competitor-schema.ts`, `src/corpus/import-competitors.ts`, `competitors/<authored setups>`; Test `tests/integration/import-competitors.test.ts`

**Interfaces:**
```ts
export interface CompetitorFile { name: string; competitor_type: string } // competitor.json
export interface CompetitorVersionFile { model_provider: string; model_identifier: string;
  prompt_bundle: { system_prompt?: string; system_prompt_ref?: string; skills?: string[] };
  model_parameters: Record<string, unknown>; source_type: string; parent?: { slug: string; version: number } }
export function validateCompetitor(json: unknown): CompetitorFile;
export function validateCompetitorVersion(json: unknown): CompetitorVersionFile;
export async function importCompetitors(rootDir: string): Promise<{ created: number; unchanged: number }>;
```
`importCompetitors`: for each `competitors/<slug>/`, upsert the logical `competitors` row; for each `versions/*.json`, resolve `system_prompt_ref` (read from `prompts/`), compute `content_hash` over the resolved execution contract; if a `competitor_version` with that hash exists → unchanged; else insert a NEW immutable version (next `version`, resolved `parent_competitor_version_id`).

- [ ] **Step 1 (test):** importing fixtures creates competitors+versions; re-run → unchanged; editing a prompt body → a new version (old retained); a version referencing a missing parent → throws.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement + author ≥2 distinct competitor setups (e.g. `concise-consultant` on `anthropic/claude-opus-4-8`, `gpt5-baseline` on `openai/gpt-5`) with real-ish system prompts in `prompts/`. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: competitor config-as-code importer + seed setups`.

---

### Task 13: Suite/campaign config + seed orchestrator + validate/smoke scripts

**Files:** Create `src/corpus/config-schema.ts`, `src/corpus/import-config.ts`, `config/suites/default.json`, `config/campaign.json`, `scripts/seed.ts`, `scripts/validate.ts`, `scripts/smoke.ts`, `.github/workflows/corpus.yml`; Test `tests/integration/import-config.test.ts`

**Interfaces:**
```ts
export async function importConfig(rootDir: string): Promise<{ suiteVersionId: string; campaignId: string }>;
// scripts/seed.ts: importConfig() -> importCompetitors() -> importCases() -> link campaign.eligible_competitor_version_ids
```
`config/campaign.json` references the suite, sets `replicates:1`, `matchmaking_strategy:'coverage'`, and lists eligible competitor slugs+versions (resolved to ids during seed). `scripts/validate.ts` runs Zod schema + integrity checks across `cases/` and `competitors/` (no network). `scripts/smoke.ts` runs `ensureResponse` for 2–3 competitors on a sample case and flags empty/identical outputs (needs OpenRouter key). CI workflow runs `npm run cases:validate` on PRs.

- [ ] **Step 1 (test):** `importConfig` creates a suite, suite_version (frozen), and default campaign; `seed.ts` end-to-end on fixtures yields a campaign with `eligible_competitor_version_ids` populated and importable cases. Re-running seed is idempotent.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS. Run `npm run cases:validate` → clean.
- [ ] **Step 5:** Commit `feat: suite/campaign config + seed orchestrator + validate/smoke + CI`.

---

### Task 14: Battle service + `GET /battle`

**Files:** Create `src/services/battle.ts`, `src/app/api/battle/route.ts`; Test `tests/integration/battle.test.ts`

**Interfaces:**
- Consumes: `selectPair`, `ensureResponse`, `toBlindedOptions`, `requireUser`, `db`.
- Produces:
```ts
export async function getNextBattle(user: SessionUser): Promise<BattlePayload | null>;
// route: 200 BattlePayload | 204 (null) | error envelope
```
`getNextBattle`: load campaign + eligible competitor versions + eligible cases; build `existingPairCounts` + this user's `seenByUser`; `selectPair`; `ensureResponse` for both cells; create `comparison` (response_one/two) + `assignment` with a randomly chosen recorded left/right order and `ui_version='arena-1'`; return `toBlindedOptions`-built payload (task context from the case `evaluator_context_json`). `null` → route returns 204.

- [ ] **Step 1 (test):** seed minimal data (1 case, 2 competitors with fake responses via injected provider); `getNextBattle` returns a payload with exactly 2 options carrying no provenance keys; an `assignment` row exists with both left/right ids set; calling again for the same user (after recording the pair as seen) returns 204 when exhausted; randomised order observed across seeded rng.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: battle service + GET /battle (blinded)`.

---

### Task 15: Vote service + `POST /vote`

**Files:** Create `src/services/vote.ts`, `src/app/api/vote/route.ts`; Test `tests/integration/vote.test.ts`

**Interfaces:**
```ts
export async function submitVote(user: SessionUser, req: VoteRequest): Promise<VoteResponse>;
```
`submitVote`: load the assignment (must belong to user, status `open`); `effectiveOutcome` (default `both_unacceptable` if rewrite-only); if `rewrite` present create a `responses` row (`origin_type='post_battle_rewrite'`, `parent_response_ids` from forked side(s), `author_user_id=user.id`, content-hashed); `resolvePreferredResponse` using the assignment's recorded order; insert append-only `judgments` (status `valid`, with latencies, `rewrite_response_id`, `rewrite_forked_from`); mark assignment `submitted`. Return `{judgment_id, next:'/battle'}`.

- [ ] **Step 1 (test):** a `left` vote resolves `preferred_response_id` to the left response; a rewrite-only submission defaults outcome to `both_unacceptable`, creates a `post_battle_rewrite` response with parent lineage, and never mutates originals; a second vote on the same (now `submitted`) assignment is rejected; `cannot_assess` stores null preferred.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: vote service + POST /vote (append-only + rewrite)`.

---

### Task 16: Ranking service + `POST /ranking-runs` + `GET /leaderboard`

**Files:** Create `src/services/ranking.ts`, `src/app/api/ranking-runs/route.ts`, `src/app/api/leaderboard/route.ts`; Test `tests/integration/ranking.test.ts`

**Interfaces:**
```ts
export async function createRankingRun(user: SessionUser, opts: { campaignId: string; voteCutoffAt?: string; filters?: unknown; seed?: number }): Promise<{ rankingRunId: string }>;
export async function getLeaderboard(rankingRunId?: string): Promise<LeaderboardRow[]>;
```
`createRankingRun` (role: operator/analyst/admin): load valid judgments up to cutoff, map each to `JudgmentForFit` (resolve competitor versions behind each response, left/right→A/B), `computeRanking(judgments, seed)`, write `ranking_runs` (record `parameters_json.seed`) + `ranking_scores`. `getLeaderboard` joins latest (or given) run's scores to competitor versions → `LeaderboardRow[]`.

- [ ] **Step 1 (test):** seed judgments where competitor X beats Y consistently → X ranks above Y with a higher `display_score`; reproducible across two runs with the same seed (identical scores); `getLeaderboard()` returns rows sorted by rank with CI fields populated.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: ranking run + leaderboard`.

---

### Task 17: Reports services + APIs

**Files:** Create `src/services/reports.ts`, `src/app/api/reports/head-to-head/route.ts`, `src/app/api/reports/segments/route.ts`, `src/app/api/reports/position-bias/route.ts`; Test `tests/integration/reports.test.ts`

**Interfaces:**
```ts
export async function headToHead(rankingRunId?: string): Promise<{ competitors: string[]; matrix: number[][] }>;
export async function segments(rankingRunId: string | undefined, by: 'tag'|'kind'|'difficulty'): Promise<Array<{ segment: string; rows: LeaderboardRow[] }>>;
export async function positionBias(campaignId: string): Promise<Array<{ competitorVersionId: string; topWinRate: number; bottomWinRate: number; n: number }>>;
```

- [ ] **Step 1 (test):** with seeded judgments, head-to-head matrix is square over the competitor set and sums consistently; `segments(by:'kind')` partitions correctly; `positionBias` computes win rate split by whether a response was `left`(top) vs `right`(bottom) using assignment order.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: head-to-head, segments, position-bias reports`.

---

### Task 18: Export + read-only admin data APIs

**Files:** Create `src/services/export.ts`, `src/app/api/export/judgments/route.ts`, `src/app/api/cases/route.ts`, `src/app/api/competitors/route.ts`; Test `tests/integration/export.test.ts`

**Interfaces:**
```ts
export async function exportJudgments(campaignId: string, format: 'csv'|'json'): Promise<string>;
export async function listCases(): Promise<Array<{ case_version_id: string; external_ref: string; kind: string; title: string; tags: string[]; dataset_split: string }>>;
export async function listCompetitorVersions(): Promise<Array<{ competitor_version_id: string; name: string; version: number; model_identifier: string; source_type: string; parent_competitor_version_id: string | null }>>;
```
Export includes assignment order, outcomes, latencies, rewrite refs (analyst/admin role). `listCompetitorVersions` may expose the execution contract (analyst/operator/admin) but these are admin-only routes, never reachable mid-battle.

- [ ] **Step 1 (test):** `exportJudgments(...,'json')` returns valid JSON with one record per judgment incl. `left_response_id`/`right_response_id` and `outcome`; `'csv'` has a header row + N data rows; `listCases`/`listCompetitorVersions` return seeded rows.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: judgment export + read-only admin data APIs`.

---

### Task 19: Rater UI (port the mockup, wire live)

**Files:** Create `src/ui/tokens.ts`, `src/app/(rater)/battle/page.tsx`, `src/app/(rater)/battle/BattleClient.tsx`; Test `tests/e2e/rater.spec.ts` (smoke only here; full loop in Task 22)

**Interfaces:**
- Consumes: `GET /battle`, `POST /vote`, contract types.
- Produces: the rater route rendering a `BattlePayload`, keyboard-first (`A/B/T`, `R`→`A/B/S`), posting votes, advancing on 201, showing 204 "all done", session counter, "Blinded · randomised" marker.

- [ ] **Step 1:** Port `inputs/arena-rater-view.jsx` into `BattleClient.tsx`: keep the design tokens (`src/ui/tokens.ts`) and layout verbatim; replace the mocked `BATTLES`/`Math.random` top-roll with data from `GET /battle` (order already server-fixed → render `options[0]` top, `options[1]` bottom; do NOT re-roll client-side). Wire vote/rewrite to `POST /vote` and refetch on success.
- [ ] **Step 2:** Server component `page.tsx` calls `requireUser()` (redirects unauth via AuthKit).
- [ ] **Step 3 (test):** Playwright smoke against a seeded dev server with auth stubbed via test env: `/battle` shows two options and the blinded marker; pressing `A` posts a vote and advances. (If WorkOS can't run in CI, gate this spec behind an env flag; the authoritative loop test is Task 22 run locally.)
- [ ] **Step 4:** Commit `feat: rater battle UI wired to live API`.

---

### Task 20: Admin UI

**Files:** Create `src/app/(admin)/layout.tsx`, `src/app/(admin)/leaderboard/page.tsx`, `src/app/(admin)/reports/page.tsx`, `src/app/(admin)/generate/page.tsx`, `src/app/(admin)/cases/page.tsx`, `src/app/(admin)/competitors/page.tsx`; Test `tests/e2e/admin.spec.ts` (smoke)

**Interfaces:** Consumes the admin/report/export/ranking APIs + `requireRole`.

- [ ] **Step 1:** Build pages reusing `src/ui/tokens.ts`: leaderboard table (display score, rank range, CI, counts, tie/unacceptable rates); reports page with the three views; a "Generate missing responses" trigger + a "Run ranking" button; read-only cases and competitor-versions browsers (competitors showing model_identifier + lineage). Each admin page server-side `requireRole('operator'|'analyst'|'admin')` as appropriate.
- [ ] **Step 2 (test):** Playwright smoke: leaderboard renders rows after a seeded ranking run; "Run ranking" triggers a run and the table updates.
- [ ] **Step 3:** Commit `feat: admin leaderboard/reports/generate/browsers`.

---

## Wave 2 — Integration

### Task 21: `POST /generate` + `GET /generate/status` (batch trigger)

**Files:** Create `src/services/generate-batch.ts`, `src/app/api/generate/route.ts`, `src/app/api/generate/status/route.ts`; Test `tests/integration/generate-batch.test.ts`

**Interfaces:**
```ts
export async function enqueueGeneration(user: SessionUser, body: { campaignId: string; caseVersionIds: string[]; competitorVersionIds: string[]; replicates?: number }): Promise<{ enqueued: number; completed: number }>;
export async function generationStatus(campaignId: string): Promise<Record<string, number>>; // counts by status
```
v1: synchronously `ensureResponse` each cell (the queued-row contract is already honored inside the runner). Role: operator/admin.

- [ ] **Step 1 (test):** enqueue for a small matrix → responses exist for every cell; status reports counts; re-run is a no-op (cache).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat: batch generation trigger + status`.

---

### Task 22: End-to-end loop + README + final wiring

**Files:** Create `tests/e2e/loop.spec.ts`, `README.md`; Modify any seams found during integration.

- [ ] **Step 1:** Write `README.md` "first 5 minutes" exactly matching spec §11 (`docker compose up -d` → `db:migrate` → `seed` → `dev`), env setup, and the WorkOS/OpenRouter prerequisites.
- [ ] **Step 2 (test):** `tests/e2e/loop.spec.ts` drives the full loop locally against real Postgres + a stubbed/injected generation provider: seed → open `/battle` → cast 6+ votes across cases (incl. one rewrite) → trigger a ranking run via admin → assert the leaderboard shows ranked competitors with CIs → export judgments and assert row count.
- [ ] **Step 3:** Run `npm run db:migrate && npm run seed && npm run test:e2e`. Expected: full loop PASS.
- [ ] **Step 4:** Run `npm run lint && npm test` (all unit+integration green) and `npm run build` (production build succeeds).
- [ ] **Step 5:** Commit `test: end-to-end arena loop + README`.

---

## Self-Review

**Spec coverage:** loop steps 1–8 → Tasks 11–13 (author/import), 12 (competitors), 10/21 (generate), 14 (battle), 15 (vote+rewrite), 16 (ranking), 16–18 (leaderboard/reports/export). Invariants #1–#9 → schema/guards (Task 2), blinding (Task 5 + Task 14), outcomes (Task 6/15), immutable versions (Tasks 11/12), derived reproducible ranking (Task 8/16). Auth/org gate → Task 9. Git corpus + gates → Tasks 11–13. Rater UX → Task 19. Admin → Task 20. No spec section is unimplemented.

**Placeholder scan:** no "TBD/TODO/handle edge cases"; each task carries concrete interfaces, test assertions, and commands.

**Type consistency:** `BattlePayload`/`BattleOption`/`VoteRequest`/`LeaderboardRow` defined once in Task 3 and consumed by name in Tasks 14–20; `SessionUser`/`AppRole` from Task 9 used in services; `JudgmentForFit`/`RankingScore` from Task 8 used in Task 16; `ensureResponse` signature shared by Tasks 10/14/21; `contentHash` (Task 4) used by Tasks 10/11/12/15.

## Execution note

Tasks 1–3 (Wave 0) are blocking and serial. Tasks 4–13 are mutually independent (pure domain, auth, generation, importers) and parallelizable. Tasks 14–18 depend on Wave 0 + their domain/service deps; 19–20 depend on the API contracts (fixed in Task 3). Task 21–22 integrate. Worktree isolation recommended for parallel tasks that touch sibling files.
