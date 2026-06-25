# Eligibility & Admin Features (B, C, D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add case-level eligibility with admin override (Feature B), competitor enable/disable (Feature C), and campaign-scoped "generate all missing cells" (Feature D), with full admin UI and API coverage.

**Architecture:** Schema columns are added to `cases` and `competitors` tables, a shared `isCaseEligible` domain helper drives both battle filtering and admin display, new service functions in `src/services/admin.ts` handle eligibility/competitor ops, and `enqueueMissingForCampaign` in `generate-batch.ts` resolves eligible cells autonomously.

**Tech Stack:** Drizzle ORM (PostgreSQL), Next.js 15 App Router (server components + `'use client'` controls), Vitest for tests, TypeScript.

## Global Constraints

- Working directory: `/Users/zackzornitta/dev/riplo-evals-battleground`
- Branch: `master`. No git commits. No remote RDS changes.
- DB: local Postgres on port 5544. Test DB: `arena_test`.
- Run `npm run db:generate` (not `drizzle-kit generate` directly) to create migrations.
- Run `npm run db:migrate` to apply migrations to the dev DB.
- Tests: `npx vitest run` — must stay all-green.
- TypeScript: `npx tsc --noEmit` must be clean.
- Design tokens: import `{ t, sans, mono }` from `@/ui/tokens`. Match existing admin page style exactly.
- API error envelope: `{ error: { code: string, message: string } }` with appropriate HTTP status.
- snake_case request bodies on all new API routes.
- `ensureResponse` already skips cells with a cached response (idempotent).
- `case_versions` rows are immutable (never mutate). New columns go on `cases` only.
- Max concurrency for `enqueueMissingForCampaign`: 4 in-flight at a time.

---

## File Map

**Modified files:**
- `src/db/schema/suites-cases.ts` — add `retiredAt`, `eligibleOverride` to `cases`
- `src/db/schema/competitors.ts` — add `enabled` to `competitors`
- `src/corpus/import-cases.ts` — add reconcile logic (retire/unretire)
- `src/services/battle.ts` — replace case query with eligibility-filtered version
- `src/services/generate-batch.ts` — add `enqueueMissingForCampaign`
- `src/app/(admin)/cases/page.tsx` — add new columns + `CaseEligibilityControl`
- `src/app/(admin)/competitors/page.tsx` — add enabled toggle + `CompetitorToggle`
- `src/app/(admin)/generate/page.tsx` — add `GenerateMissingButton`

**New files:**
- `src/domain/eligibility.ts` — `isCaseEligible` pure function
- `src/services/admin.ts` — admin service functions (listCasesWithEligibility, setCaseEligibility, listCompetitorsWithStatus, setCompetitorEnabled)
- `src/app/api/cases/eligibility/route.ts` — POST override
- `src/app/api/competitors/enabled/route.ts` — POST enable/disable
- `src/app/api/generate/missing/route.ts` — POST enqueueMissingForCampaign
- `src/app/(admin)/cases/CaseEligibilityControl.tsx` — client select
- `src/app/(admin)/competitors/CompetitorToggle.tsx` — client checkbox
- `src/app/(admin)/generate/GenerateMissingButton.tsx` — client button
- `tests/domain/eligibility.test.ts` — unit tests for isCaseEligible
- Report: `.superpowers/sdd/eligibility-feature-report.md`

**Test files to update:**
- `tests/integration/import-cases.test.ts` — add retire/unretire test
- `tests/integration/battle.test.ts` — seed cases with `datasetSplit: 'dev'`, competitors with `enabled: true` (default); add a shared eligibility helper if needed
- `tests/integration/generate-batch.test.ts` — add `enqueueMissingForCampaign` test

---

## Task 1: Schema — cases + competitors columns

**Files:**
- Modify: `src/db/schema/suites-cases.ts`
- Modify: `src/db/schema/competitors.ts`
- Generate migration: `npm run db:generate`
- Apply migration: `npm run db:migrate`

**Interfaces:**
- Produces: `cases.retiredAt: timestamp | null`, `cases.eligibleOverride: boolean | null`, `competitors.enabled: boolean` (default true)

- [ ] **Step 1: Add columns to `cases` table in `src/db/schema/suites-cases.ts`**

