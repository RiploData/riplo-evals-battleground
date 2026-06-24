# Riplo Arena

A blinded preference arena and prompt-experimentation platform. Authorised raters compare two anonymised outputs for the same task and pick the better one (or rewrite it). Those judgments accumulate into a durable asset, from which we derive Bradley–Terry rankings of competing prompt/model configurations.

**Core commitment:** comparisons and responses are the asset; ratings are a recomputable projection over them. Responses and human judgments are immutable and append-only; rankings rebuild from source.

See `inputs/` for the full product/engineering pack and `docs/superpowers/` for the design spec and implementation plan.

---

## First 5 minutes (local)

Prerequisites: Node 20+, Docker, and (optionally) WorkOS + Anthropic/OpenAI credentials.

```bash
# 1. Install + configure
npm install
cp .env.example .env          # then edit .env (see below)

# 2. Start Postgres (host port 5544 to avoid clashing with other local Postgres)
docker compose up -d

# 3. Create the schema + immutability guards
npm run db:migrate

# 4. Ingest the git-authored corpus (suite + campaign + competitors + cases) into Postgres
npm run seed

# 5. (Optional, no API keys needed) generate placeholder responses so the
#    battle loop is immediately clickable. Skip this once you set ANTHROPIC_API_KEY
#    or OPENAI_API_KEY — real responses are then generated lazily on first battle.
npm run seed:dev-responses

# 6. Run
npm run dev                   # http://localhost:3000  (rater view at /battle, admin at /leaderboard)
```

### Configuring `.env`

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres (matches `docker-compose.yml`, host port **5544**). |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `ALLOWED_ORG_ID` | Real WorkOS auth, gated to one organisation. Populate for production-faithful auth. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Live generation via direct Anthropic + OpenAI drivers (dispatched by `model_provider` on the competitor version). |
| `NEXT_PUBLIC_ARENA_DEV_AUTH`, `ARENA_DEV_AUTH_EMAIL`, `ARENA_DEV_AUTH_ROLE` | **Local-only** auth bypass — click through the app and run the e2e without an interactive WorkOS login. Never active in production. |

**Two ways to run locally:**

- **With WorkOS** (production-faithful): set the `WORKOS_*` + `ALLOWED_ORG_ID` values and leave the `ARENA_DEV_AUTH_*` / `NEXT_PUBLIC_ARENA_DEV_AUTH` blank. You sign in through WorkOS; only members of `ALLOWED_ORG_ID` are admitted.
- **Without WorkOS** (fastest first run): set `NEXT_PUBLIC_ARENA_DEV_AUTH=1` and `ARENA_DEV_AUTH_EMAIL=you@riplo.ai` (role defaults to `admin`). The app skips WorkOS entirely and resolves you as that user.

---

## The loop

1. **Author** cases (`cases/`) and competitor setups (`competitors/`) as git config-as-code; define the suite + default campaign in `config/`.
2. **Seed** (`npm run seed`) — idempotent, content-addressed importers materialise them into Postgres. Editing a case or prompt creates a *new immutable version*; prior versions are never mutated.
3. **Generate** responses (lazily on first battle via native Anthropic/OpenAI drivers, or `npm run seed:dev-responses` for placeholders).
4. **Battle** — `/battle` serves a blinded, randomised A/B pairing. No provenance (model, prompt, author, length) ever reaches the rater; the label→response mapping lives server-side on the assignment.
5. **Judge** — A / B / tie / both-unacceptable / cannot-assess, with an optional rewrite (a new `post_battle_rewrite` response that can re-enter battles).
6. **Rank** — `POST /api/ranking-runs` fits Bradley–Terry over valid judgments with bootstrap confidence intervals, written as a versioned `ranking_run`.
7. **Read** — leaderboard, head-to-head, segment, and position-bias reports; export judgments as CSV/JSON.

---

## Project layout

```
src/
  db/        Drizzle schema (= inputs/02 DDL incl. phased cols), migrations, immutability guards, pooled client
  domain/    PURE logic (unit-tested): content-hash · matchmaking · blinding · outcomes · ranking (Bradley–Terry + bootstrap)
  services/  DB-touching use cases: cases · competitors · campaigns · generation (Anthropic + OpenAI, dispatched by model_provider) · battle · vote · ranking · reports · export
  auth/      WorkOS AuthKit + org allowlist + RBAC (with a fenced local dev-auth path)
  app/       (rater)/battle (ported mockup) · (admin)/* · api/* (thin HTTP shells; blinding enforced at the boundary)
  ui/        design tokens
cases/         git-authored case corpus (synthetic; → case_versions on seed)
competitors/   git-authored competitor setups (config-as-code; → competitor_versions on seed)
config/        default suite + campaign
scripts/       seed · validate (cases:validate) · smoke (cases:smoke) · seed-dev-responses
tests/         domain (unit) · integration (real Postgres) · e2e (Playwright)
```

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app (Next.js). |
| `npm run build` | Production build. **Requires `WORKOS_*` env vars present** (deployment has them). |
| `npm test` | Vitest — unit + integration. Uses a dedicated `arena_test` database (auto-provisioned), never touching your dev data. |
| `npm run db:migrate` | Apply Drizzle migrations + immutability guards. |
| `npm run seed` | Import suite/campaign/competitors/cases from git into Postgres (idempotent). |
| `npm run seed:dev-responses` | Placeholder responses so the loop runs without API keys (dev/demo only). |
| `npm run cases:validate` | Schema + integrity checks across `cases/` and `competitors/` (no DB/key). Runs in CI. |
| `npm run cases:smoke` | Generation smoke test (needs `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`). |
| `npm run test:e2e` | Playwright end-to-end loop (needs a running dev server with dev-auth). |

---

## Deployment notes (for final config)

The architecture (`inputs/04-architecture.md`) targets Vercel + AWS RDS Postgres (via RDS Proxy) + WorkOS + S3, with generation moving to async Bedrock workers later. This v1 is built so those are configuration/consumer swaps, not rewrites:

- **Database:** point `DATABASE_URL` at managed Postgres; the schema + migrations are the same.
- **Auth:** set the `WORKOS_*` vars and `ALLOWED_ORG_ID`; leave the dev-auth vars unset. The middleware then enforces real WorkOS sessions.
- **Generation:** set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`. Drivers are dispatched by `model_provider` on each competitor version. Attempts are already written as queued rows, so swapping to an async worker is a consumer change.
- **Storage:** `src/corpus/storage.ts` is a local-filesystem driver behind a small interface; add an S3 driver for blob source material.
- **Ranking:** runs in-process (TypeScript). Keep it off the request path (it already is — triggered explicitly).
```
