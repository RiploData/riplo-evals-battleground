# Test Deployment Runbook — Vercel + AWS RDS + WorkOS

This is the checklist to stand up a **publicly-reachable test deployment**. Target stack: **Vercel** (app), **AWS RDS/Aurora PostgreSQL** (database), **WorkOS** (auth). The code is already deploy-ready; this is the cloud-account work.

Work top to bottom. Steps 1–2 can happen in parallel; Step 3 (Vercel) needs Step 1's DATABASE_URL; the WorkOS redirect URI in Step 2 needs the Vercel domain from Step 3, so there's one back-and-forth (called out below).

---

## 0. Prerequisites
- The repo is at **github.com/RiploData/riplo-evals-battleground** (`master`).
- You have it cloned locally with `node_modules` installed (you'll run migrations + seed from your laptop in Step 4).
- Accounts: Vercel, AWS, WorkOS.

---

## 1. AWS — PostgreSQL database

Create a small Postgres instance. **RDS PostgreSQL `db.t4g.micro`** is plenty for a test; **Aurora Serverless v2 (PostgreSQL)** works identically (same connection string).

1. RDS → **Create database** → **PostgreSQL** (v16) → template **Free tier** / **Dev/Test**.
2. Instance: `db.t4g.micro`. Storage: 20 GB gp3.
3. Credentials: set a **master username** (e.g. `arena`) and a strong **master password** — save them.
4. Initial database name: **`arena`** (under Additional configuration → Initial database name).
5. **Public access: Yes** *(test only — see the security note below)*.
6. VPC security group → inbound rule: **PostgreSQL / 5432**.
   - Quick test: source `0.0.0.0/0` (anywhere). Acceptable for a test with a strong password + SSL; tighten before real use.
   - Tighter: add your laptop IP **and** allow Vercel egress (Vercel functions use dynamic IPs, so locking to Vercel specifically isn't practical without RDS Proxy + a static-IP setup — fine to defer for a test).
7. Pick a **region** and note it (e.g. `us-east-1`). You'll align Vercel's region to it in Step 3.
8. After it's **Available**, copy the **endpoint** (e.g. `arena.xxxx.us-east-1.rds.amazonaws.com`).

**Your `DATABASE_URL`:**
```
postgres://arena:YOUR_PASSWORD@YOUR-ENDPOINT:5432/arena
```
You will also set **`DATABASE_SSL=true`** everywhere this URL is used (RDS requires TLS).

> **Security note (from `inputs/04-architecture.md`):** the documented production posture is a **private subnet + RDS Proxy**, not public access. Public access here is a deliberate test-only shortcut, protected by a strong password + TLS + the WorkOS org gate. Don't put sensitive data in this test DB; harden (private subnet + RDS Proxy) before production.

---

## 2. WorkOS — production auth

In the WorkOS dashboard:

1. Select (or create) the **environment** you'll use for the test (Staging or Production).
2. **API keys** → copy:
   - `WORKOS_API_KEY` (starts `sk_...`)
   - `WORKOS_CLIENT_ID` (starts `client_...`)
3. **Organizations** → create (or pick) the org that should have access → copy its **Organization ID** → this is **`ALLOWED_ORG_ID`**. Only members of this org will be admitted.
4. **Roles** → ensure the org has roles **`admin`** and **`member`** (these are WorkOS defaults). Assign **your own user the `admin` role** in that org, so you can reach the admin pages. (Everyone else defaults to `member` = rater.)
5. Generate a cookie password: `openssl rand -base64 32` → this is **`WORKOS_COOKIE_PASSWORD`** (must be ≥32 chars).
6. **Redirect URI** → ⚠️ **do this after Step 3** once you know the Vercel domain. In AuthKit / Redirects, add:
   ```
   https://YOUR-VERCEL-DOMAIN/callback
   ```
   (The app's callback route is `/callback`.)

---

## 3. Vercel — the app

1. **Add New… → Project → Import** `RiploData/riplo-evals-battleground`. Framework preset auto-detects **Next.js**. Build command/output: defaults (`vercel.json` is committed).
2. **Region:** in Project → Settings → Functions, set the region to match your RDS region (`vercel.json` pins `iad1` = us-east-1; change it there if your RDS is elsewhere). Single-region is fine.
3. **Environment Variables** (Production scope) — add all of these:

   | Variable | Value | Notes |
   |---|---|---|
   | `DATABASE_URL` | from Step 1 | |
   | `DATABASE_SSL` | `true` | required for RDS |
   | `DB_POOL_MAX` | `3` | keep small on serverless |
   | `WORKOS_API_KEY` | from Step 2 | **needed at build time** too |
   | `WORKOS_CLIENT_ID` | from Step 2 | |
   | `WORKOS_COOKIE_PASSWORD` | from Step 2 | |
   | `ALLOWED_ORG_ID` | from Step 2 | |
   | `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | `https://YOUR-VERCEL-DOMAIN/callback` | set after first deploy gives you the domain, then redeploy |
   | `ANTHROPIC_API_KEY` | your key | enables live Claude generation |
   | `OPENAI_API_KEY` | your key | enables live GPT generation |

   ❌ **Do NOT set** `NEXT_PUBLIC_ARENA_DEV_AUTH`, `ARENA_DEV_AUTH_EMAIL`, or `ARENA_DEV_AUTH_ROLE` — the dev bypass must stay off in a public deploy (it's also auto-disabled in production).

4. **Deploy.** Note the assigned domain (e.g. `riplo-evals-battleground.vercel.app`).
5. Go back and finish the two domain-dependent items, then **redeploy**:
   - Vercel env: set `NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://YOUR-DOMAIN/callback` (it's a `NEXT_PUBLIC_*` var → must be present at build, so redeploy after setting it).
   - WorkOS (Step 2.6): add `https://YOUR-DOMAIN/callback` as an allowed redirect URI.

---

## 4. Initialize the database (from your laptop)

The schema + corpus aren't in the DB yet. Point your local repo at RDS and run migrations + seed (these make no model calls, so no API keys needed):

```bash
cd riplo-evals-battleground
export DATABASE_URL='postgres://arena:YOUR_PASSWORD@YOUR-ENDPOINT:5432/arena'
export DATABASE_SSL=true

npm run db:migrate     # creates tables + immutability guards
npm run seed           # imports suite + campaign + 2 competitors + 8 cases from git
```

(Requires your laptop IP to reach RDS — covered by the Step 1.6 security-group rule.)

You do **not** need `seed:dev-responses` here — with `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` set in Vercel, the first battle generates real responses on demand.

---

## 5. Verify

1. Open `https://YOUR-DOMAIN` → **Start rating** → you're redirected to WorkOS → sign in as your admin user.
2. `/battle` should serve a blinded battle. The **first** battle for each case pair triggers live generation (a few seconds) — subsequent ones are cached.
3. Cast a few votes, then go to `/leaderboard` → **Run ranking** → confirm the Bradley–Terry leaderboard populates.
4. Invite a teammate: add them to the WorkOS org (role `member`) → they can rate at `/battle`.

---

## What I (the app) already handle for you
- TLS to RDS (`DATABASE_SSL=true`), bounded pool (`DB_POOL_MAX`).
- 60s function timeout on the generation-heavy routes (`/api/battle`, `/api/generate`).
- Region pinning via `vercel.json`.
- Real WorkOS enforced in production (dev bypass auto-off); roles synced from WorkOS on every login.
- The whole corpus is in git and seeds idempotently.

## Known gaps to revisit before *production* (not blockers for a test)
- **RDS Proxy + private subnet** (vs. public access) per `inputs/04-architecture.md`.
- **S3 storage driver** — current storage is local-fs; only matters once cases use image/chart blocks.
- **RDS CA verification** — the test uses encrypted-but-not-cert-verified TLS; pin the RDS CA bundle for prod.
