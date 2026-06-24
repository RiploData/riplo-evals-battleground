# OpenRouter → Native Anthropic + OpenAI Drivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single OpenRouter adapter with thin native Anthropic and OpenAI SDK drivers, dispatched by `competitor_versions.model_provider`.

**Architecture:** Extract the three provider interface types (`ProviderRequest`, `ProviderResult`, `GenerationProvider`) into a neutral module, then create two native drivers. A dispatch function in `providers/index.ts` picks the right driver from `model_provider`. The `runner.ts` reads `model_provider` from the DB row and calls `providerFor()` when no provider is injected (tests always inject a fake). OpenRouter file and all references to it are deleted.

**Tech Stack:** TypeScript strict, `@anthropic-ai/sdk`, `openai` 5.23.2, Drizzle ORM, Vitest, Next.js 14.

## Global Constraints

- TypeScript strict — no `any`, no implicit `any`, no type assertions except where documented in the spec.
- `GenerationProvider` interface shape is UNCHANGED — tests inject fake providers, runner calls real ones.
- No network calls in tests — fake providers are injected via the existing `provider` parameter.
- `npx tsc --noEmit` must be clean.
- `npx vitest run` must be all green (uses `arena_test` DB on port 5544).
- `grep -rni "openrouter\|OPENROUTER" src tests scripts` must return zero matches after task 6.
- Do NOT create extra documentation files beyond what the spec mandates.

---

### Task 1: Install `@anthropic-ai/sdk` and create neutral provider types module

**Files:**
- Modify: `package.json` (via npm, not manual edit)
- Create: `src/services/generation/provider.ts`

**Interfaces:**
- Produces: `ProviderRequest`, `ProviderResult`, `GenerationProvider` — imported by all downstream tasks.

- [ ] **Step 1: Install the Anthropic SDK**

Run from the project root:
```bash
npm install @anthropic-ai/sdk
```
Expected: package added, no errors.

- [ ] **Step 2: Verify `openai` is already installed**

```bash
grep '"openai"' package.json
```
Expected: `"openai": "5.23.2"` (or similar ≥5.x).

- [ ] **Step 3: Create `src/services/generation/provider.ts` with only the three interfaces**

```typescript
// src/services/generation/provider.ts
// Neutral provider interface — no SDK imports here.

export interface ProviderRequest {
  model: string;
  system: string;
  user: string;
  params: Record<string, unknown>;
}

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  providerRequestId?: string;
  modelReportedVersion?: string;
  raw: unknown;
}

export interface GenerationProvider {
  execute(req: ProviderRequest): Promise<ProviderResult>;
}
```

- [ ] **Step 4: Verify tsc is clean for this file**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit
```
Expected: errors only in files that still import from `openrouter` (that's fine — we're mid-migration). Zero errors in `provider.ts` itself.

---

### Task 2: Anthropic native driver

**Files:**
- Create: `src/services/generation/providers/anthropic.ts`

**Interfaces:**
- Consumes: `ProviderRequest`, `ProviderResult`, `GenerationProvider` from `../provider`
- Produces: `anthropicProvider: GenerationProvider` — imported by `providers/index.ts` in Task 4.

- [ ] **Step 1: Create `src/services/generation/providers/anthropic.ts`**

```typescript
// src/services/generation/providers/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';
import type { GenerationProvider, ProviderRequest, ProviderResult } from '../provider';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const anthropicProvider: GenerationProvider = {
  async execute(req: ProviderRequest): Promise<ProviderResult> {
    const maxTokens = (req.params.max_tokens as number) ?? 4096;

    // Build optional thinking block — ONLY pass if present in params.
    // Do NOT forward temperature, top_p, top_k, or budget_tokens:
    // current Claude models (Opus 4.8 / Sonnet 4.6) reject those with a 400.
    const extraParams: Record<string, unknown> = {};
    if (req.params.thinking !== undefined) {
      extraParams.thinking = req.params.thinking;
    }

    const resp = await client.messages.create({
      model: req.model,
      max_tokens: maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      ...extraParams,
    });

    const text = resp.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      finishReason: resp.stop_reason ?? 'unknown',
      providerRequestId: resp.id,
      modelReportedVersion: resp.model,
      raw: resp,
    };
  },
};
```

- [ ] **Step 2: Verify tsc sees no errors in this file**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1 | grep anthropic
```
Expected: no errors mentioning `anthropic.ts`.

---

### Task 3: OpenAI native driver

**Files:**
- Create: `src/services/generation/providers/openai.ts`

