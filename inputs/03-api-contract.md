# 03 — API Contract

REST over HTTPS, JSON bodies. All routes require an authenticated WorkOS session; the server validates `org_id` against the allowlist and resolves a local `users` row on every request. Roles gate the admin and analyst routes (see PRD §9).

Conventions: IDs are UUIDs; timestamps ISO-8601 UTC; errors return `{ "error": { "code", "message", "details?" } }` with appropriate HTTP status. Idempotency: mutating generation/vote endpoints accept an `Idempotency-Key` header.

## Blinding rule at the boundary

`GET /battle` and any rater-facing route must **never** include `competitor_version_id`, `competitor` name, `origin_type`, author, `generation_attempt`, prompt, model, latency, or length on a response object. Responses are referenced only by their `response_id` and a presentation label (`A`/`B`). The mapping from label to response/competitor lives server-side on the `assignment`. Per-competitor prompts and provenance are available only on analyst routes, which are never reachable mid-battle.

---

## Rater loop

### `GET /battle`
Returns the next blinded battle for the current user, creating the `comparison` (if matchmaking selects a fresh pair) and the `assignment` (with randomised, recorded order).

**200**
```json
{
  "assignment_id": "uuid",
  "ui_version": "arena-1",
  "task": {
    "case_external_ref": "0142",
    "kind": "compression",
    "title": "Compress this diligence memo to its decision-relevant core",
    "guidance": "Reward the version that helps a partner reach a call, not the one that recaps the most.",
    "output_spec": {
      "target": "Investment committee one-pager",
      "parts": [
        { "type": "title",   "label": "Headline", "note": "one line" },
        { "type": "bullets", "label": "Key supporting points", "note": "3 bullets" }
      ]
    },
    "source_blocks": [
      { "type": "text", "text": "UK facilities-management vertical SaaS. Priced at 8.5x ARR; CFO seat vacant." },
      { "type": "bullets", "items": ["£14m ARR, growing 31% YoY", "Retention: 91% gross, 108% net …"] }
    ]
  },
  "options": [
    { "label": "A", "response_id": "uuid", "body_text": "…" },
    { "label": "B", "response_id": "uuid", "body_text": "…" }
  ]
}
```
`options` is already ordered for display (A = top, B = bottom) and the order is persisted on the assignment. No field on an option reveals provenance.

**204** — no battle available (matchmaking exhausted / coverage complete).

### `POST /vote`
Submits the judgment for one assignment. Append-only.

**Request**
```json
{
  "assignment_id": "uuid",
  "outcome": "left | right | tie | both_unacceptable | cannot_assess",
  "reason_tags": ["compression", "what_matters"],          // optional, v1.1
  "free_text_comment": "…",                                 // optional
  "time_to_first_action_ms": 1840,
  "total_duration_ms": 9120,
  "rewrite": {                                              // optional
    "forked_from": "a | b | scratch",
    "body_text": "…"
  }
}
```
Server behaviour:
- Resolves `outcome` (`left`/`right`) plus the assignment's order into `preferred_response_id`.
- If `rewrite` present: creates a `responses` row (`origin_type = post_battle_rewrite`, `parent_response_ids` = the forked source(s), `author_user_id` = current user), sets `judgment.rewrite_response_id` and `rewrite_forked_from`. If no plain preference was given, `outcome` defaults to `both_unacceptable`. `rewrite_forked_from` is recorded as a secondary signal only.
- Marks the assignment `submitted`.

**201** `{ "judgment_id": "uuid", "next": "/battle" }`

### `POST /baseline`  *(phased — v1.1)*
Independent human-authoring workflow: the user receives a case **without** seeing any generated candidates and submits an answer.
```json
{ "case_version_id": "uuid", "body_text": "…", "authoring_protocol": { "time_allowed_s": 600, "tools_allowed": false, "expertise_band": "senior" }, "reuse_permission": true }
```
Creates a `responses` row with `origin_type = independent_human_baseline`. It enters the normal battle pool, blinded.

---

## Admin & operations (role-gated)

### Cases
- `POST /cases` — create a case version (kind, title, guidance, output_spec, runner_input, evaluator_context, source_blocks, hidden_metadata, tags, dataset_split, sampling_weight). Computes `content_hash`. Returns the `case_version_id`.
- `GET /cases?suite_version_id=…` — list (admin view includes hidden metadata).
- Source blobs: `POST /uploads` returns a presigned S3 URL; the returned key is referenced in `source_blocks`.

### Competitors
- `POST /competitors` — create a competitor (logical) — `{ name, competitor_type }`.
- `POST /competitors/{id}/versions` — create an **immutable** version `{ model_provider, model_identifier, prompt_bundle, model_parameters, source_type, parent_competitor_version_id? }`. Computes `content_hash`; rejects edits to existing versions.

### Generation
- `POST /generate` — enqueue generation for a set of (case_version, competitor_version[, replicate]) cells.
  ```json
  { "campaign_id": "uuid", "case_version_ids": ["…"], "competitor_version_ids": ["…"], "replicates": 1 }
  ```
  Creates `generation_attempts` rows with `status = queued`. In v1 a synchronous worker processes them inline and writes `responses`; in v2 an AWS worker drains the queue. **Same contract either way.**
- `GET /generate/status?campaign_id=…` — counts by status; surfaces failures.

### Ranking & reports
- `POST /ranking-runs` — trigger a Bradley–Terry recompute `{ campaign_id, vote_cutoff_at?, filters? }`. Returns `ranking_run_id` when complete.
- `GET /leaderboard?ranking_run_id=…` (defaults to latest) — array of `ranking_scores` joined to competitor version (Arena rating, rank range, CI, counts, tie/unacceptable rates).
- `GET /reports/head-to-head?ranking_run_id=…` — win matrix between competitor versions.
- `GET /reports/segments?ranking_run_id=…&by=tag|kind|difficulty` — performance by segment.
- `GET /reports/position-bias?campaign_id=…` — win rate by presentation position (top vs bottom).
- `GET /export/judgments?campaign_id=…&format=csv|json` — raw judgments with assignment order, outcomes, latencies, rewrite refs (analyst role).

### Governance
- `POST /judgments/{id}/invalidate` — audited status change `{ reason }` (admin). Never deletes.

---

## Notes for implementers

- `GET /battle` and `POST /vote` are the only hot-path endpoints; keep them fast and on Vercel.
- Matchmaking selection happens inside `GET /battle`: pick a case, pick two eligible competitor versions with responses (generate lazily if missing in v1), enforce the connected-graph / no-repeat-pair constraints, create the comparison + assignment with a random recorded order.
- Treat `rewrite_forked_from` purely as analytics; the ranking job consumes `outcome`/`preferred_response_id` only.
