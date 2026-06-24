# Riplo Arena — v1 Engineering Handover Pack

A blinded preference arena and prompt experimentation platform. Authorised raters compare two anonymised outputs for the same task and pick the better one (or rewrite it). Those judgments accumulate into a durable data asset, from which we derive rankings of competing prompt/model configurations.

The product optimises for subjective qualities — language and tone, compression, and consulting judgment about what matters — where pairwise human comparison is a far better instrument than absolute scoring.

## The pack

| File | What it is |
| --- | --- |
| `README.md` | This file — scope, mental model, build order, invariants |
| `01-prd.md` | Product requirements: goals, terminology, the loop, rater UX, ranking, roles |
| `02-data-model.md` | Postgres schema (DDL), relationships, invariants |
| `03-api-contract.md` | Endpoints and JSON shapes the frontend/backend build against |
| `04-architecture.md` | Where it runs (Vercel + AWS + WorkOS + S3), generation, ranking job, deploy |
| `arena-rater-view.jsx` | Interactive mockup of the rater view (React; reference implementation of the flow) |

## Mental model (memorise this)

```
Response   = execute(case version, competitor version, replicate)
Battle     = compare(response A, response B)   // same case, different competitors
Judgment   = a human's evaluation of one blinded battle presentation
Ranking    = derived aggregation of valid judgments  (recomputable, never the source of truth)
```

The single most important architectural commitment: **comparisons and responses are the asset; ratings are a projection over them.** We store immutable responses and immutable human judgments, and we compute rankings from the complete set whenever asked. We never increment a canonical Elo number in place.

## v1 scope — "the loop"

The first release must make this loop work end to end, for one organisation:

1. Define cases (task + shared runner input + display context + output spec + source material).
2. Register immutable competitor versions (model + prompt + skill + config).
3. Generate responses with full provenance.
4. Serve blinded, randomised A/B battles.
5. Capture outcome (A / B / tie / both-unacceptable / skip), optional rewrite.
6. Compute a Bradley–Terry "Arena rating" with confidence intervals.
7. Show a leaderboard plus head-to-head, segment, and position-bias views.
8. Export judgments.

Everything is immutable and append-only; rankings rebuild from source.

### Phasing

- **v1** — the loop above.
- **v1.1** — independent human-baseline authoring; diagnostic reason tags; balanced side-placement scheduling; adaptive matchmaking.
- **v2** — async generation workers (SQS + Bedrock), replicates > 1 by default; manual DS optimisation-run workflow; analyst view with full per-competitor prompts; automated graders validated against human labels.

## Recommended build order

1. **Schema first** (`02`). It is the expensive thing to change. Stand up Postgres with the full v1 table set, including the columns marked "phased" — they are cheap now, costly to retrofit.
2. **Auth + org gate** (`04`, §Auth). WorkOS session validation, local user record, role column.
3. **Case + competitor admin** (`03`, admin endpoints). Enough to create real content.
4. **Generation** (`04`, §Generation). Lazy synchronous on Vercel for v1; write `generation_attempts` as queued rows so the async swap later is a consumer change.
5. **Battle + vote** (`03`, `01` §Rater UX, mockup). The core loop. Blinding enforced at the API boundary.
6. **Ranking job** (`04`, §Ranking). Python Bradley–Terry batch, manual trigger.
7. **Reports + export** (`03`, reports).

## Non-negotiable invariants (treat as acceptance criteria)

1. Every response traces to an exact case version **and** competitor version.
2. Every judgment records the exact left/right presentation order.
3. No response provenance (model, prompt, author, source, latency) is ever exposed during a blinded battle.
4. Changing any execution configuration creates a **new** competitor version; existing versions are never edited after they generate.
5. Responses and judgments are never destructively overwritten.
6. A rewrite is always a new response artifact, distinct from an independent human baseline.
7. Rankings can be rebuilt from source judgments alone.
8. Ratings from different suite versions are not silently treated as comparable.
9. Tie, both-unacceptable, and cannot-assess remain distinct signals.