Read the file first, then add after the existing `externalRef` field. Add `boolean` to the existing import from `drizzle-orm/pg-core`:

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  doublePrecision,
  unique,
  boolean,
} from 'drizzle-orm/pg-core';
```

And in the `cases` table definition, after `externalRef`:
```typescript
retiredAt: timestamp('retired_at', { withTimezone: true }),
eligibleOverride: boolean('eligible_override'),
```

Full updated `cases` table:
```typescript
export const cases = pgTable('cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  suiteId: uuid('suite_id')
    .notNull()
    .references(() => suites.id),
  externalRef: text('external_ref'),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  eligibleOverride: boolean('eligible_override'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Add `enabled` column to `competitors` table in `src/db/schema/competitors.ts`**

Add `boolean` to the existing import, then add `enabled` to the table:

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  unique,
  boolean,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
```

In the `competitors` table definition, after `competitorType`:
```typescript
enabled: boolean('enabled').notNull().default(true),
```

Full updated `competitors` table:
```typescript
export const competitors = pgTable('competitors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  competitorType: text('competitor_type').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Run db:generate to create migration**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npm run db:generate
```

Expected: a new migration file created under `src/db/migrations/` with a name like `0002_<slug>.sql`. Verify it appears in `src/db/migrations/meta/_journal.json`.

- [ ] **Step 4: Apply migration to dev DB**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npm run db:migrate
```

Expected: exits 0. Migration applied.

- [ ] **Step 5: Run tsc to verify schema compiles**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

---

## Task 2: Domain helper — `isCaseEligible`

**Files:**
- Create: `src/domain/eligibility.ts`
- Create: `tests/domain/eligibility.test.ts`

**Interfaces:**
- Produces: `isCaseEligible(p: { retiredAt: Date | null; eligibleOverride: boolean | null; latestSplit: string }): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/domain/eligibility.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isCaseEligible } from '@/domain/eligibility';

describe('isCaseEligible', () => {
  it('override=true makes any case eligible (even retired)', () => {
    expect(
      isCaseEligible({ retiredAt: new Date(), eligibleOverride: true, latestSplit: 'holdout' }),
    ).toBe(true);
  });

  it('override=false makes any case ineligible (even fresh dev case)', () => {
    expect(
      isCaseEligible({ retiredAt: null, eligibleOverride: false, latestSplit: 'dev' }),
    ).toBe(false);
  });

  it('default: dev split + not retired → eligible', () => {
    expect(
      isCaseEligible({ retiredAt: null, eligibleOverride: null, latestSplit: 'dev' }),
    ).toBe(true);
  });

  it('default: holdout split → ineligible', () => {
    expect(
      isCaseEligible({ retiredAt: null, eligibleOverride: null, latestSplit: 'holdout' }),
    ).toBe(false);
  });

  it('default: validation split → ineligible', () => {
    expect(
      isCaseEligible({ retiredAt: null, eligibleOverride: null, latestSplit: 'validation' }),
    ).toBe(false);
  });

  it('default: retired + dev split → ineligible', () => {
    expect(
      isCaseEligible({ retiredAt: new Date(), eligibleOverride: null, latestSplit: 'dev' }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx vitest run tests/domain/eligibility.test.ts 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/domain/eligibility.ts`**

```typescript
export interface EligibilityInput {
  retiredAt: Date | null;
  eligibleOverride: boolean | null;
  latestSplit: string;
}

/**
 * Resolves whether a case is eligible for battle.
 *
 * Priority:
 * 1. eligibleOverride=true  → always eligible (admin force-in)
 * 2. eligibleOverride=false → always ineligible (admin force-out)
 * 3. Default rule: not retired AND latest version is on 'dev' split
 */
export function isCaseEligible(p: EligibilityInput): boolean {
  if (p.eligibleOverride === true) return true;
  if (p.eligibleOverride === false) return false;
  return p.retiredAt === null && p.latestSplit === 'dev';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx vitest run tests/domain/eligibility.test.ts 2>&1 | tail -10
```

Expected: 6 tests pass.

---

## Task 3: Importer reconciliation

**Files:**
- Modify: `src/corpus/import-cases.ts`
- Modify: `tests/integration/import-cases.test.ts`

**Interfaces:**
- Consumes: `cases.retiredAt` (from Task 1 schema), `cases.externalRef`
- Produces: `importCases` now also sets `retiredAt` / clears it

- [ ] **Step 1: Add reconciliation to `src/corpus/import-cases.ts`**

After the existing per-file loop, add a reconcile pass. The full updated `importCases` function:

```typescript
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { glob } from 'glob';
import { eq, and, isNull, isNotNull, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { suites, cases, caseVersions } from '@/db/schema';
import { contentHash } from '@/domain/content-hash';
import { validateCaseFile, type CaseFile } from './case-schema';

// ── Helpers ──────────────────────────────────────────────────────────────────

function deriveExternalRef(rootDir: string, caseJsonPath: string): string {
  const rel = relative(rootDir, caseJsonPath);
  return rel.replace(/[\\/]case\.json$/, '');
}

async function upsertSuite(suiteName: string): Promise<string> {
  const existing = await db.query.suites.findFirst({
    where: eq(suites.name, suiteName),
  });
  if (existing) {
    return existing.id;
  }
  const [inserted] = await db
    .insert(suites)
    .values({ name: suiteName })
    .returning({ id: suites.id });
  return inserted.id;
}

async function upsertCase(suiteId: string, externalRef: string): Promise<string> {
  const existing = await db.query.cases.findFirst({
    where: and(eq(cases.suiteId, suiteId), eq(cases.externalRef, externalRef)),
  });
  if (existing) {
    return existing.id;
  }
  const [inserted] = await db
    .insert(cases)
    .values({ suiteId, externalRef })
    .returning({ id: cases.id });
  return inserted.id;
}

async function latestCaseVersion(caseId: string) {
  return db.query.caseVersions.findFirst({
    where: eq(caseVersions.caseId, caseId),
    orderBy: (cv, { desc }) => desc(cv.version),
  });
}

async function insertCaseVersion(
  caseId: string,
  version: number,
  cf: CaseFile,
  hash: string,
): Promise<void> {
  const evaluatorContext = {
    title: cf.title,
    guidance: cf.guidance,
    output_spec: cf.output_spec,
    source_blocks: cf.source_blocks,
  };

  await db.insert(caseVersions).values({
    caseId,
    version,
    kind: cf.kind,
    title: cf.title,
    guidance: cf.guidance ?? null,
    outputSpecJson: cf.output_spec as unknown as Record<string, unknown>,
    runnerInputJson: cf.runner_input,
    evaluatorContextJson: evaluatorContext as unknown as Record<string, unknown>,
    sourceBlocksJson: cf.source_blocks as unknown as Record<string, unknown>[],
    hiddenMetadataJson: cf.hidden_metadata,
    tags: cf.tags,
    datasetSplit: cf.dataset_split,
    samplingWeight: 1.0,
    contentHash: hash,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ImportResult {
  created: number;
  unchanged: number;
  retired: number;
  unretired: number;
}

/**
 * Walk all case.json files under rootDir, validate each, and upsert into the DB.
 * Idempotent + content-addressed: re-running with unchanged files is a no-op.
 * An edited file gets a new case_version row (never mutates prior versions).
 *
 * Reconciliation: cases whose external_ref was NOT seen this run AND have
 * retired_at IS NULL are retired (retired_at = now()). Cases that were seen
 * this run AND already have retired_at set are un-retired (retired_at = null).
 * eligible_override is never touched (admin-owned).
 */
export async function importCases(rootDir: string): Promise<ImportResult> {
  const pattern = join(rootDir, '**/case.json').replace(/\\/g, '/');
  const files = await glob(pattern, { nodir: true });

  let created = 0;
  let unchanged = 0;

  // Track which (suiteId, externalRef) pairs were seen this run, per suiteId
  const seenCaseIds = new Set<string>();

  for (const filePath of files) {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const cf = validateCaseFile(raw);
    const hash = contentHash(cf);
    const externalRef = deriveExternalRef(rootDir, filePath);

    const suiteId = await upsertSuite(cf.suite);
    const caseId = await upsertCase(suiteId, externalRef);
    seenCaseIds.add(caseId);

    const latest = await latestCaseVersion(caseId);

    if (latest && latest.contentHash === hash) {
      unchanged++;
    } else {
      const nextVersion = latest ? latest.version + 1 : 1;
      await insertCaseVersion(caseId, nextVersion, cf, hash);
      created++;
    }

    // Un-retire if the file is back (regardless of content change)
    const caseRow = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
    if (caseRow && caseRow.retiredAt !== null) {
      await db.update(cases).set({ retiredAt: null }).where(eq(cases.id, caseId));
    }
  }

  // Reconcile: retire cases not seen this run that are currently active (retiredAt IS NULL)
  // Only reconcile cases for suites we encountered in this run (by collecting suiteIds seen)
  let retired = 0;
  let unretired = 0;

  if (seenCaseIds.size > 0) {
    // Find all cases for suites that appear in our seen set
    // We reconcile at the rootDir level: get all suiteIds encountered
    const seenCaseIdArray = Array.from(seenCaseIds);

    // Get sibling cases in the same suites that were NOT seen
    // First find the suiteIds for the cases we did see
    const seenCaseRows = await db
      .select({ suiteId: cases.suiteId })
      .from(cases)
      .where(inArray(cases.id, seenCaseIdArray));

    const seenSuiteIds = [...new Set(seenCaseRows.map(r => r.suiteId))];

    if (seenSuiteIds.length > 0) {
      // Find active cases in these suites that we did NOT see
      const activeSiblings = await db
        .select({ id: cases.id })
        .from(cases)
        .where(
          and(
            inArray(cases.suiteId, seenSuiteIds),
            isNull(cases.retiredAt),
          ),
        );

      const toRetire = activeSiblings.filter(c => !seenCaseIds.has(c.id));
      if (toRetire.length > 0) {
        const now = new Date();
        for (const c of toRetire) {
          await db.update(cases).set({ retiredAt: now }).where(eq(cases.id, c.id));
          retired++;
        }
      }
    }
  }

  // Count un-retirements (already handled inline above, just count them)
  // We set unretired inline above — but we tracked nothing yet. Let's re-tally:
  // (The un-retire logic above was inline per file. We need to count them.)
  // Actually, the inline approach already handles it but doesn't count. Let's fix
  // by counting in the loop: we need to restructure slightly.
  // NOTE: The above code sets unretired = 0. We'll fix this by refactoring.

  return { created, unchanged, retired, unretired };
}
```

Wait — the above has a bug with counting `unretired`. Let me write the correct version:

```typescript
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { glob } from 'glob';
import { eq, and, isNull, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { suites, cases, caseVersions } from '@/db/schema';
import { contentHash } from '@/domain/content-hash';
import { validateCaseFile, type CaseFile } from './case-schema';

// ── Helpers ──────────────────────────────────────────────────────────────────

function deriveExternalRef(rootDir: string, caseJsonPath: string): string {
  const rel = relative(rootDir, caseJsonPath);
  return rel.replace(/[\\/]case\.json$/, '');
}

async function upsertSuite(suiteName: string): Promise<string> {
  const existing = await db.query.suites.findFirst({
    where: eq(suites.name, suiteName),
  });
  if (existing) return existing.id;
  const [inserted] = await db
    .insert(suites)
    .values({ name: suiteName })
    .returning({ id: suites.id });
  return inserted.id;
}

async function upsertCase(suiteId: string, externalRef: string): Promise<string> {
  const existing = await db.query.cases.findFirst({
    where: and(eq(cases.suiteId, suiteId), eq(cases.externalRef, externalRef)),
  });
  if (existing) return existing.id;
  const [inserted] = await db
    .insert(cases)
    .values({ suiteId, externalRef })
    .returning({ id: cases.id });
  return inserted.id;
}

async function latestCaseVersion(caseId: string) {
  return db.query.caseVersions.findFirst({
    where: eq(caseVersions.caseId, caseId),
    orderBy: (cv, { desc }) => desc(cv.version),
  });
}

async function insertCaseVersion(
  caseId: string,
  version: number,
  cf: CaseFile,
  hash: string,
): Promise<void> {
  const evaluatorContext = {
    title: cf.title,
    guidance: cf.guidance,
    output_spec: cf.output_spec,
    source_blocks: cf.source_blocks,
  };
  await db.insert(caseVersions).values({
    caseId,
    version,
    kind: cf.kind,
    title: cf.title,
    guidance: cf.guidance ?? null,
    outputSpecJson: cf.output_spec as unknown as Record<string, unknown>,
    runnerInputJson: cf.runner_input,
    evaluatorContextJson: evaluatorContext as unknown as Record<string, unknown>,
    sourceBlocksJson: cf.source_blocks as unknown as Record<string, unknown>[],
    hiddenMetadataJson: cf.hidden_metadata,
    tags: cf.tags,
    datasetSplit: cf.dataset_split,
    samplingWeight: 1.0,
    contentHash: hash,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ImportResult {
  created: number;
  unchanged: number;
  retired: number;
  unretired: number;
}

export async function importCases(rootDir: string): Promise<ImportResult> {
  const pattern = join(rootDir, '**/case.json').replace(/\\/g, '/');
  const files = await glob(pattern, { nodir: true });

  let created = 0;
  let unchanged = 0;
  let unretired = 0;

  const seenCaseIds = new Set<string>();

  for (const filePath of files) {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const cf = validateCaseFile(raw);
    const hash = contentHash(cf);
    const externalRef = deriveExternalRef(rootDir, filePath);

    const suiteId = await upsertSuite(cf.suite);
    const caseId = await upsertCase(suiteId, externalRef);
    seenCaseIds.add(caseId);

    // Un-retire if the file returned
    const caseRow = await db
      .select({ retiredAt: cases.retiredAt })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);
    if (caseRow[0]?.retiredAt !== null && caseRow[0]?.retiredAt !== undefined) {
      await db.update(cases).set({ retiredAt: null }).where(eq(cases.id, caseId));
      unretired++;
    }

    const latest = await latestCaseVersion(caseId);
    if (latest && latest.contentHash === hash) {
      unchanged++;
    } else {
      const nextVersion = latest ? latest.version + 1 : 1;
      await insertCaseVersion(caseId, nextVersion, cf, hash);
      created++;
    }
  }

  // Retire cases in the same suites that were not seen this run
  let retired = 0;
  if (seenCaseIds.size > 0) {
    const seenCaseIdArray = Array.from(seenCaseIds);
    const seenCaseRows = await db
      .select({ suiteId: cases.suiteId })
      .from(cases)
      .where(inArray(cases.id, seenCaseIdArray));
    const seenSuiteIds = [...new Set(seenCaseRows.map(r => r.suiteId))];

    if (seenSuiteIds.length > 0) {
      const activeSiblings = await db
        .select({ id: cases.id })
        .from(cases)
        .where(and(inArray(cases.suiteId, seenSuiteIds), isNull(cases.retiredAt)));
      const toRetire = activeSiblings.filter(c => !seenCaseIds.has(c.id));
      if (toRetire.length > 0) {
        const now = new Date();
        for (const c of toRetire) {
          await db.update(cases).set({ retiredAt: now }).where(eq(cases.id, c.id));
          retired++;
        }
      }
    }
  }

  return { created, unchanged, retired, unretired };
}
```

- [ ] **Step 2: Add retire/unretire tests to `tests/integration/import-cases.test.ts`**

Add a new describe block at the end of the file (before the closing). The test uses a temp directory with 2 cases, removes one, reimports (expect it retired), restores it, reimports (expect unretired):

```typescript
describe('importCases reconciliation', () => {
  it('retires a case when its file is removed, then unretires when restored', async () => {
    const tmpSuiteName = `Reconcile Suite - ${randomUUID().slice(0, 8)}`;
    const tmpRoot = join(tmpdir(), `arena-reconcile-${randomUUID().slice(0, 8)}`);

    const caseADir = join(tmpRoot, 'reconcile-a', 'case-one');
    const caseBDir = join(tmpRoot, 'reconcile-b', 'case-two');
    mkdirSync(caseADir, { recursive: true });
    mkdirSync(caseBDir, { recursive: true });

    const baseCase = (variant: string) => ({
      kind: 'compression',
      title: `Reconcile case ${variant}`,
      output_spec: {
        target: 'IC one-pager',
        parts: [{ type: 'title', label: 'Headline', note: 'one line' }],
      },
      runner_input: { instruction: 'Compress this.' },
      source_blocks: [{ type: 'text', text: `Source ${variant}` }],
      hidden_metadata: {},
      tags: [],
      dataset_split: 'dev',
      suite: tmpSuiteName,
    });

    writeFileSync(join(caseADir, 'case.json'), JSON.stringify(baseCase('A')));
    writeFileSync(join(caseBDir, 'case.json'), JSON.stringify(baseCase('B')));

    try {
      // Initial import — both cases created, none retired
      const r1 = await importCases(tmpRoot);
      expect(r1.created).toBe(2);
      expect(r1.retired).toBe(0);
      expect(r1.unretired).toBe(0);

      // Find case B's id
      const suite = await db.query.suites.findFirst({ where: eq(suites.name, tmpSuiteName) });
      expect(suite).toBeTruthy();
      const allCases = await db.query.cases.findMany({ where: eq(cases.suiteId, suite!.id) });
      expect(allCases).toHaveLength(2);
      const caseB = allCases.find(c => c.externalRef?.includes('reconcile-b'));
      expect(caseB).toBeTruthy();

      // Remove case B's file
      const { unlinkSync } = await import('node:fs');
      unlinkSync(join(caseBDir, 'case.json'));

      // Re-import without case B — it should be retired
      const r2 = await importCases(tmpRoot);
      expect(r2.created).toBe(0);
      expect(r2.unchanged).toBe(1);
      expect(r2.retired).toBe(1);
      expect(r2.unretired).toBe(0);

      // Verify case B is now retired
      const caseBAfterRetire = await db.query.cases.findFirst({ where: eq(cases.id, caseB!.id) });
      expect(caseBAfterRetire!.retiredAt).not.toBeNull();

      // Restore case B
      mkdirSync(caseBDir, { recursive: true });
      writeFileSync(join(caseBDir, 'case.json'), JSON.stringify(baseCase('B')));

      // Re-import — case B should be unretired
      const r3 = await importCases(tmpRoot);
      expect(r3.unretired).toBe(1);
      expect(r3.retired).toBe(0);

      // Verify case B retired_at is null again
      const caseBAfterUnretire = await db.query.cases.findFirst({ where: eq(cases.id, caseB!.id) });
      expect(caseBAfterUnretire!.retiredAt).toBeNull();
    } finally {
      await cleanupFixtureSuite(tmpSuiteName);
    }
  });
});
```

- [ ] **Step 3: Run the import-cases tests**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx vitest run tests/integration/import-cases.test.ts 2>&1 | tail -20
```

Expected: all tests pass (including the new reconciliation test).

---

## Task 4: Battle service — eligibility-filtered case query

**Files:**
- Modify: `src/services/battle.ts`

**Interfaces:**
- Consumes: `isCaseEligible` from `@/domain/eligibility` (Task 2)
- Consumes: `cases.retiredAt`, `cases.eligibleOverride` (Task 1)
- Consumes: `competitors.enabled` (Task 1)
- Produces: `getNextBattle` filters to eligible cases and enabled competitors

The key change: replace step 2 (flat "all case versions in suite") with a join that loads cases + their latest version, computes isCaseEligible, and filters `eligibleCompetitorVersionIds` to only versions whose competitor is enabled.

- [ ] **Step 1: Update `src/services/battle.ts`**

Replace step 2 and the competitor filtering. The full updated file:

```typescript
import { eq, and, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  campaigns,
  suiteVersions,
  caseVersions,
  cases,
  competitors,
  competitorVersions,
  responses,
  comparisons,
  assignments,
} from '@/db/schema';
import { selectPair, pairKey } from '@/domain/matchmaking';
import { ensureResponse } from '@/services/generation/runner';
import { toBlindedOptions } from '@/domain/blinding';
import { isCaseEligible } from '@/domain/eligibility';
import type { SessionUser } from '@/auth/workos';
import type { BattlePayload, BattleTask, OutputSpec, SourceBlock } from '@/types/contracts';
import type { GenerationProvider } from '@/services/generation/provider';

export interface GetNextBattleOpts {
  provider?: GenerationProvider;
  rng?: () => number;
}

export async function getNextBattle(
  user: SessionUser,
  opts?: GetNextBattleOpts,
): Promise<BattlePayload | null> {
  const provider = opts?.provider;
  const rng = opts?.rng ?? Math.random;

  // 1. Load the single active campaign (most recently started, no end date).
  const activeCampaigns = await db
    .select()
    .from(campaigns)
    .where(isNull(campaigns.endedAt))
    .orderBy(campaigns.createdAt)
    .limit(1);

  if (activeCampaigns.length === 0) return null;

  const campaign = activeCampaigns[0];
  const rawEligibleCompetitorVersionIds = campaign.eligibleCompetitorVersionIds as string[];

  if (rawEligibleCompetitorVersionIds.length < 2) return null;

  // 2. Filter eligibleCompetitorVersionIds to those whose competitor is enabled
  //    AND competitorVersion.status = 'active'.
  const enabledCvRows = await db
    .select({ id: competitorVersions.id })
    .from(competitorVersions)
    .innerJoin(competitors, eq(competitors.id, competitorVersions.competitorId))
    .where(
      and(
        inArray(competitorVersions.id, rawEligibleCompetitorVersionIds),
        eq(competitors.enabled, true),
        eq(competitorVersions.status, 'active'),
      ),
    );

  const eligibleCompetitorVersionIds = enabledCvRows.map(r => r.id);

  if (eligibleCompetitorVersionIds.length < 2) return null;

  // 3. Resolve suite → cases → latest version per case → filter by isCaseEligible.
  const [sv] = await db
    .select({ suiteId: suiteVersions.suiteId })
    .from(suiteVersions)
    .where(eq(suiteVersions.id, campaign.suiteVersionId))
    .limit(1);

  if (!sv) return null;

  // Load all cases in the suite with their eligibility fields
  const allCases = await db
    .select({
      id: cases.id,
      retiredAt: cases.retiredAt,
      eligibleOverride: cases.eligibleOverride,
    })
    .from(cases)
    .where(eq(cases.suiteId, sv.suiteId));

  if (allCases.length === 0) return null;

  // Load all case versions for these cases
  const caseIds = allCases.map(c => c.id);
  const allCaseVersionRows = await db
    .select({
      id: caseVersions.id,
      caseId: caseVersions.caseId,
      version: caseVersions.version,
      tags: caseVersions.tags,
      kind: caseVersions.kind,
      title: caseVersions.title,
      guidance: caseVersions.guidance,
      outputSpecJson: caseVersions.outputSpecJson,
      evaluatorContextJson: caseVersions.evaluatorContextJson,
      sourceBlocksJson: caseVersions.sourceBlocksJson,
      datasetSplit: caseVersions.datasetSplit,
    })
    .from(caseVersions)
    .where(inArray(caseVersions.caseId, caseIds));

  // Find the latest version per case
  const latestVersionByCaseId = new Map<string, typeof allCaseVersionRows[0]>();
  for (const cv of allCaseVersionRows) {
    const existing = latestVersionByCaseId.get(cv.caseId);
    if (!existing || cv.version > existing.version) {
      latestVersionByCaseId.set(cv.caseId, cv);
    }
  }

  // Filter to eligible cases
  const finalCaseVersions = allCases
    .map(c => {
      const latestCv = latestVersionByCaseId.get(c.id);
      if (!latestCv) return null;
      const eligible = isCaseEligible({
        retiredAt: c.retiredAt,
        eligibleOverride: c.eligibleOverride,
        latestSplit: latestCv.datasetSplit,
      });
      if (!eligible) return null;
      return latestCv;
    })
    .filter((cv): cv is NonNullable<typeof cv> => cv !== null);

  if (finalCaseVersions.length === 0) return null;

  // 4. Build existingPairCounts from comparisons.
  const existingComparisons = await db
    .select({
      responseOneId: comparisons.responseOneId,
      responseTwoId: comparisons.responseTwoId,
      caseVersionId: comparisons.caseVersionId,
    })
    .from(comparisons)
    .where(eq(comparisons.campaignId, campaign.id));

  const allResponseIds = existingComparisons.flatMap(c => [c.responseOneId, c.responseTwoId]);

  const responseCompetitorMap: Record<string, string> = {};
  if (allResponseIds.length > 0) {
    const responseRows = await db
      .select({ id: responses.id, competitorVersionId: responses.competitorVersionId })
      .from(responses)
      .where(inArray(responses.id, allResponseIds));
    for (const row of responseRows) {
      if (row.competitorVersionId) {
        responseCompetitorMap[row.id] = row.competitorVersionId;
      }
    }
  }

  const existingPairCounts: Record<string, number> = {};
  for (const comp of existingComparisons) {
    const cvA = responseCompetitorMap[comp.responseOneId];
    const cvB = responseCompetitorMap[comp.responseTwoId];
    if (cvA && cvB && comp.caseVersionId) {
      const key = pairKey(comp.caseVersionId, cvA, cvB);
      existingPairCounts[key] = (existingPairCounts[key] ?? 0) + 1;
    }
  }

  // 5. Build seenByUser: pairs already assigned to this user.
  const userAssignments = await db
    .select({
      leftResponseId: assignments.leftResponseId,
      rightResponseId: assignments.rightResponseId,
    })
    .from(assignments)
    .where(eq(assignments.assignedUserId, user.id));

  const seenByUser = new Set<string>();
  if (userAssignments.length > 0) {
    const assignedResponseIds = userAssignments.flatMap(a => [a.leftResponseId, a.rightResponseId]);
    const assignedResponseRows = await db
      .select({
        id: responses.id,
        competitorVersionId: responses.competitorVersionId,
        caseVersionId: responses.caseVersionId,
      })
      .from(responses)
      .where(inArray(responses.id, assignedResponseIds));

    const respMap: Record<string, { competitorVersionId: string | null; caseVersionId: string }> = {};
    for (const row of assignedResponseRows) {
      respMap[row.id] = { competitorVersionId: row.competitorVersionId, caseVersionId: row.caseVersionId };
    }

    for (const assignment of userAssignments) {
      const left = respMap[assignment.leftResponseId];
      const right = respMap[assignment.rightResponseId];
      if (left?.competitorVersionId && right?.competitorVersionId && left.caseVersionId) {
        const key = pairKey(left.caseVersionId, left.competitorVersionId, right.competitorVersionId);
        seenByUser.add(key);
      }
    }
  }

  // 6. Select a pair.
  const pair = selectPair({
    cases: finalCaseVersions.map(cv => ({ caseVersionId: cv.id, tags: cv.tags as string[] })),
    eligibleCompetitorVersionIds,
    existingPairCounts,
    seenByUser,
    rng,
  });

  if (pair === null) return null;

  // 7. Ensure responses exist for both cells.
  const [respA, respB] = await Promise.all([
    ensureResponse(pair.caseVersionId, pair.competitorA, 0, campaign.id, provider),
    ensureResponse(pair.caseVersionId, pair.competitorB, 0, campaign.id, provider),
  ]);

  // 8. Fetch the response rows (for blinding).
  const [responseRowA, responseRowB] = await Promise.all([
    db.select().from(responses).where(eq(responses.id, respA.responseId)).limit(1),
    db.select().from(responses).where(eq(responses.id, respB.responseId)).limit(1),
  ]);

  if (!responseRowA[0] || !responseRowB[0]) {
    throw new Error('Response rows missing after ensureResponse');
  }

  // 9. Create a comparison row.
  const [comparison] = await db
    .insert(comparisons)
    .values({
      campaignId: campaign.id,
      caseVersionId: pair.caseVersionId,
      responseOneId: respA.responseId,
      responseTwoId: respB.responseId,
      matchmakingStrategy: 'coverage',
    })
    .returning({ id: comparisons.id });

  // 10. Randomly choose left/right order, server-recorded.
  const flip = rng() < 0.5;
  const leftResponse = flip ? responseRowB[0] : responseRowA[0];
  const rightResponse = flip ? responseRowA[0] : responseRowB[0];

  // 11. Create an assignment.
  const [assignment] = await db
    .insert(assignments)
    .values({
      comparisonId: comparison.id,
      assignedUserId: user.id,
      leftResponseId: leftResponse.id,
      rightResponseId: rightResponse.id,
      uiVersion: 'arena-1',
    })
    .returning({ id: assignments.id });

  // 12. Build the blinded payload.
  const options = toBlindedOptions(
    {
      id: leftResponse.id,
      body_text: leftResponse.bodyText,
      body_json: leftResponse.bodyJson ?? undefined,
    },
    {
      id: rightResponse.id,
      body_text: rightResponse.bodyText,
      body_json: rightResponse.bodyJson ?? undefined,
    },
  );

  // 13. Build the task from the case version's evaluator_context_json.
  const caseVersion = finalCaseVersions.find(cv => cv.id === pair.caseVersionId)!;
  const caseRow = await db
    .select({ externalRef: cases.externalRef })
    .from(cases)
    .where(eq(cases.id, caseVersion.caseId))
    .limit(1);

  const evalCtx = (caseVersion.evaluatorContextJson ?? {}) as Record<string, unknown>;
  const task: BattleTask = {
    case_external_ref: caseRow[0]?.externalRef ?? '',
    kind: caseVersion.kind,
    title: (evalCtx['title'] as string | undefined) ?? caseVersion.title,
    guidance: (evalCtx['guidance'] as string | undefined) ?? caseVersion.guidance ?? undefined,
    output_spec: (evalCtx['output_spec'] as OutputSpec | undefined) ?? (caseVersion.outputSpecJson as OutputSpec),
    source_blocks: (evalCtx['source_blocks'] as SourceBlock[] | undefined) ?? (caseVersion.sourceBlocksJson as SourceBlock[]) ?? [],
  };

  return {
    assignment_id: assignment.id,
    ui_version: 'arena-1',
    task,
    options,
  };
}
```

Note: Remove the unused `sql` import if you added it. Check the imports list — only import what is actually used.

- [ ] **Step 2: Update the battle test seed to explicitly set eligible values**

In `tests/integration/battle.test.ts`, the `seedBattleFixture` function inserts cases and competitors. Cases default to `datasetSplit: 'dev'` (already set in the fixture via `caseVersions`). However, we need to confirm that the `cases` row has `retiredAt: null` and `eligibleOverride: null` (both are nullable, so they default to null — no change needed). Competitors need `enabled: true` (this is the column default — no change needed for existing seeds).

Just run the tests to confirm:

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx vitest run tests/integration/battle.test.ts 2>&1 | tail -20
```

Expected: all 3 tests pass.

---

## Task 5: Admin service functions

**Files:**
- Create: `src/services/admin.ts`

**Interfaces:**
- Consumes: `cases.retiredAt`, `cases.eligibleOverride`, `competitors.enabled` (Task 1)
- Consumes: `isCaseEligible` (Task 2)
- Produces:
  - `listCasesWithEligibility(): Promise<CaseEligibilityRow[]>`
  - `setCaseEligibility(caseId: string, override: boolean | null): Promise<void>`
  - `listCompetitorsWithStatus(): Promise<CompetitorStatusRow[]>`
  - `setCompetitorEnabled(competitorId: string, enabled: boolean): Promise<void>`

- [ ] **Step 1: Create `src/services/admin.ts`**

```typescript
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { cases, caseVersions, competitors, competitorVersions } from '@/db/schema';
import { isCaseEligible } from '@/domain/eligibility';

export interface CaseEligibilityRow {
  caseId: string;
  caseVersionId: string;
  externalRef: string | null;
  kind: string;
  title: string;
  datasetSplit: string;
  version: number;
  retiredAt: Date | null;
  eligibleOverride: boolean | null;
  defaultEligible: boolean;
  effectiveEligible: boolean;
}

/**
 * Returns one row per case (latest version), with default and effective eligibility computed.
 */
export async function listCasesWithEligibility(): Promise<CaseEligibilityRow[]> {
  // Load all cases with their eligibility fields
  const allCases = await db
    .select({
      id: cases.id,
      externalRef: cases.externalRef,
      retiredAt: cases.retiredAt,
      eligibleOverride: cases.eligibleOverride,
    })
    .from(cases);

  if (allCases.length === 0) return [];

  const caseIds = allCases.map(c => c.id);

  // Load all case versions
  const allCvRows = await db
    .select({
      id: caseVersions.id,
      caseId: caseVersions.caseId,
      version: caseVersions.version,
      kind: caseVersions.kind,
      title: caseVersions.title,
      datasetSplit: caseVersions.datasetSplit,
    })
    .from(caseVersions)
    .where(
      caseIds.length > 0
        ? sql`${caseVersions.caseId} = ANY(ARRAY[${sql.join(caseIds.map(id => sql`${id}::uuid`), sql`, `)}])`
        : sql`false`,
    );

  // Find latest version per case
  const latestByCaseId = new Map<string, typeof allCvRows[0]>();
  for (const cv of allCvRows) {
    const existing = latestByCaseId.get(cv.caseId);
    if (!existing || cv.version > existing.version) {
      latestByCaseId.set(cv.caseId, cv);
    }
  }

  const result: CaseEligibilityRow[] = [];
  for (const c of allCases) {
    const latestCv = latestByCaseId.get(c.id);
    if (!latestCv) continue;

    const defaultEligible = isCaseEligible({
      retiredAt: c.retiredAt,
      eligibleOverride: null,
      latestSplit: latestCv.datasetSplit,
    });
    const effectiveEligible = isCaseEligible({
      retiredAt: c.retiredAt,
      eligibleOverride: c.eligibleOverride,
      latestSplit: latestCv.datasetSplit,
    });

    result.push({
      caseId: c.id,
      caseVersionId: latestCv.id,
      externalRef: c.externalRef,
      kind: latestCv.kind,
      title: latestCv.title,
      datasetSplit: latestCv.datasetSplit,
      version: latestCv.version,
      retiredAt: c.retiredAt,
      eligibleOverride: c.eligibleOverride,
      defaultEligible,
      effectiveEligible,
    });
  }

  return result;
}

/**
 * Set or clear the admin eligibility override for a case.
 * Pass null to clear the override (revert to default rule).
 * Does NOT touch retired_at.
 */
export async function setCaseEligibility(
  caseId: string,
  override: boolean | null,
): Promise<void> {
  await db
    .update(cases)
    .set({ eligibleOverride: override })
    .where(eq(cases.id, caseId));
}

export interface CompetitorStatusRow {
  competitorId: string;
  name: string;
  enabled: boolean;
  versionCount: number;
  latestModelIdentifier: string | null;
}

/**
 * Returns one row per competitor with aggregated version info.
 */
export async function listCompetitorsWithStatus(): Promise<CompetitorStatusRow[]> {
  const allCompetitors = await db
    .select({
      id: competitors.id,
      name: competitors.name,
      enabled: competitors.enabled,
    })
    .from(competitors);

  if (allCompetitors.length === 0) return [];

  const allVersions = await db
    .select({
      competitorId: competitorVersions.competitorId,
      version: competitorVersions.version,
      modelIdentifier: competitorVersions.modelIdentifier,
    })
    .from(competitorVersions);

  const versionsByCompetitorId = new Map<string, typeof allVersions>();
  for (const v of allVersions) {
    const existing = versionsByCompetitorId.get(v.competitorId) ?? [];
    existing.push(v);
    versionsByCompetitorId.set(v.competitorId, existing);
  }

  return allCompetitors.map(comp => {
    const versions = versionsByCompetitorId.get(comp.id) ?? [];
    const latest = versions.reduce<typeof versions[0] | null>((best, v) => {
      return best === null || v.version > best.version ? v : best;
    }, null);

    return {
      competitorId: comp.id,
      name: comp.name,
      enabled: comp.enabled,
      versionCount: versions.length,
      latestModelIdentifier: latest?.modelIdentifier ?? null,
    };
  });
}

/**
 * Enable or disable a competitor.
 */
export async function setCompetitorEnabled(
  competitorId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .update(competitors)
    .set({ enabled })
    .where(eq(competitors.id, competitorId));
}
```

Note: The `sql` import from drizzle-orm is used for the `ANY(ARRAY[...])` pattern. However, it's cleaner to use `inArray` from drizzle-orm instead. Let's use that instead to avoid raw SQL:

Replace the `allCvRows` query with:
```typescript
import { eq, inArray } from 'drizzle-orm';
// ...
const allCvRows = await db
  .select({
    id: caseVersions.id,
    caseId: caseVersions.caseId,
    version: caseVersions.version,
    kind: caseVersions.kind,
    title: caseVersions.title,
    datasetSplit: caseVersions.datasetSplit,
  })
  .from(caseVersions)
  .where(caseIds.length > 0 ? inArray(caseVersions.caseId, caseIds) : sql`false`);
```

The actual file to write:

```typescript
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { cases, caseVersions, competitors, competitorVersions } from '@/db/schema';
import { isCaseEligible } from '@/domain/eligibility';

export interface CaseEligibilityRow {
  caseId: string;
  caseVersionId: string;
  externalRef: string | null;
  kind: string;
  title: string;
  datasetSplit: string;
  version: number;
  retiredAt: Date | null;
  eligibleOverride: boolean | null;
  defaultEligible: boolean;
  effectiveEligible: boolean;
}

export async function listCasesWithEligibility(): Promise<CaseEligibilityRow[]> {
  const allCases = await db
    .select({
      id: cases.id,
      externalRef: cases.externalRef,
      retiredAt: cases.retiredAt,
      eligibleOverride: cases.eligibleOverride,
    })
    .from(cases);

  if (allCases.length === 0) return [];

  const caseIds = allCases.map(c => c.id);

  const allCvRows = await db
    .select({
      id: caseVersions.id,
      caseId: caseVersions.caseId,
      version: caseVersions.version,
      kind: caseVersions.kind,
      title: caseVersions.title,
      datasetSplit: caseVersions.datasetSplit,
    })
    .from(caseVersions)
    .where(inArray(caseVersions.caseId, caseIds));

  const latestByCaseId = new Map<string, (typeof allCvRows)[0]>();
  for (const cv of allCvRows) {
    const existing = latestByCaseId.get(cv.caseId);
    if (!existing || cv.version > existing.version) {
      latestByCaseId.set(cv.caseId, cv);
    }
  }

  const result: CaseEligibilityRow[] = [];
  for (const c of allCases) {
    const latestCv = latestByCaseId.get(c.id);
    if (!latestCv) continue;

    const defaultEligible = isCaseEligible({
      retiredAt: c.retiredAt,
      eligibleOverride: null,
      latestSplit: latestCv.datasetSplit,
    });
    const effectiveEligible = isCaseEligible({
      retiredAt: c.retiredAt,
      eligibleOverride: c.eligibleOverride,
      latestSplit: latestCv.datasetSplit,
    });

    result.push({
      caseId: c.id,
      caseVersionId: latestCv.id,
      externalRef: c.externalRef,
      kind: latestCv.kind,
      title: latestCv.title,
      datasetSplit: latestCv.datasetSplit,
      version: latestCv.version,
      retiredAt: c.retiredAt,
      eligibleOverride: c.eligibleOverride,
      defaultEligible,
      effectiveEligible,
    });
  }

  return result;
}

export async function setCaseEligibility(
  caseId: string,
  override: boolean | null,
): Promise<void> {
  await db
    .update(cases)
    .set({ eligibleOverride: override })
    .where(eq(cases.id, caseId));
}

export interface CompetitorStatusRow {
  competitorId: string;
  name: string;
  enabled: boolean;
  versionCount: number;
  latestModelIdentifier: string | null;
}

export async function listCompetitorsWithStatus(): Promise<CompetitorStatusRow[]> {
  const allCompetitors = await db
    .select({
      id: competitors.id,
      name: competitors.name,
      enabled: competitors.enabled,
    })
    .from(competitors);

  if (allCompetitors.length === 0) return [];

  const allVersions = await db
    .select({
      competitorId: competitorVersions.competitorId,
      version: competitorVersions.version,
      modelIdentifier: competitorVersions.modelIdentifier,
    })
    .from(competitorVersions);

  const versionsByCompetitorId = new Map<string, (typeof allVersions)>();
  for (const v of allVersions) {
    const existing = versionsByCompetitorId.get(v.competitorId) ?? [];
    existing.push(v);
    versionsByCompetitorId.set(v.competitorId, existing);
  }

  return allCompetitors.map(comp => {
    const versions = versionsByCompetitorId.get(comp.id) ?? [];
    const latest = versions.reduce<(typeof versions)[0] | null>((best, v) => {
      return best === null || v.version > best.version ? v : best;
    }, null);

    return {
      competitorId: comp.id,
      name: comp.name,
      enabled: comp.enabled,
      versionCount: versions.length,
      latestModelIdentifier: latest?.modelIdentifier ?? null,
    };
  });
}

export async function setCompetitorEnabled(
  competitorId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .update(competitors)
    .set({ enabled })
    .where(eq(competitors.id, competitorId));
}
```

- [ ] **Step 2: Run tsc to verify**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

---

## Task 6: Admin API routes

**Files:**
- Create: `src/app/api/cases/eligibility/route.ts`
- Create: `src/app/api/competitors/enabled/route.ts`

**Interfaces:**
- Consumes: `setCaseEligibility`, `setCompetitorEnabled` (Task 5)
- POST `{ case_id, override }` → `{ ok: true }`
- POST `{ competitor_id, enabled }` → `{ ok: true }`

- [ ] **Step 1: Create `src/app/api/cases/eligibility/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { setCaseEligibility } from '@/services/admin';
import type { ApiError } from '@/types/contracts';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch {
    const body: ApiError = { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    return NextResponse.json(body, { status: 401 });
  }

  try {
    requireRole(user, 'admin');
  } catch {
    const body: ApiError = { error: { code: 'FORBIDDEN', message: 'Insufficient role' } };
    return NextResponse.json(body, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const err: ApiError = { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } };
    return NextResponse.json(err, { status: 400 });
  }

  const { case_id, override } = body as Record<string, unknown>;

  if (typeof case_id !== 'string') {
    const err: ApiError = { error: { code: 'BAD_REQUEST', message: 'case_id (string) is required' } };
    return NextResponse.json(err, { status: 400 });
  }

  if (override !== null && override !== true && override !== false) {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'override must be true, false, or null' },
    };
    return NextResponse.json(err, { status: 400 });
  }

  try {
    await setCaseEligibility(case_id, override as boolean | null);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Set case eligibility error:', err);
    const errBody: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    return NextResponse.json(errBody, { status: 500 });
  }
}
```

- [ ] **Step 2: Create `src/app/api/competitors/enabled/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { setCompetitorEnabled } from '@/services/admin';
import type { ApiError } from '@/types/contracts';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch {
    const body: ApiError = { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    return NextResponse.json(body, { status: 401 });
  }

  try {
    requireRole(user, 'admin');
  } catch {
    const body: ApiError = { error: { code: 'FORBIDDEN', message: 'Insufficient role' } };
    return NextResponse.json(body, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const err: ApiError = { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } };
    return NextResponse.json(err, { status: 400 });
  }

  const { competitor_id, enabled } = body as Record<string, unknown>;

  if (typeof competitor_id !== 'string') {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'competitor_id (string) is required' },
    };
    return NextResponse.json(err, { status: 400 });
  }

  if (typeof enabled !== 'boolean') {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'enabled (boolean) is required' },
    };
    return NextResponse.json(err, { status: 400 });
  }

  try {
    await setCompetitorEnabled(competitor_id, enabled);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Set competitor enabled error:', err);
    const errBody: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    return NextResponse.json(errBody, { status: 500 });
  }
}
```

- [ ] **Step 3: Run tsc**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

---

## Task 7: `enqueueMissingForCampaign` service + API

**Files:**
- Modify: `src/services/generate-batch.ts`
- Create: `src/app/api/generate/missing/route.ts`

**Interfaces:**
- Produces: `enqueueMissingForCampaign(user: SessionUser, campaignId: string, provider?: GenerationProvider): Promise<{ generated: number; skipped: number; failed: number; total: number }>`

The function must:
1. Load campaign → eligible+enabled competitor versions (same logic as battle Task 4 step 2)
2. Load cases in campaign suite → filter by isCaseEligible → latest version per case
3. Cross-product × replicates (campaign.replicates, default 1)
4. For each cell: call `ensureResponse` — if response already existed (cache hit from ensureResponse internals), count as skipped; if newly created, count as generated; if threw, count as failed
5. Bounded concurrency: 4 in-flight

The problem: `ensureResponse` doesn't return whether it was a cache hit. We need to check before calling, or detect it from the return value. The cleanest approach: check if a response already exists before calling `ensureResponse`. But `ensureResponse` already does that check and is idempotent. Instead, count: before calling, check if response exists; if yes → skipped, else → call and count generated or failed.

Actually, the simpler and correct approach: look at the DB before and after. But the cleanest approach is to wrap `ensureResponse` with a pre-check:

```typescript
// Check if already cached
const existing = await db.select({id: responses.id}).from(responses)
  .where(and(
    eq(responses.caseVersionId, caseVersionId),
    eq(responses.competitorVersionId, competitorVersionId),
    eq(responses.replicateIndex, replicateIndex),
    eq(responses.originType, 'model_generation'),
  )).limit(1);

if (existing.length > 0) {
  skipped++;
} else {
  try {
    await ensureResponse(caseVersionId, competitorVersionId, replicateIndex, campaignId, provider);
    generated++;
  } catch {
    failed++;
  }
}
```

For bounded concurrency, use a simple semaphore pattern:

```typescript
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 1: Add `enqueueMissingForCampaign` to `src/services/generate-batch.ts`**

Add the following imports to the existing file (add `isNull`, `inArray` to the import from drizzle-orm if not already there):

```typescript
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  generationAttempts,
  responses,
  campaigns,
  suiteVersions,
  cases,
  caseVersions,
  competitors,
  competitorVersions,
} from '@/db/schema';
import { ensureResponse } from '@/services/generation/runner';
import { isCaseEligible } from '@/domain/eligibility';
import type { SessionUser } from '@/auth/workos';
import type { GenerationProvider } from '@/services/generation/provider';
```

Then add this function (the existing `enqueueGeneration` and `generationStatus` stay untouched):

```typescript
// ── Bounded concurrency helper ────────────────────────────────────────────────

async function runWithConcurrency(
  tasks: (() => Promise<void>)[],
  limit: number,
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
}

export interface EnqueueMissingResult {
  generated: number;
  skipped: number;
  failed: number;
  total: number;
}

/**
 * Resolves eligible case_versions × enabled competitor_versions × replicates for
 * the given campaign and calls ensureResponse for each missing cell.
 *
 * - already-cached cells → skipped
 * - newly generated cells → generated
 * - provider errors → failed (does not abort remaining cells)
 * - max 4 cells in-flight concurrently
 */
export async function enqueueMissingForCampaign(
  _user: SessionUser,
  campaignId: string,
  provider?: GenerationProvider,
): Promise<EnqueueMissingResult> {
  // 1. Load campaign
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const rawEligibleCvIds = campaign.eligibleCompetitorVersionIds as string[];
  const replicates = campaign.replicates ?? 1;

  // 2. Filter competitor versions: enabled competitor + active status
  const enabledCvRows = await db
    .select({ id: competitorVersions.id })
    .from(competitorVersions)
    .innerJoin(competitors, eq(competitors.id, competitorVersions.competitorId))
    .where(
      and(
        inArray(competitorVersions.id, rawEligibleCvIds),
        eq(competitors.enabled, true),
        eq(competitorVersions.status, 'active'),
      ),
    );

  const eligibleCvIds = enabledCvRows.map(r => r.id);

  if (eligibleCvIds.length === 0) {
    return { generated: 0, skipped: 0, failed: 0, total: 0 };
  }

  // 3. Resolve eligible case versions
  const [sv] = await db
    .select({ suiteId: suiteVersions.suiteId })
    .from(suiteVersions)
    .where(eq(suiteVersions.id, campaign.suiteVersionId))
    .limit(1);

  if (!sv) {
    return { generated: 0, skipped: 0, failed: 0, total: 0 };
  }

  const allCases = await db
    .select({
      id: cases.id,
      retiredAt: cases.retiredAt,
      eligibleOverride: cases.eligibleOverride,
    })
    .from(cases)
    .where(eq(cases.suiteId, sv.suiteId));

  if (allCases.length === 0) {
    return { generated: 0, skipped: 0, failed: 0, total: 0 };
  }

  const caseIds = allCases.map(c => c.id);

  const allCvRows = await db
    .select({
      id: caseVersions.id,
      caseId: caseVersions.caseId,
      version: caseVersions.version,
      datasetSplit: caseVersions.datasetSplit,
    })
    .from(caseVersions)
    .where(inArray(caseVersions.caseId, caseIds));

  const latestByCaseId = new Map<string, (typeof allCvRows)[0]>();
  for (const cv of allCvRows) {
    const existing = latestByCaseId.get(cv.caseId);
    if (!existing || cv.version > existing.version) {
      latestByCaseId.set(cv.caseId, cv);
    }
  }

  const eligibleCaseVersionIds = allCases
    .map(c => {
      const latestCv = latestByCaseId.get(c.id);
      if (!latestCv) return null;
      if (
        !isCaseEligible({
          retiredAt: c.retiredAt,
          eligibleOverride: c.eligibleOverride,
          latestSplit: latestCv.datasetSplit,
        })
      ) {
        return null;
      }
      return latestCv.id;
    })
    .filter((id): id is string => id !== null);

  if (eligibleCaseVersionIds.length === 0) {
    return { generated: 0, skipped: 0, failed: 0, total: 0 };
  }

  // 4. Build cell list
  type Cell = { caseVersionId: string; competitorVersionId: string; replicateIndex: number };
  const cells: Cell[] = [];
  for (const caseVersionId of eligibleCaseVersionIds) {
    for (const competitorVersionId of eligibleCvIds) {
      for (let replicateIndex = 0; replicateIndex < replicates; replicateIndex++) {
        cells.push({ caseVersionId, competitorVersionId, replicateIndex });
      }
    }
  }

  const total = cells.length;
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  // 5. Process with bounded concurrency
  const tasks = cells.map(cell => async () => {
    // Cache check
    const existing = await db
      .select({ id: responses.id })
      .from(responses)
      .where(
        and(
          eq(responses.caseVersionId, cell.caseVersionId),
          eq(responses.competitorVersionId, cell.competitorVersionId),
          eq(responses.replicateIndex, cell.replicateIndex),
          eq(responses.originType, 'model_generation'),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      return;
    }

    try {
      await ensureResponse(
        cell.caseVersionId,
        cell.competitorVersionId,
        cell.replicateIndex,
        campaignId,
        provider,
      );
      generated++;
    } catch {
      failed++;
    }
  });

  await runWithConcurrency(tasks, 4);

  return { generated, skipped, failed, total };
}
```

- [ ] **Step 2: Create `src/app/api/generate/missing/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { enqueueMissingForCampaign } from '@/services/generate-batch';
import type { ApiError } from '@/types/contracts';

export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch {
    const body: ApiError = { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    return NextResponse.json(body, { status: 401 });
  }

  try {
    requireRole(user, 'admin');
  } catch {
    const body: ApiError = { error: { code: 'FORBIDDEN', message: 'Insufficient role' } };
    return NextResponse.json(body, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const err: ApiError = { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } };
    return NextResponse.json(err, { status: 400 });
  }

  const { campaign_id } = body as Record<string, unknown>;

  if (typeof campaign_id !== 'string') {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'campaign_id (string) is required' },
    };
    return NextResponse.json(err, { status: 400 });
  }

  try {
    const result = await enqueueMissingForCampaign(user, campaign_id);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error('Enqueue missing error:', err);
    const errBody: ApiError = {
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Internal server error',
      },
    };
    return NextResponse.json(errBody, { status: 500 });
  }
}
```

- [ ] **Step 3: Add `enqueueMissingForCampaign` test to `tests/integration/generate-batch.test.ts`**

Add after the existing tests (before the final closing `}`):

```typescript
  it('enqueueMissingForCampaign fills only missing cells and is idempotent', async () => {
    const { suiteId, suiteVersionId } = await seedSuiteAndVersion('missing-04');
    const caseVersionId1 = await seedCaseVersion(suiteId, 'missing-04-c1');
    const caseVersionId2 = await seedCaseVersion(suiteId, 'missing-04-c2');
    const compVersionId1 = await seedCompetitorVersion('missing-04-v1');
    const compVersionId2 = await seedCompetitorVersion('missing-04-v2');

    // Campaign with replicates=1
    const [camp] = await db
      .insert(campaigns)
      .values({
        name: 'Missing Campaign 04',
        suiteVersionId,
        eligibleCompetitorVersionIds: [compVersionId1, compVersionId2],
        replicates: 1,
      })
      .returning({ id: campaigns.id });
    createdCampaignIds.push(camp.id);

    // First run — all 4 cells are missing
    const r1 = await enqueueMissingForCampaign(operatorUser, camp.id, fakeProvider);

    expect(r1.total).toBe(4);
    expect(r1.generated).toBe(4);
    expect(r1.skipped).toBe(0);
    expect(r1.failed).toBe(0);

    // Track cleanup
    const attemptsAfter = await db
      .select({ id: generationAttempts.id })
      .from(generationAttempts)
      .where(eq(generationAttempts.campaignId, camp.id));
    for (const a of attemptsAfter) {
      if (!createdAttemptIds.includes(a.id)) createdAttemptIds.push(a.id);
    }
    const responsesAfter = await db
      .select({ id: responses.id })
      .from(responses)
      .where(inArray(responses.caseVersionId, [caseVersionId1, caseVersionId2]));
    for (const r of responsesAfter) {
      if (!createdResponseIds.includes(r.id)) createdResponseIds.push(r.id);
    }

    // Second run — all 4 cells are already cached → all skipped
    const r2 = await enqueueMissingForCampaign(operatorUser, camp.id, fakeProvider);

    expect(r2.total).toBe(4);
    expect(r2.generated).toBe(0);
    expect(r2.skipped).toBe(4);
    expect(r2.failed).toBe(0);
  });