**Interfaces:**
- Consumes: `ProviderRequest`, `ProviderResult`, `GenerationProvider` from `../provider`
- Produces: `openAIProvider: GenerationProvider` — imported by `providers/index.ts` in Task 4.

- [ ] **Step 1: Create `src/services/generation/providers/openai.ts`**

```typescript
// src/services/generation/providers/openai.ts
import OpenAI from 'openai';
import type { GenerationProvider, ProviderRequest, ProviderResult } from '../provider';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const openAIProvider: GenerationProvider = {
  async execute(req: ProviderRequest): Promise<ProviderResult> {
    // Newer OpenAI models (gpt-5, o-series) use max_completion_tokens.
    // Accept either param name from req.params for flexibility.
    const maxCompletionTokens =
      (req.params.max_tokens as number | undefined) ??
      (req.params.max_completion_tokens as number | undefined) ??
      4096;

    // Build optional params — do NOT force a temperature because gpt-5/o-series
    // only accept the default value. Only forward if explicitly present.
    const extraParams: Record<string, unknown> = {};
    if (req.params.temperature !== undefined) {
      extraParams.temperature = req.params.temperature;
    }

    const resp = (await client.chat.completions.create({
      model: req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      max_completion_tokens: maxCompletionTokens,
      stream: false,
      ...extraParams,
    })) as OpenAI.Chat.Completions.ChatCompletion;

    const text = resp.choices[0]?.message?.content ?? '';

    return {
      text,
      inputTokens: resp.usage?.prompt_tokens ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
      finishReason: resp.choices[0]?.finish_reason ?? 'unknown',
      providerRequestId: resp.id,
      modelReportedVersion: resp.model,
      raw: resp,
    };
  },
};
```

- [ ] **Step 2: Verify tsc sees no errors in this file**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1 | grep "providers/openai"
```
Expected: no errors mentioning `providers/openai.ts`.

---

### Task 4: Dispatch index — `providers/index.ts`

**Files:**
- Create: `src/services/generation/providers/index.ts`

**Interfaces:**
- Consumes: `anthropicProvider` from `./anthropic`, `openAIProvider` from `./openai`, types from `../provider`
- Produces: `providerFor(modelProvider: string): GenerationProvider` — used by `runner.ts` in Task 5.
- Also re-exports `ProviderRequest`, `ProviderResult`, `GenerationProvider` for convenience so callers only need one import path.

- [ ] **Step 1: Create `src/services/generation/providers/index.ts`**

```typescript
// src/services/generation/providers/index.ts
export type { GenerationProvider, ProviderRequest, ProviderResult } from '../provider';
export { anthropicProvider } from './anthropic';
export { openAIProvider } from './openai';

import type { GenerationProvider } from '../provider';
import { anthropicProvider } from './anthropic';
import { openAIProvider } from './openai';

export function providerFor(modelProvider: string): GenerationProvider {
  switch (modelProvider) {
    case 'anthropic':
      return anthropicProvider;
    case 'openai':
      return openAIProvider;
    default:
      throw new Error(`Unknown model_provider: ${modelProvider}`);
  }
}
```

- [ ] **Step 2: Quick tsc check**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1 | grep "providers/index"
```
Expected: no errors.

---

### Task 5: Update `runner.ts` — read `modelProvider` from DB, dispatch via `providerFor`

**Files:**
- Modify: `src/services/generation/runner.ts`

**Interfaces:**
- Consumes: `GenerationProvider`, `ProviderRequest` from `./provider` (direct, not through openrouter)
- Consumes: `providerFor` from `./providers`
- The `ensureResponse` signature changes: `provider?: GenerationProvider` (optional, no default). When omitted, dispatch via `providerFor(competitorVersion.modelProvider)`.

- [ ] **Step 1: Read the current file to confirm line numbers**

The file is at `/Users/zackzornitta/dev/riplo-evals-battleground/src/services/generation/runner.ts`. Current line 1–14 has the imports including `openRouterProvider`.

- [ ] **Step 2: Replace the import block at the top of `runner.ts`**

Replace lines 1–14 (the import block) from:
```typescript
import { eq, and } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  generationAttempts,
  responses,
  caseVersions,
  competitorVersions,
} from '@/db/schema';
import { contentHash } from '@/domain/content-hash';
import {
  openRouterProvider,
  type GenerationProvider,
  type ProviderRequest,
} from './providers/openrouter';
```
to:
```typescript
import { eq, and } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  generationAttempts,
  responses,
  caseVersions,
  competitorVersions,
} from '@/db/schema';
import { contentHash } from '@/domain/content-hash';
import type { GenerationProvider, ProviderRequest } from './provider';
import { providerFor } from './providers';
```

- [ ] **Step 3: Update the DB select to also fetch `modelProvider`**

