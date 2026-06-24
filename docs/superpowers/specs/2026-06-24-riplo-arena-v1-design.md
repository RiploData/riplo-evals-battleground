# Riplo Arena v1 — Implementation Design (local-first)

**Date:** 2026-06-24
**Status:** Approved for planning
**Source of truth for requirements:** `inputs/` (README, 01-prd, 02-data-model, 03-api-contract, 04-architecture, 05-task-population, arena-rater-view.jsx)

This spec is the *implementation design* layered on top of the handover pack. The pack defines **what** Arena is and its invariants; this document pins the **how** for a runnable local-first v1 and the decisions the pack deliberately left open.

---

## 1. Goal of this pass

Produce a **running, working v1 of the full evaluation loop locally**, structured so the documented production deployment (Vercel + AWS + WorkOS + S3 + async Bedrock workers) is a configuration/consumer swap, not a rewrite.

The loop, end to end (README §"the loop"):

1. Author cases (in git) → import to Postgres.
2. Register immutable competitor versions.
3. Generate responses with full provenance (lazy, synchronous, via OpenRouter).
4. Serve blinded, randomised A/B battles.
5. Capture outcome (A / B / tie / both-unacceptable / skip) + optional rewrite.
6. Compute Bradley–Terry Arena rating with bootstrap confidence intervals.
7. Show leaderboard + head-to-head + segment + position-bias views.
8. Export judgments.

Everything immutable and append-only; rankings rebuild from source.

---

## 2. Decisions (locked)

| Area | Decision | Rationale |
| --- | --- | --- |
| App | Next.js (App Router) + TypeScript | Matches `04` Vercel target; one stack for UI + API. |
| DB | Postgres, local via Docker Compose | `02` is Postgres; Compose makes "up in one command" real. |
| Schema/migrations | **Drizzle** | TS-native; `02` DDL → migration 0001 verbatim incl. phased columns + immutability guards. |
| Auth | **Real WorkOS (AuthKit)**, gated to a single org via server-side allowlist | Reuse existing WorkOS setup; `04` §Auth. New org id supplied via env. |
| Generation | **Live, multi-provider via OpenRouter** (one key) | `model_identifier` routes Anthropic/OpenAI. Lazy synchronous, written through the `generation_attempts` queued-row contract. |
| Ranking | **TypeScript** Bradley–Terry + bootstrap CIs | Single toolchain; still strictly derived from `judgments`. Deliberate divergence from the pack's Python suggestion. |
| Case corpus | **Git-authored + idempotent importer** (not an admin authoring UI) | `05` recommendation: version control, PR review, diffable synthetic-data provenance. |
| Competitor setups | **Config-as-code, git-authored + idempotent importer** (not hand-inserted into the DB) | Same provenance/immutability/PR-review benefits for execution contracts; editing a prompt = a diffable file change → new immutable `competitor_version`. |
| Suite + default campaign | **Config files, ingested on seed** | One default suite + campaign defined in `config/`; keeps "ratings never silently compared across suite versions" auditable in git. |
| Sensitivity | Column retained, **no gating logic** | Per user: author crisp/clear synthetic cases instead. |
| Scope | **Full v1 loop** | Per user. |
| Testing | Vitest (unit + integration) + Playwright (e2e loop) | Pure-domain logic unit-tested; loop verified end to end. |
| Blobs/S3 | Storage abstraction with **local-filesystem driver**; S3 driver later | v1 cases are text/bullets; keep the seam. |

---

## 3. Architecture & module boundaries

The central design principle: **`domain/` is pure and independently testable**; **`services/` orchestrates DB + domain**; **`app/api/` is a thin HTTP shell** that enforces auth and the blinding rule.