```

Also add `campaigns` and `inArray` to the imports at the top of the file:
```typescript
import {
  suites,
  suiteVersions,
  cases,
  caseVersions,
  competitors,
  competitorVersions,
  campaigns,
  generationAttempts,
  responses,
} from '@/db/schema';
import { enqueueGeneration, generationStatus, enqueueMissingForCampaign } from '@/services/generate-batch';
import { eq, inArray } from 'drizzle-orm';
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx vitest run tests/integration/generate-batch.test.ts 2>&1 | tail -20
```

Expected: 4 tests pass (3 original + 1 new).

---

## Task 8: Admin UI — cases page + CaseEligibilityControl

**Files:**
- Modify: `src/app/(admin)/cases/page.tsx`
- Create: `src/app/(admin)/cases/CaseEligibilityControl.tsx`

**Interfaces:**
- Consumes: `listCasesWithEligibility` (Task 5)
- New columns: Split, In-git (retiredAt? "removed":"present"), Default, Effective
- Client control: 3-option select → POST /api/cases/eligibility

- [ ] **Step 1: Create `src/app/(admin)/cases/CaseEligibilityControl.tsx`**

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, sans, mono } from '@/ui/tokens';

interface Props {
  caseId: string;
  current: boolean | null; // current eligibleOverride
}

type SelectValue = 'default' | 'force-in' | 'force-out';

function overrideToSelect(v: boolean | null): SelectValue {
  if (v === true) return 'force-in';
  if (v === false) return 'force-out';
  return 'default';
}

function selectToOverride(v: SelectValue): boolean | null {
  if (v === 'force-in') return true;
  if (v === 'force-out') return false;
  return null;
}

export default function CaseEligibilityControl({ caseId, current }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<SelectValue>(overrideToSelect(current));
  const [saving, setSaving] = useState(false);

  const handleChange = async (next: SelectValue) => {
    setValue(next);
    setSaving(true);
    try {
      await fetch('/api/cases/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId, override: selectToOverride(next) }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <select
      value={value}
      disabled={saving}
      onChange={e => handleChange(e.target.value as SelectValue)}
      style={{
        fontFamily: sans,
        fontSize: 12,
        padding: '3px 6px',
        borderRadius: 4,
        border: `1px solid ${t.line}`,
        backgroundColor: saving ? t.lineSoft : t.card,
        color: t.ink,
        cursor: saving ? 'not-allowed' : 'pointer',
      }}
    >
      <option value="default">Default</option>
      <option value="force-in">Force in</option>
      <option value="force-out">Force out</option>
    </select>
  );
}
```