In the `ensureResponse` function, find the competitor version select (currently fetches `modelIdentifier`, `promptBundleJson`, `modelParametersJson`) and add `modelProvider`:

```typescript
  const [competitorVersion] = await db
    .select({
      modelIdentifier: competitorVersions.modelIdentifier,
      modelProvider: competitorVersions.modelProvider,
      promptBundleJson: competitorVersions.promptBundleJson,
      modelParametersJson: competitorVersions.modelParametersJson,
    })
    .from(competitorVersions)
    .where(eq(competitorVersions.id, competitorVersionId))
    .limit(1);
```

- [ ] **Step 4: Add a guard for missing `modelProvider` and resolve the active provider**

After the existing `modelIdentifier` guard (currently around line 100–103), add:

```typescript
  if (!competitorVersion.modelProvider) {
    throw new Error(`Competitor version ${competitorVersionId} has no model_provider`);
  }

  const activeProvider = provider ?? providerFor(competitorVersion.modelProvider);
```

Then replace the `provider.execute(request)` call at line 136 with `activeProvider.execute(request)`.

- [ ] **Step 5: Update the `ensureResponse` signature — remove the default `openRouterProvider`**

Change the function signature from:
```typescript
export async function ensureResponse(
  caseVersionId: string,
  competitorVersionId: string,
  replicateIndex: number = 0,
  campaignId?: string,
  provider: GenerationProvider = openRouterProvider,
): Promise<{ responseId: string }>
```
to:
```typescript
export async function ensureResponse(
  caseVersionId: string,
  competitorVersionId: string,
  replicateIndex: number = 0,
  campaignId?: string,
  provider?: GenerationProvider,
): Promise<{ responseId: string }>
```

- [ ] **Step 6: Run tsc to verify runner.ts is clean**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit 2>&1 | grep "runner"
```
Expected: no errors in `runner.ts`.

---

### Task 6: Update all importers + delete `openrouter.ts`

**Files:**
- Modify: `src/services/generate-batch.ts`
- Modify: `src/services/battle.ts`
- Modify: `scripts/seed-dev-responses.ts`
- Modify: `tests/integration/battle.test.ts`
- Modify: `tests/integration/generation.test.ts`
- Modify: `tests/integration/generate-batch.test.ts`
- Delete: `src/services/generation/providers/openrouter.ts`

**Interfaces:**
- All files change their type imports from `@/services/generation/providers/openrouter` → `@/services/generation/provider` (for types only).
- `openRouterProvider` references are removed everywhere; callers pass `undefined` or a fake — never reference the openrouter provider.

- [ ] **Step 1: Update `src/services/generate-batch.ts`**

Replace:
```typescript
import type { GenerationProvider } from '@/services/generation/providers/openrouter';
import { openRouterProvider } from '@/services/generation/providers/openrouter';
```
with:
```typescript
import type { GenerationProvider } from '@/services/generation/provider';
```

Also change the `enqueueGeneration` signature default:
```typescript
// FROM:
export async function enqueueGeneration(
  _user: SessionUser,
  body: EnqueueBody,
  provider: GenerationProvider = openRouterProvider,
): Promise<EnqueueResult>

// TO:
export async function enqueueGeneration(
  _user: SessionUser,
  body: EnqueueBody,
  provider?: GenerationProvider,
): Promise<EnqueueResult>
```

And update the `ensureResponse` call inside the function — it already passes `provider` as the 5th argument, so no change needed there (passing `undefined` is fine since `ensureResponse` now dispatches internally).

- [ ] **Step 2: Update `src/services/battle.ts`**

Replace:
```typescript
import type { GenerationProvider } from '@/services/generation/providers/openrouter';
```
with:
```typescript
import type { GenerationProvider } from '@/services/generation/provider';
```

No other changes needed — `battle.ts` only uses the type, not the `openRouterProvider` value.

- [ ] **Step 3: Update `scripts/seed-dev-responses.ts`**

Replace:
```typescript
import type { GenerationProvider, ProviderResult } from '@/services/generation/providers/openrouter';
```
with:
```typescript
import type { GenerationProvider, ProviderResult } from '@/services/generation/provider';
```

- [ ] **Step 4: Update `tests/integration/battle.test.ts`**

Replace:
```typescript
import type { GenerationProvider, ProviderResult } from '@/services/generation/providers/openrouter';
```
with:
```typescript
import type { GenerationProvider, ProviderResult } from '@/services/generation/provider';
```

- [ ] **Step 5: Update `tests/integration/generation.test.ts`**

Replace:
```typescript
import type { GenerationProvider, ProviderResult } from '@/services/generation/providers/openrouter';
```
with:
```typescript
import type { GenerationProvider, ProviderResult } from '@/services/generation/provider';
```

- [ ] **Step 6: Update `tests/integration/generate-batch.test.ts`**

Replace:
```typescript
import type { GenerationProvider, ProviderResult } from '@/services/generation/providers/openrouter';
```
with:
```typescript
import type { GenerationProvider, ProviderResult } from '@/services/generation/provider';
```

- [ ] **Step 7: Delete `src/services/generation/providers/openrouter.ts`**

```bash
rm /Users/zackzornitta/dev/riplo-evals-battleground/src/services/generation/providers/openrouter.ts
```

- [ ] **Step 8: Grep confirm — zero openrouter references in src/tests/scripts**

```bash
grep -rni "openrouter\|OPENROUTER" \
  /Users/zackzornitta/dev/riplo-evals-battleground/src \
  /Users/zackzornitta/dev/riplo-evals-battleground/tests \
  /Users/zackzornitta/dev/riplo-evals-battleground/scripts
