# 04 — Architecture & Deployment

## Topology

```
                 ┌────────────────────────────────────────────┐
   Raters ─────► │  Vercel — Next.js                          │
   (browser)     │  • Rater UI + admin UI                     │
                 │  • Fast API routes: /battle /vote          │
   WorkOS ◄──────┤    /leaderboard /reports                   │
   (auth)        │  • v1: lazy synchronous generation         │
                 └───────────────┬────────────────────────────┘
                                 │ TLS, RDS Proxy
                 ┌───────────────▼────────────────────────────┐
   AWS account   │  Postgres (RDS / Aurora serverless)         │  ◄── source of truth
                 │  + RDS Proxy (connection pooling)           │
                 │  S3 — source blobs, raw provider responses  │
                 │  v2: SQS + Lambda/Fargate generation workers│──► Bedrock (in-region)
                 │  Ranking job — Python (Lambda/Fargate)      │
                 └─────────────────────────────────────────────┘
```

## Component responsibilities

**Vercel (Next.js).** The whole UI and every request/response path: serving blinded battles, capturing votes, reading the leaderboard and reports, and the admin screens. These are short and I/O-bound, which suits Vercel functions — active CPU billing pauses while waiting on the DB or a model, so latency-bound work is cheap.

**Postgres on AWS.** The single source of truth (schema in `02`). Use a small always-on instance with **RDS Proxy** for connection pooling — Vercel's serverless invocations otherwise cause connection storms. We deliberately do *not* chase Aurora scale-to-zero in v1: RDS Proxy keeps a connection open (which blocks pausing) and a paused cluster adds ~15s cold-resume onto the rater path. A `t`-class RDS Postgres or Aurora serverless with a small minimum capacity is the pragmatic floor; idle cost is negligible.

**S3.** All blobs: source-material images/charts, long source text, and raw provider responses. The DB stores hashes + S3 keys, never the bytes. The multimodal `source_blocks` (`{type:'image'|'chart', ...}`) reference S3 objects.

**Generation.** Two phases, *one contract* (`POST /generate` writes `generation_attempts` as `queued` rows):
- **v1:** a synchronous worker (a Vercel function, `maxDuration` raised) processes a queued cell inline and writes the `response`. Generate lazily — produce a (case, competitor) cell the first time a battle needs it, then cache forever (responses are immutable and content-addressed). Single LLM calls fit comfortably within function limits and cost little while waiting.
- **v2:** an AWS worker (Lambda for short jobs, Fargate for long batches) drains an SQS queue and calls **Bedrock in-region** — IAM auth, no API keys in Vercel env, lower latency, no cross-cloud egress. This is the right home for fan-out (full matrix cold-starts, replicates > 1). Because attempts are already queued rows, this is a consumer swap, not a schema change.

**Ranking job.** A Python batch (numpy/scipy or a Bradley–Terry library) that reads `judgments`, fits the model, bootstraps confidence intervals, and writes a `ranking_run` + `ranking_scores`. Manual trigger via `POST /ranking-runs` in v1 (and it's the same job the optimisation phase reuses). Runs on AWS near the DB (Lambda/Fargate) or as a Vercel cron-triggered Python function — either is fine; keep it off the request path.

## Auth

WorkOS in front of the Vercel app (you already have integration). On each request: validate the session, confirm `org_id` is on the allowlist server-side, resolve/create the local `users` row from the WorkOS subject, and attach `app_role`. No separate password or recovery flow. Role checks gate admin/analyst routes.

## Network path (kept simple, per decision)

DB in a private subnet, reached via RDS Proxy over TLS with strong credentials; the app is org-gated by WorkOS. We are **not** standing up Secure Compute / static-IP SG-locking for v1 — the data is internal and the app is authenticated, so TLS + credentials + the org gate is the accepted posture. Revisit only if a future data class demands zero public reachability (in which case the data-touching API moves onto AWS behind the VPC).

## Environments, secrets, deploy

- **Environments:** `preview` (per-branch on Vercel + a dev DB, which *can* use Aurora scale-to-zero), `production`.
- **Secrets:** WorkOS keys and DB credentials in Vercel env vars; Bedrock access via IAM role on the AWS workers (v2) — no long-lived model keys in the web tier.
- **Migrations:** a migrations tool (e.g. Drizzle/Prisma/Atlas) checked into the repo; the v1 schema in `02` is the first migration. Immutability triggers (or app-level guards) ship with it.
- **CI/CD:** Vercel Git integration for the app; the ranking job and (v2) generation workers deploy to AWS separately (CDK/Terraform).

## v1 cut vs end-state

| Concern | v1 | Later |
| --- | --- | --- |
| Generation | Lazy synchronous on Vercel, 1 replicate | SQS + AWS workers on Bedrock, N replicates |
| Matchmaking | Coverage + random within constraints | Adaptive (uncertainty/similar-rating), balanced side scheduling |
| Ranking | Manual Bradley–Terry run | Scheduled runs; optimisation-run workflow |
| Human input | Vote + rewrite | Independent baseline authoring, reason tags |
| DB | Small always-on + RDS Proxy | Same; scale as load grows |
| Analyst access | CSV/JSON export | Full per-competitor prompt/provenance view |

The four things v1 must get right even under time pressure, because they are expensive to retrofit: attempts as queued rows (async-ready), responses immutable and content-addressed, ratings strictly derived, and the DB private from day one.