- [ ] **Step 2: Update `src/app/(admin)/cases/page.tsx`**

Replace the import of `listCases` with `listCasesWithEligibility`, update column headers, add new cells, and embed `CaseEligibilityControl`:

```typescript
import { requireUser, requireRole } from '@/auth/workos';
import { listCasesWithEligibility } from '@/services/admin';
import { t, sans, mono } from '@/ui/tokens';
import CaseEligibilityControl from './CaseEligibilityControl';

export default async function CasesPage() {
  const user = await requireUser();

  try {
    requireRole(user, 'admin');
  } catch {
    return (
      <div style={{ color: '#b91c1c', fontFamily: sans, fontSize: 14 }}>
        Insufficient role — analyst, operator, or admin required.
      </div>
    );
  }

  const cases = await listCasesWithEligibility();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: t.ink, fontFamily: sans }}>
          Cases
        </h1>
        <span style={{ fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
          {cases.length} cases
        </span>
      </div>

      <div
        style={{
          backgroundColor: t.card,
          border: `1px solid ${t.line}`,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {cases.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: t.inkFaint, fontFamily: sans, fontSize: 14 }}>
            No cases found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.line}`, backgroundColor: t.lineSoft }}>
                  {['External ref', 'Kind', 'Title', 'Split', 'In-git', 'Default', 'Effective', 'Override'].map(
                    col => (
                      <th
                        key={col}
                        style={{
                          padding: '10px 14px',
                          textAlign: 'left' as const,
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase' as const,
                          color: t.inkFaint,
                          fontFamily: sans,
                          whiteSpace: 'nowrap' as const,
                        }}
                      >
                        {col}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {cases.map((c, i) => (
                  <tr
                    key={c.caseId}
                    style={{
                      borderBottom: i < cases.length - 1 ? `1px solid ${t.lineSoft}` : 'none',
                      backgroundColor: i % 2 === 0 ? t.card : '#FAFAF8',
                    }}
                  >
                    <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, color: t.inkSoft, whiteSpace: 'nowrap' as const }}>
                      {c.externalRef ?? '—'}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, color: t.accent, fontWeight: 600 }}>
                      {c.kind}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: sans, fontSize: 13, color: t.ink, maxWidth: 320 }}>
                      {c.title}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, color: t.inkSoft }}>
                      {c.datasetSplit}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontFamily: sans,
                          fontWeight: 600,
                          backgroundColor: c.retiredAt ? '#fef2f2' : t.accentSoft,
                          color: c.retiredAt ? '#b91c1c' : t.accent,
                        }}
                      >
                        {c.retiredAt ? 'removed' : 'present'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontFamily: sans,
                          fontWeight: 600,
                          backgroundColor: c.defaultEligible ? t.accentSoft : t.lineSoft,
                          color: c.defaultEligible ? t.accent : t.inkFaint,
                        }}
                      >
                        {c.defaultEligible ? 'yes' : 'no'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontFamily: sans,
                          fontWeight: 600,
                          backgroundColor: c.effectiveEligible ? t.accentSoft : t.lineSoft,
                          color: c.effectiveEligible ? t.accent : t.inkFaint,
                        }}
                      >
                        {c.effectiveEligible ? 'yes' : 'no'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <CaseEligibilityControl caseId={c.caseId} current={c.eligibleOverride} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run tsc**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

---

## Task 9: Admin UI — competitors page + CompetitorToggle

**Files:**
- Modify: `src/app/(admin)/competitors/page.tsx`
- Create: `src/app/(admin)/competitors/CompetitorToggle.tsx`

**Interfaces:**
- Consumes: `listCompetitorsWithStatus` (Task 5)
- Client toggle → POST /api/competitors/enabled

- [ ] **Step 1: Create `src/app/(admin)/competitors/CompetitorToggle.tsx`**

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, sans } from '@/ui/tokens';