```
src/
  db/
    schema/            # drizzle schema, one file per domain group (identity, suites-cases,
                       #   competitors, campaigns, generation-responses, battles, ranking)
    migrations/        # 0001 = the 02 DDL incl. phased cols + immutability triggers/guards
    client.ts          # pooled pg client (RDS Proxy-friendly: bounded pool)
  domain/              # PURE — no DB, no Next, no network. Heavily unit-tested.
    content-hash.ts    # canonical hash of execution contracts / case content / responses
    matchmaking.ts     # coverage + balance-across-tags + no-repeat-pair selection
    blinding.ts        # SOLE constructor of rater-facing response objects (invariant #3)
    outcomes.ts        # outcome + presentation order -> preferred_response_id
    ranking/
      bradley-terry.ts # MLE logistic fit; ties = 0.5/0.5; exclude cannot_assess
      bootstrap.ts     # resample judgments -> confidence intervals
      run.ts           # orchestrate scores: ranks, rank ranges, tie/unacceptable rates
  services/            # DB-touching use cases (transactions live here)
    cases.ts           # read/list case_versions (authoring is the importer)
    competitors.ts     # read/list competitors + competitor_versions (setup is the importer)
    campaigns.ts       # read default campaign (defined in config/, ingested on seed)
    generation/
      runner.ts        # execute(case_version, competitor_version, replicate): attempt -> response
      providers/openrouter.ts
    battle.ts          # next-battle: matchmaking + lazy-generate + comparison + assignment
    vote.ts            # submit judgment (+ optional rewrite), append-only
    ranking.ts         # trigger a ranking_run over a judgment set
    reports.ts         # head-to-head, segments, position-bias
    export.ts          # judgments -> csv/json
  auth/
    workos.ts          # session validation, org allowlist, user upsert, app_role attach
    rbac.ts            # role gates: evaluator|suite_editor|operator|analyst|admin
  app/
    (rater)/battle/    # ported from arena-rater-view.jsx, wired to live /battle + /vote
    (admin)/           # competitors, campaign, generate, leaderboard, reports, cases (read-only)
    api/               # battle, vote, cases, competitors, generate, ranking-runs,
                       #   leaderboard, reports/*, export, uploads
  ui/                  # design tokens (from mockup) + shared components
cases/                 # GIT-AUTHORED CASE CORPUS (see §6)
competitors/           # GIT-AUTHORED COMPETITOR SETUPS (config-as-code, see §6)
config/                # default suite + campaign definitions (ingested on seed, see §6)
scripts/               # validate, import (cases+competitors+config), smoke, seed (runs all)
tests/
  domain/              # unit (pure)
  integration/         # api + real pg (docker)
  e2e/                 # the full loop via Playwright
```

For each unit we can answer: **what it does, how you use it, what it depends on.** `domain/*` depends on nothing; `services/*` depends on `db` + `domain`; `app/api/*` depends on `services` + `auth`; UI depends only on the API shapes in `03`.

---

## 4. The blinding boundary (invariant #3 — treated as acceptance criterion)

`blinding.ts` is the **only** module that turns a stored `response` into a rater-facing object. It accepts full rows and returns exactly `{ label: 'A'|'B', response_id, body_text }` (+ `body_json` when the output spec demands structure) — and is structurally incapable of emitting competitor identity, model, prompt, origin_type, author, generation_attempt, latency, or length. The label→response/competitor mapping lives server-side on the `assignment`.

`GET /battle` and `POST /vote` construct rater payloads *only* through this module. A test asserts no other serialization path leaks provenance fields; `length_chars`/`length_tokens` are never sent to a rater.

---

## 5. The hot path

**`GET /battle`** (fast, Vercel-suited):
1. Resolve user + role (auth).
2. Matchmaking (`domain/matchmaking.ts`): pick an eligible case; pick two eligible competitor versions honouring coverage / connected-graph / balance-across-tags / no-repeat-pair-for-this-rater constraints.
3. Ensure responses exist for both cells — **lazily generate** any missing cell via `generation/runner.ts` (cache forever; responses are immutable + content-addressed).
4. Create `comparison` (storage labels one/two) + `assignment` with a **randomised, server-recorded** left/right order and `ui_version`.
5. Return the blinded payload (§4), `options` already ordered A=top/B=bottom.
6. `204` when matchmaking is exhausted.

