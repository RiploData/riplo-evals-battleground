# 05 — Task Population Plan

How we fill the arena with cases. This is a plan for _how to get there_, not the case content itself. It adapts the Harvey LAB pattern (filesystem-first, synthetic, schema-validated, PR-reviewed) to our pairwise-preference setting.

## Principles

1. **Synthetic by default.** No real confidential client material in cases. Synthetic companies, funds, people, financials, and matter facts. This is both an ethics/IP requirement and what lets the corpus live in git and be reviewed openly.
2. **Author in git, serve from Postgres.** The case corpus is a versioned directory tree (PR-reviewed, diffable, provenance-tracked). An importer materialises `case_versions` into the DB (schema in `02`). Git is the source of truth for _authoring_; the DB is the source of truth for _runtime and ratings_.
3. **A good case discriminates and represents.** Because we score by human preference, not rubric, case quality = (a) does it split competitors, and (b) is it a faithful slice of real work. Both are measured, not assumed.
4. **Validation is a gate, not a suggestion.** Schema check, integrity check, and a generation smoke test all run before a case is eligible for live battles.
5. **The corpus is curated, not just grown.** Cases are pruned, retired, and retagged based on what the arena reveals. Coverage is managed against a target distribution, not left to whatever got authored.

## Case taxonomy

Mirror Harvey's path-encoded taxonomy, but along _our_ axes:

```
cases/
  <domain>/                 # pe-diligence | market-sizing | offer-factory | ddq | ...
    <kind>/                 # compression | judgment | ...   (maps to case_versions.kind)
      <case-or-workflow>/
        <optional-scenario>/
          case.json
          source/           # synthetic source-material blobs (→ S3 on import)
```

`domain` and `kind` become tags + `kind` on the case version; the suite groups a coherent set for a campaign. Every case carries a `dataset_split` (dev / validation / holdout) so the future optimiser can't overfit the arena.

## Case file format

`case.json` is the authoring form of a `case_version` (see `02` for the DB shape). It separates the three information classes from the PRD: runner input (shared, sent to the model), evaluator display context, and hidden metadata.

```json
{
  "kind": "compression",
  "title": "Compress this diligence memo to its decision-relevant core",
  "guidance": "Reward the version that helps a partner reach a call.",
  "output_spec": {
    "target": "IC one-pager",
    "parts": [
      { "type": "title", "label": "Headline", "note": "one line" },
      { "type": "bullets", "label": "Key supporting points", "note": "3 bullets" }
    ]
  },
  "runner_input": { "instruction": "…", "constraints": "…", "source_ref": "source/memo.md" },
  "source_blocks": [
    { "type": "text", "text": "…" },
    { "type": "bullets", "items": ["…"] }
  ],
  "hidden_metadata": { "domain": "pe-diligence", "difficulty": "medium", "expected_compression_ratio": 0.2, "failure_modes": ["over-recall"] },
  "tags": ["pe-diligence", "due-diligence", "compression"],
  "dataset_split": "dev",
  "rubric_notes": ["Should foreground key-person risk and the growth-bridge gap."]
}
```

`rubric_notes` is **optional** and is _not_ the scoring mechanism — it's authoring discipline (forces the author to know what "good" looks like), rater guidance if we choose to surface it, and seed material for a future LLM-judge validation (the deferred non-goal). We borrow Harvey's "name the required fact / failure mode" rigour here without adopting absolute scoring.

## Sourcing — three streams

**Stream A — archetypes from existing Riplo workflows (start here).** Your skills (`ai-dd-slides`, `market-sizing`, `capgemini-ai-offer-factory`, `ddq-generator`, `content-architect`) and your past deliverables already encode the task archetypes — what a real compression or judgment task looks like, what the output should be, what good looks like. Mine these for the _shapes_: task framing, output specs, typical source structure. This is the fastest route to representative cases.

**Stream B — synthetic instance generation (the scalable engine).** For each archetype, generate synthetic source material (diligence memos, data-room snippets, financials, market notes) at controlled domain, difficulty, and length, with synthetic facts. This is itself an AI task: a generator takes an archetype template + parameters and drafts source + task framing; a human vets it. This is how the corpus scales past hand-authoring without touching client data.