```
Expected: zero matches.

- [ ] **Step 9: Run tsc and vitest**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit
```
Expected: clean (zero errors).

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx vitest run
```
Expected: all tests green.

---

### Task 7: Seed competitor JSON configs

**Files:**
- Modify: `competitors/concise-consultant/versions/v1.json`
- Modify: `competitors/gpt5-baseline/versions/v1.json`

**Goal:** Remove provider-prefixed model IDs and forbidden sampling params; set bare model IDs and correct providers.

- [ ] **Step 1: Overwrite `competitors/concise-consultant/versions/v1.json`**

```json
{
  "model_provider": "anthropic",
  "model_identifier": "claude-opus-4-8",
  "prompt_bundle": {
    "system_prompt_ref": "system.md"
  },
  "model_parameters": {
    "max_tokens": 2048
  },
  "source_type": "manual"
}
```

Note: `temperature`, `top_p` removed — current Claude models reject those params.

- [ ] **Step 2: Overwrite `competitors/gpt5-baseline/versions/v1.json`**

```json
{
  "model_provider": "openai",
  "model_identifier": "gpt-5",
  "prompt_bundle": {
    "system_prompt_ref": "system.md"
  },
  "model_parameters": {
    "max_tokens": 2048
  },
  "source_type": "manual"
}
```

Note: `temperature: 0.7` removed — gpt-5 / o-series only accept the default.

- [ ] **Step 3: Run `cases:validate` to confirm configs pass schema checks**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npm run cases:validate
```
Expected: passes without errors.

---

### Task 8: Env files, smoke script, and README updates

**Files:**
- Modify: `.env.example`
- Modify: `.env` (gitignored local file)
- Modify: `scripts/smoke.ts`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.example` — swap OPENROUTER for native keys**

Remove these lines:
```
# OpenRouter (https://openrouter.ai/keys)
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Add in their place (keep all other sections as-is):
```
# Generation — native drivers (dispatched by model_provider)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

- [ ] **Step 2: Update local `.env` — remove OPENROUTER_*, add blank native keys**

Remove:
```
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Add:
```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

- [ ] **Step 3: Update `scripts/smoke.ts` — skip when BOTH keys are absent**

Replace the `OPENROUTER_API_KEY` check block:
```typescript
  // Check for required API key
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('SKIP: OPENROUTER_API_KEY is not set. Smoke test requires a live API key.');
    console.log('      Set OPENROUTER_API_KEY and re-run to execute live generation.');
    process.exit(0);
  }
```

with:
```typescript
  // Skip if neither native provider key is set.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.log('SKIP: Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set.');
    console.log('      Set at least one to execute live generation smoke test.');
    process.exit(0);
  }
```

- [ ] **Step 4: Update `README.md` — replace OpenRouter references**

Update the "Configuring `.env`" table row:

From:
```
| `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` | Live generation via OpenRouter (routes Anthropic + OpenAI models by `model_identifier`). |
```
To:
```
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Live generation via direct Anthropic + OpenAI drivers (dispatched by `model_provider` on the competitor version). |
```

Update step 5 in "First 5 minutes":

From:
```
# 5. (Optional, no OpenRouter key needed) generate placeholder responses so the
#    battle loop is immediately clickable. Skip this once you set OPENROUTER_API_KEY
#    — real responses are then generated lazily on first battle.
```
To:
```
# 5. (Optional, no API keys needed) generate placeholder responses so the
#    battle loop is immediately clickable. Skip this once you set ANTHROPIC_API_KEY
#    or OPENAI_API_KEY — real responses are then generated lazily on first battle.
```

Update the `cases:smoke` row in the Commands table:

From:
```
| `npm run cases:smoke` | Generation smoke test (needs `OPENROUTER_API_KEY`). |
```
To:
```
| `npm run cases:smoke` | Generation smoke test (needs `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`). |
```

Update the generation line in "Deployment notes":

From:
```
- **Generation:** set `OPENROUTER_API_KEY`. Attempts are already written as queued rows, so swapping to an async worker that drains them is a consumer change.
```
To:
```
- **Generation:** set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`. Drivers are dispatched by `model_provider` on each competitor version. Attempts are already written as queued rows, so swapping to an async worker is a consumer change.
```