**`POST /vote`** (append-only):
1. Resolve `outcome` (`left`/`right`) + the assignment's recorded order → `preferred_response_id` (`domain/outcomes.ts`).
2. If `rewrite` present: create a `responses` row (`origin_type=post_battle_rewrite`, `parent_response_ids`=forked source(s), `author_user_id`=current user); set `judgment.rewrite_response_id` + `rewrite_forked_from` (secondary signal only). If no plain outcome was given, default `outcome=both_unacceptable`.
3. Insert the `judgment` (status `valid`); mark the `assignment` `submitted`. Capture `time_to_first_action_ms` + `total_duration_ms`.
4. Return `{ judgment_id, next: "/battle" }`.

`rewrite_forked_from` is **analytics only**; the ranking job consumes `outcome`/`preferred_response_id` exclusively.

---

## 6. Git-authored corpus + importer — cases, competitors, config (`05`)

Everything that defines *what gets evaluated and how* is config-as-code in git, ingested by idempotent, content-addressed importers. The DB remains the source of truth for **runtime and ratings**; git is the source of truth for **authoring**. One command — `npm run seed` — runs all importers in dependency order (suite → competitors → cases → campaign).

### 6a. Case corpus

**Authoring tree** (path-encoded taxonomy; `domain`+`kind` → tags + `case_versions.kind`):

```
cases/<domain>/<kind>/<case>/[<scenario>/]case.json
                                          source/   # optional larger blobs -> storage driver
```

**`case.json`** is the authoring form of a `case_version` (shape per `05` §"Case file format"): `kind`, `title`, `guidance`, `output_spec`, `runner_input`, `source_blocks` (text/bullets in v1), `hidden_metadata`, `tags`, `dataset_split` (dev/validation/holdout), optional `rubric_notes`. A **Zod** schema is the single definition reused by validation, the importer, and CI.

**Importer** (`scripts/cases:import`, idempotent + content-addressed):
- `external_ref` derived from the path; one `cases` row per logical case.
- Compute `content_hash` over canonicalised `case.json` (+ resolved source). Unchanged → no-op. Changed → **new `case_version`** (never mutate). This preserves "ratings never rest on a case that changed underneath them."
- Build `evaluator_context_json`, `runner_input_json`, `source_blocks_json`, `hidden_metadata_json` from the authoring file.

**Validation gates** (mirroring `05` §pipeline):
1. **Schema** (`cases:validate`, no key) — `case.json` conforms; source refs resolve; `dataset_split` valid.
2. **Integrity** (`cases:validate`) — has source; `output_spec` well-formed; task answerable from source.
3. **Generation smoke** (`cases:smoke`, needs OpenRouter key) — run 2–3 competitors; flag empty/malformed/trivially-identical outputs (discrimination pre-check).
4. **Human review** — small PRs (CI runs 1–2 automatically).

A GitHub Actions workflow runs schema+integrity on PRs (no key needed). Smoke is opt-in.

**First-pass content:** hand-author a representative handful of Stream-A synthetic cases (2 domains × 2–3 kinds, all `dataset_split=dev`) so the loop is real after import. Validation/holdout cases are held out of routine battling.

### 6b. Competitor setups (config-as-code)

**Authoring tree:**

```
competitors/<competitor-slug>/
  competitor.json          # logical: { name, competitor_type }
  versions/
    v1.json                # the execution contract (see below)
    v2.json                # an edit is a NEW file, not a mutation
  prompts/                 # optional: prompt bodies referenced by versions, for readability/diffs
    concise-system.md
```

A **version file** is the authoring form of a `competitor_version`: `model_provider`, `model_identifier` (the OpenRouter route), `prompt_bundle` (system prompt + skill refs; may inline `system_prompt` or reference `prompts/*.md` via `system_prompt_ref`), `model_parameters` (temperature, top_p, max_tokens…), `source_type`, and optional `parent` (`{slug, version}`) for lineage. A **Zod** schema defines it once, reused by validate/import/CI.