interface Props {
  competitorId: string;
  enabled: boolean;
}

export default function CompetitorToggle({ competitorId, enabled: initialEnabled }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  const handleChange = async (next: boolean) => {
    setEnabled(next);
    setSaving(true);
    try {
      await fetch('/api/competitors/enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitor_id: competitorId, enabled: next }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: saving ? 'not-allowed' : 'pointer',
        fontFamily: sans,
        fontSize: 12,
        color: enabled ? t.accent : t.inkFaint,
        userSelect: 'none' as const,
      }}
    >
      <input
        type="checkbox"
        checked={enabled}
        disabled={saving}
        onChange={e => handleChange(e.target.checked)}
        style={{ accentColor: t.accent, cursor: saving ? 'not-allowed' : 'pointer' }}
      />
      {enabled ? 'Enabled' : 'Disabled'}
    </label>
  );
}
```

- [ ] **Step 2: Replace `src/app/(admin)/competitors/page.tsx`**

Replace import of `listCompetitorVersions` with `listCompetitorsWithStatus`, restructure the table to show one row per competitor with enabled toggle:

```typescript
import { requireUser, requireRole } from '@/auth/workos';
import { listCompetitorsWithStatus } from '@/services/admin';
import { t, sans, mono } from '@/ui/tokens';
import CompetitorToggle from './CompetitorToggle';