Also update `src/services/` description line in "Project layout":

From:
```
  services/  DB-touching use cases: cases · competitors · campaigns · generation (OpenRouter) · battle · vote · ranking · reports · export
```
To:
```
  services/  DB-touching use cases: cases · competitors · campaigns · generation (Anthropic + OpenAI, dispatched by model_provider) · battle · vote · ranking · reports · export
```

- [ ] **Step 5: Final grep-clean check**

```bash
grep -rni "openrouter\|OPENROUTER" \
  /Users/zackzornitta/dev/riplo-evals-battleground/src \
  /Users/zackzornitta/dev/riplo-evals-battleground/tests \
  /Users/zackzornitta/dev/riplo-evals-battleground/scripts \
  /Users/zackzornitta/dev/riplo-evals-battleground/README.md \
  /Users/zackzornitta/dev/riplo-evals-battleground/.env.example
```
Expected: zero matches.

---

### Task 9: Write SDD report and final verification

**Files:**
- Create: `/Users/zackzornitta/dev/riplo-evals-battleground/.superpowers/sdd/adapter-change-report.md`

- [ ] **Step 1: Run final tsc**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx tsc --noEmit
```
Record the output.

- [ ] **Step 2: Run full vitest suite**

```bash
cd /Users/zackzornitta/dev/riplo-evals-battleground && npx vitest run
```
Record pass/fail counts and any failures.

- [ ] **Step 3: Run final grep-clean**

```bash
grep -rni "openrouter\|OPENROUTER" \
  /Users/zackzornitta/dev/riplo-evals-battleground/src \
  /Users/zackzornitta/dev/riplo-evals-battleground/tests \
  /Users/zackzornitta/dev/riplo-evals-battleground/scripts
```
Expected: zero matches.

- [ ] **Step 4: Write the report to `.superpowers/sdd/adapter-change-report.md`**

Create the directory if needed: `mkdir -p /Users/zackzornitta/dev/riplo-evals-battleground/.superpowers/sdd`

Write a report covering:
- Files changed (list with one-line descriptions)
- How dispatch works (providerFor switch on model_provider string)
- Anthropic SDK call pattern (no temperature, optional thinking block, text block join)
- OpenAI SDK call pattern (max_completion_tokens, conditional temperature, cast to ChatCompletion)
- tsc result (clean / errors found)
- vitest result (pass count, any failures)
- grep-clean confirmation (zero / residual matches)
- Any concerns or follow-up items

---

## Self-review

**Spec coverage check:**

| Spec Step | Covered by Task |
|---|---|
| 0. npm install @anthropic-ai/sdk | Task 1 Step 1 |
| 1. provider.ts neutral interfaces | Task 1 Step 3 |
| 2. Anthropic driver | Task 2 |
| 3. OpenAI driver | Task 3 |
| 4. providers/index.ts dispatch | Task 4 |
| 5. runner.ts — modelProvider DB select, providerFor dispatch | Task 5 |
| 6. Delete openrouter + update importers | Task 6 |
| 7. Seed competitor JSON configs | Task 7 |
| 8. Env + docs + smoke updates | Task 8 |
| Verify tsc + vitest + grep | Task 6 Step 9, Task 9 |
| Write report | Task 9 Step 4 |

**Placeholder scan:** No TBD/TODO placeholders. All code steps show actual code. All command steps show exact commands with expected output.

**Type consistency:**
- `GenerationProvider`, `ProviderRequest`, `ProviderResult` defined once in `provider.ts`, imported everywhere else.
- `providerFor` returns `GenerationProvider` — matches what `ensureResponse`'s `activeProvider` variable expects.
- `anthropicProvider` and `openAIProvider` both implement `GenerationProvider.execute(req: ProviderRequest): Promise<ProviderResult>`.
- `enqueueGeneration` passes `provider` (possibly `undefined`) to `ensureResponse` as the 5th arg — `ensureResponse` accepts `provider?: GenerationProvider` — no type mismatch.