**Importer** (idempotent + content-addressed, mirrors the case importer):
- Upsert the logical `competitors` row by slug.
- For each version file, compute `content_hash` over the canonicalised execution contract (with referenced prompt bodies resolved). A `competitor_version` with that hash already present → **no-op**. New hash → insert a **new immutable version** with the next `version` number and a resolved `parent_competitor_version_id`. Existing versions are **never edited** (invariant #4).
- Validation gate: schema conformance + referenced prompt files resolve + parent (if any) exists.

This is the *only* supported path to register competitors in v1; the admin UI reads them.

### 6c. Suite + default campaign

`config/suites/<suite>.json` defines a suite + its `suite_version` (`rubric_json`, `weighting_json`); `config/campaign.json` defines the single default campaign (suite version ref, case selector, eligible competitor versions, `replicates=1`, `matchmaking_strategy=coverage`). Cases declare their suite (via path or `case.json`). Ingested on seed; the campaign always records its suite version so ratings are never silently compared across suite versions (invariant #8).

---

## 7. Generation (OpenRouter)

`runner.execute(caseVersion, competitorVersion, replicate)`:
- Insert `generation_attempts` (`queued`→`running`), rendering the exact request from `runner_input` + the competitor's `prompt_bundle` + `model_parameters`.
- Call OpenRouter (`providers/openrouter.ts`) keyed by `model_identifier`; capture provider request id, tokens, cost, latency, finish_reason, errors, `runner_code_version`.
- On success: write an immutable, content-hashed `response` (`origin_type=model_generation`) + compute `length_chars`/`length_tokens` (bias analysis only). Mark attempt `succeeded`.
- Idempotent per `(case_version, competitor_version, replicate)` cell.

The queued-row contract means the v2 SQS+Bedrock worker is a consumer swap, not a schema change.

---

## 8. Ranking (TypeScript, derived — invariant #7)

`domain/ranking/*` is pure; `services/ranking.ts` wires it to the DB.
- Read valid judgments for the campaign up to `vote_cutoff_at`.
- Bradley–Terry logistic MLE: tie = half-win each side; **exclude** `cannot_assess`; **exclude** `both_unacceptable` from the preference fit but count it toward each competitor's absolute-acceptability rate.
- Bootstrap resampling → confidence intervals; derive rank + rank range.
- Optional Elo-like display transform — labelled **Arena rating**, never "Elo".
- Write `ranking_run` + `ranking_scores` (raw + display score, rank/range, CI, judgment/case counts, tie/unacceptable rates).

Reproducible from `judgments` alone: wipe `ranking_*` and re-run → identical (deterministic seed for the bootstrap, recorded in `parameters_json`).

---

## 9. Reports & export

- **Leaderboard** — `ranking_scores` joined to competitor version (Arena rating, rank range, CI, counts, tie/unacceptable rates).
- **Head-to-head** — pairwise win matrix.
- **Segments** — performance by tag / kind / difficulty.
- **Position-bias** — win rate when shown top vs bottom (our own fairness check).
- **Export** — judgments to CSV/JSON with assignment order, outcomes, latencies, rewrite refs (analyst role).

A single number is never the only view.

---

## 10. UI

**Rater view** — faithful port of `arena-rater-view.jsx` (tokens preserved), keyboard-first (`A`/`B`/`T`/`R`→`A`/`B`/`S`), wired to live `GET /battle` + `POST /vote`. "Blinded · randomised" marker; session counter; output length never shown.

**Admin** — minimal but complete: a "generate" trigger + status, a "run ranking" button, leaderboard + the three report views, judgment export, and **read-only browsers** for cases, competitor versions (showing the execution contract + lineage), and the default campaign (authoring for all three is git/config). Reason tags are a v1.1 post-choice multi-select — schema-ready, not built now.

---

## 11. Local dev experience

```
cp .env.example .env   # DATABASE_URL, WORKOS_* + ALLOWED_ORG_ID, OPENROUTER_API_KEY
docker compose up -d   # postgres
npm run db:migrate
npm run seed           # ingests config/ (suite + campaign), competitors/, cases/ -> DB (idempotent)
npm run dev
```

`.env.example` documents every variable. README "first 5 minutes" walks the loop: open `/battle`, cast votes, run a ranking, view the leaderboard. WorkOS keys + `ALLOWED_ORG_ID` and an `OPENROUTER_API_KEY` are required to run; the README states this plainly.

---

## 12. Invariants as acceptance criteria (from README §non-negotiable)

1. Every response traces to an exact case version **and** competitor version.
2. Every judgment records the exact left/right presentation order.
3. No response provenance is ever exposed during a blinded battle (enforced by §4 + test).
4. Changing any execution config creates a **new** competitor version; existing versions never edited.
5. Responses and judgments are never destructively overwritten (append-only; status enums).
6. A rewrite is a new response artifact (`post_battle_rewrite`), distinct from an independent baseline.
7. Rankings rebuild from source judgments alone (deterministic).
8. Ratings from different suite versions are never silently compared (campaign carries suite_version).
9. Tie, both-unacceptable, and cannot-assess remain distinct signals throughout.

---

## 13. Testing strategy

- **Unit (Vitest):** all of `domain/*` — matchmaking constraints, blinding leak-proofing, outcome resolution, Bradley–Terry correctness (known fixtures), bootstrap determinism, content-hash stability.
- **Integration (Vitest + docker pg):** importer idempotency + new-version-on-edit; competitor-version immutability; generation attempt→response; `/battle`+`/vote` against a real DB incl. blinding assertions and order recording; ranking reproducibility.
- **E2E (Playwright):** author/import → seed competitors → generate → battle → vote (+ rewrite) → ranking run → leaderboard → export. The acceptance demo.

---

## 14. Build plan — the fleet

After this spec → an implementation plan (writing-plans) → parallel agents in **git-worktree isolation**, in waves:

- **Wave 0 (foundation, blocking):** repo scaffold (Next.js + TS + tooling + Docker Compose), Drizzle schema/migrations (`02` incl. phased cols + immutability guards), pooled client, shared TS types + the `03` API contract types, `.env.example`. Everything keys off this.
- **Wave 1 (parallel):**
  - (a) `domain/*` pure logic + unit tests (matchmaking, blinding, outcomes, ranking, content-hash).
  - (b) `auth/*` — WorkOS AuthKit + org allowlist + rbac.
  - (c) `generation/*` — OpenRouter runner + provider.
  - (d) battle + vote services & API (hot path).
  - (e) admin services & API — generate, ranking, reports, export, + read-only cases/competitors/campaign.
  - (f) git corpus: Zod schemas + importers (cases, competitors, suite/campaign config) + validation/smoke scripts + CI + first authored cases & competitor setups + `npm run seed`.
  - (g) rater UI (port mockup, wire live).
  - (h) admin UI (competitors, campaign, generate, leaderboard, reports, case browser).
- **Wave 2 (integration):** wire, run integration + e2e, fix seams, deliver a running app + a short deploy-config checklist.

Dependency spine: Wave 0 → (a)(b)(c)(f) independent; (d) needs (a)+schema; (e) needs (a)+schema; (g) needs the `/battle`+`/vote` contract (fixed in `03`); (h) needs admin contract (fixed in `03`). Contracts being pinned in `03` is what lets UI and services build against each other in parallel.

---

## 15. Out of scope (v1)

Async generation workers (SQS/Bedrock); replicates > 1 by default; independent human-baseline authoring (`POST /baseline`); diagnostic reason tags; adaptive matchmaking; balanced side-placement scheduling; the manual DS optimisation-run workflow; automated graders; per-rater weighting; multi-org RBAC; in-app case/competitor authoring UI (authoring is git/config); image/chart source blocks; the curation-loop analytics (`05` Phase 2). Schema columns for these are present (cheap now, costly to retrofit); the behaviour is deferred.