export default async function CompetitorsPage() {
  const user = await requireUser();

  try {
    requireRole(user, 'admin');
  } catch {
    return (
      <div style={{ color: '#b91c1c', fontFamily: sans, fontSize: 14 }}>
        Insufficient role — analyst, operator, or admin required.
      </div>
    );
  }

  const competitors = await listCompetitorsWithStatus();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: t.ink, fontFamily: sans }}>
          Competitors
        </h1>
        <span style={{ fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
          {competitors.length} competitors
        </span>
      </div>

      <div
        style={{
          backgroundColor: t.card,
          border: `1px solid ${t.line}`,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {competitors.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: t.inkFaint, fontFamily: sans, fontSize: 14 }}>
            No competitors found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.line}`, backgroundColor: t.lineSoft }}>
                  {['Name', 'Versions', 'Latest model', 'Enabled'].map(col => (
                    <th
                      key={col}
                      style={{
                        padding: '10px 14px',
                        textAlign: 'left' as const,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase' as const,
                        color: t.inkFaint,
                        fontFamily: sans,
                        whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {competitors.map((comp, i) => (
                  <tr
                    key={comp.competitorId}
                    style={{
                      borderBottom: i < competitors.length - 1 ? `1px solid ${t.lineSoft}` : 'none',
                      backgroundColor: i % 2 === 0 ? t.card : '#FAFAF8',
                    }}
                  >
                    <td style={{ padding: '10px 14px', fontFamily: sans, fontSize: 13, fontWeight: 600, color: t.ink }}>
                      {comp.name}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, color: t.accent, fontWeight: 600 }}>
                      {comp.versionCount}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, color: t.inkSoft }}>
                      {comp.latestModelIdentifier ?? <span style={{ color: t.inkFaint }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <CompetitorToggle
                        competitorId={comp.competitorId}
                        enabled={comp.enabled}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run tsc**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

---

## Task 10: Admin UI — generate page + GenerateMissingButton

**Files:**
- Modify: `src/app/(admin)/generate/page.tsx`
- Create: `src/app/(admin)/generate/GenerateMissingButton.tsx`

**Interfaces:**
- Consumes: existing `GenerateButton` (stays)
- New: `GenerateMissingButton` → POST /api/generate/missing with `{ campaign_id }`, shows `{ generated, skipped, failed, total }`

- [ ] **Step 1: Create `src/app/(admin)/generate/GenerateMissingButton.tsx`**

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, sans } from '@/ui/tokens';

interface Props {
  campaignId: string;
}

interface MissingResult {
  generated: number;
  skipped: number;
  failed: number;
  total: number;
}

export default function GenerateMissingButton({ campaignId }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<MissingResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleGenerate = async () => {
    setStatus('running');
    setResult(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/generate/missing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setErrorMsg(body.error?.message ?? 'Request failed');
        setStatus('error');
        return;
      }

      const data = (await res.json()) as MissingResult;
      setResult(data);
      setStatus('done');
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  };

  const isRunning = status === 'running';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        onClick={handleGenerate}
        disabled={isRunning}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 20px',
          borderRadius: 6,
          border: 'none',
          backgroundColor: isRunning ? t.lineSoft : t.accent,
          color: isRunning ? t.inkFaint : '#fff',
          fontFamily: sans,
          fontSize: 13,
          fontWeight: 600,
          cursor: isRunning ? 'not-allowed' : 'pointer',
          letterSpacing: '0.03em',
          alignSelf: 'flex-start',
        }}
      >
        {isRunning ? 'Generating…' : 'Generate all missing (eligible)'}
      </button>

      {status === 'done' && result && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: t.accentSoft,
            borderRadius: 6,
            fontSize: 13,
            fontFamily: sans,
            color: t.accent,
          }}
        >
          Done — {result.generated} generated, {result.skipped} skipped, {result.failed} failed
          {' '}(total {result.total} cells).
        </div>
      )}

      {status === 'error' && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: '#fef2f2',
            borderRadius: 6,
            fontSize: 13,
            fontFamily: sans,
            color: '#b91c1c',
          }}
        >
          Error: {errorMsg}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `src/app/(admin)/generate/page.tsx`**

Add the `GenerateMissingButton` section below the existing `GenerateButton` section. The generate page imports `GenerateMissingButton` and renders it in a new card:

In `src/app/(admin)/generate/page.tsx`, add this import at the top:
```typescript
import GenerateMissingButton from './GenerateMissingButton';
```

And add this JSX block after the existing `GenerateButton` card div and before the `{/* Status */}` section:

```typescript
      {/* Generate missing (eligibility-aware) */}
      <div
        style={{
          backgroundColor: t.card,
          border: `1px solid ${t.line}`,
          borderRadius: 8,
          padding: 24,
          marginBottom: 28,
        }}
      >
        <h2
          style={{
            margin: '0 0 6px',
            fontSize: 15,
            fontWeight: 700,
            color: t.ink,
            fontFamily: sans,
          }}
        >
          Generate missing (eligibility-aware)
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: t.inkSoft, fontFamily: sans }}>
          Resolves eligible cases × enabled competitors from campaign config. Only generates truly
          missing cells — already-cached cells are skipped. Returns generated / skipped / failed
          counts.
        </p>
        {defaultCampaign ? (
          <GenerateMissingButton campaignId={defaultCampaign.id} />
        ) : (
          <span style={{ fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
            No campaign available.
          </span>
        )}
      </div>
```

- [ ] **Step 3: Run tsc**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

---

## Task 11: Final verification + report

**Files:**
- Create: `.superpowers/sdd/eligibility-feature-report.md`

- [ ] **Step 1: Run full type check**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 2: Apply migrations to test DB (global-setup handles this in vitest, but confirm dev DB is current)**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npm run db:migrate
```

Expected: exits 0.

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx vitest run 2>&1 | tail -40
```

Expected: all tests pass (green).

- [ ] **Step 4: Write report to `.superpowers/sdd/eligibility-feature-report.md`**

The report should include:
- Schema migration filename
- All files changed/created
- Shared eligibility resolution approach (isCaseEligible used in battle, enqueueMissingForCampaign, and admin service)
- Test results summary
- tsc result
- Any decisions or tradeoffs

---

## Self-Review Checklist

- [x] Feature B: schema (retiredAt, eligibleOverride on cases) ✓
- [x] Feature B: isCaseEligible domain helper + unit tests ✓
- [x] Feature B: importer reconcile (retire/unretire) + integration test ✓
- [x] Feature B: battle.ts eligibility filter + competitor enabled filter ✓
- [x] Feature C: schema (enabled on competitors) ✓
- [x] Feature C: battle already filters by it (Task 4) ✓
- [x] Feature D: enqueueMissingForCampaign service ✓
- [x] Feature D: POST /api/generate/missing ✓
- [x] Admin APIs: POST /api/cases/eligibility ✓
- [x] Admin APIs: POST /api/competitors/enabled ✓
- [x] Admin services: listCasesWithEligibility, setCaseEligibility, listCompetitorsWithStatus, setCompetitorEnabled ✓
- [x] Admin UI: cases page + CaseEligibilityControl ✓
- [x] Admin UI: competitors page + CompetitorToggle ✓
- [x] Admin UI: generate page + GenerateMissingButton ✓
- [x] All new API routes use requireUser + requireRole(user,'admin') ✓
- [x] snake_case request bodies ✓
- [x] Bounded concurrency (4) in enqueueMissingForCampaign ✓
- [x] case_versions immutable — new columns only on cases ✓
- [x] eligible_override never touched by importer ✓
- [x] Tests: eligibility unit tests (6 branches) ✓
- [x] Tests: importer reconcile test ✓
- [x] Tests: enqueueMissingForCampaign idempotency test ✓
- [x] Tests: battle.test.ts seeds datasetSplit='dev', competitors default enabled=true ✓

**Type consistency check:**
- `isCaseEligible` takes `{ retiredAt: Date | null, eligibleOverride: boolean | null, latestSplit: string }` — used consistently in battle.ts, admin.ts, generate-batch.ts ✓
- `CaseEligibilityControl` receives `caseId: string, current: boolean | null` ✓
- `CompetitorToggle` receives `competitorId: string, enabled: boolean` ✓
- `GenerateMissingButton` receives `campaignId: string` ✓
- `EnqueueMissingResult` has `{ generated, skipped, failed, total }` ✓
- `ImportResult` extended with `retired` and `unretired` ✓