**Stream C — harvested-and-sanitised real deliverables (highest fidelity, slowest).** Take real past engagements, strip and replace all identifying facts with synthetic equivalents, and reshape into cases. Highest realism, most effort, most care required. Use sparingly for high-value archetypes where synthetic instances feel thin.

Phasing: A seeds the loop; B becomes the workhorse; C fills fidelity gaps.

## Authoring → validation → import pipeline

```
author (git PR)  →  CI gates  →  merge  →  importer  →  DB case_versions  →  eligible for battles
```

Gates, mirroring Harvey's `describe_task` / integrity-test / smoke-run discipline:

1. **Schema validation (CI).** `case.json` conforms; required fields present; source refs resolve; `dataset_split` valid. (Harvey runs this exact kind of check in a GitHub Action.)
2. **Integrity check.** Has source material; `output_spec` is well-formed; the task is actually answerable from the source; no real-data leakage heuristics (names/domains flagged for review).
3. **Generation smoke test.** Run 2–3 competitor versions against the case. Fail/flag if outputs are empty, malformed against `output_spec`, or _trivially identical_ — the last is the discrimination pre-check: if even different setups produce the same thing, the case won't generate ELO signal.
4. **Human review (PR).** A reviewer who knows the domain confirms it represents real work and that `rubric_notes` are honest. Small, focused PRs.

The importer is idempotent and content-addressed: re-importing an unchanged case is a no-op; an edited case creates a new `case_version` (never mutates), preserving the invariant that ratings never rest on a case that changed underneath them.

## The curation loop (Riplo-specific, Phase 2)

This is what Harvey doesn't need and we do. Once cases are live, feed arena results back into the corpus:

- **Discrimination score per case** — do votes split, or does one competitor always win / always tie? Low-discrimination cases are flagged for retirement or for difficulty re-tuning.
- **Representativeness check** — coverage against the target distribution (domain × kind × difficulty). Surface gaps ("we have 40 compression cases but 3 judgment cases in market-sizing").
- **Failure-slice extraction** — segments where competitors cluster or where rewrites pile up become the seed for new authoring and, later, for the optimisation run's development set.
- **Retire, don't delete** — low-signal cases are marked retired (kept for provenance), never removed, so historical ratings stay reproducible.

The loop: author → validate → battle → measure discrimination & coverage → curate → author the gaps.

## Coverage targets and phasing

| Phase                    | Goal                                             | Rough scope                                                                                 |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **0 — Seed**             | Make the loop real end-to-end                    | ~20–30 hand-authored dev cases from Stream A, 2–3 kinds, 2 domains                          |
| **1 — Pipeline**         | Git→CI→importer→DB working; first curated corpus | ~80–120 cases; dev/validation/holdout split established; Stream B generator prototyped      |
| **2 — Curation**         | Discrimination + coverage loop running           | Prune low-signal cases; target distribution defined and tracked; Stream B is the workhorse  |
| **3 — Scale & feedback** | Corpus feeds the optimisation phase              | Synthetic generation at volume; failure slices wired into optimisation-run development sets |

Hold validation and holdout cases out of routine battling — they exist to test promoted prompt variants without arena overfitting.

## Roles and cadence

- **Operators/engineers** own the pipeline, schema, importer, and generator.
- **Domain reviewers** (consultants who know what good looks like) own PR review and `rubric_notes` honesty — this is where Riplo's edge lives; the corpus is only as good as the judgment encoded in it.
- **Cadence:** a regular authoring + curation pass (e.g. weekly early on), driven by the coverage gaps and failure slices the arena surfaces.

## Decision to make before building

**Git-authored corpus + importer (recommended) vs. author cases directly in an app admin UI.** Git gives version control, PR review, diffability, and auditable synthetic-data provenance — the same reasons Harvey is filesystem-first — at the cost of being less friendly to non-engineer authors. An in-app authoring UI is faster for consultants but loses git's review/versioning. Recommendation: git + importer for v1, add a lightweight authoring UI later that writes to the same git-backed format (or to the DB with the same gates). Pin this before building the pipeline, because it determines where the gates live.
