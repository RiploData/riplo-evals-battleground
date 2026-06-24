# 01 — Product Requirements

## 1. Summary

Riplo Arena lets an authorised organisation register competing prompt-and-model configurations, generate outputs for a representative set of tasks, present pairs of outputs to human raters in blinded comparisons, and derive rankings with uncertainty. The rankings tell us which configuration produces better consulting output — sharper compression, better judgment of what matters, better tone — and the captured comparisons and human rewrites become a reusable asset for later prompt optimisation.

## 2. Goals and non-goals

**Goals.** Reliable preference data (which output a qualified human finds more useful); reproducibility (know exactly which case, prompt, model, settings and code produced every output); low evaluation friction (one battle is fast and cognitively simple); diagnostic usefulness (explain why a setup wins, not just its rank); a reusable data asset (preserve comparisons and human-authored outputs).

**Non-goals for v1.** Fully autonomous prompt optimisation; public or anonymous crowdsourcing; a universal leaderboard spanning changing task distributions; fine-tuning or RL pipelines; replacing human judgment with an LLM judge; per-rater weighting. Automated graders may come later but must first be validated against human labels.

## 3. Terminology

| Term | Definition |
| --- | --- |
| Evaluation suite | A named collection of cases representing a target use case (a business objective, not a folder of prompts) |
| Suite version | A frozen definition of the suite, its cases, weights, and rubric |
| Case / case version | The logical task; the exact immutable input, display context, and metadata |
| Competitor | A logical approach being ranked, e.g. "Concise consultant v2" or "Human baseline" |
| Competitor version | The exact immutable model + prompt + skill + config (the full execution contract) |
| Campaign | A bounded evaluation using one suite version and a defined set of competitor versions |
| Generation attempt | One execution of a competitor against a case (the API call and its telemetry) |
| Response | The immutable content produced by a model or human |
| Battle | A pairing of two responses to the same case from different competitors |
| Assignment | A battle presented to a particular evaluator with a particular left/right order |
| Judgment | The evaluator's submitted outcome and supporting feedback |
| Ranking run | A versioned calculation over a defined collection of judgments |

A **generation attempt** (the call) is deliberately distinct from a **response** (the artifact): one attempt may fail or be retried; one response participates in many battles; and we may generate several replicates per (case, competitor) because model output is stochastic. Ranking one sample per configuration would rank lucky samples, not configurations.

## 4. The evaluation loop

1. **Author cases.** Each case version separates three kinds of information:
   - *Runner input* — everything supplied to the competing setup: source material, the task instruction, output constraints, optional audience/domain. This is competitor-agnostic and shared across both sides of any battle.
   - *Evaluator display context* — what the rater sees to judge: title, guidance, the output spec ("what we're building"), and the source material needed to check fidelity.
   - *Hidden metadata* — for routing and analysis only, never shown: difficulty, domain, language, expected compression ratio, sensitivity class, known failure category, dataset split, sampling weight.
2. **Register competitor versions.** Immutable. Any change to model, prompt, skill, parameters, or pre/post-processing creates a new version with a lineage pointer to its parent.
3. **Generate.** For each (case version, competitor version) the system records a generation attempt (request, provider response, tokens, cost, latency, seed, finish reason, errors) and, on success, an immutable response. v1 default is one replicate; the schema supports N.
4. **Pair into battles.** Two responses for the same case version from different competitors that have passed rendering/validation and are not duplicates.
5. **Assign and present.** Each presentation persists its exact left/right order and the UI version. Position is randomised per assignment; order is always recorded so side bias is measurable.
6. **Judge.** The rater submits an outcome and optional feedback, and may optionally rewrite.
7. **Rank.** A ranking run fits Bradley–Terry over all valid judgments and writes versioned scores with confidence intervals.

## 5. Rater experience

The reference implementation is `arena-rater-view.jsx`. Specification:

**Layout.** Two equal panes. **Left** is task context: title, one-line guidance, the *What we're building* card (the output's destination and component shape, e.g. "IC one-pager → headline + 3 bullets"), and the source material below, scrolling independently. Source material is a typed block array (text, bullets, and later image/chart) and renders its structure faithfully. **Right** stacks the two responses, A over B, with the action bar pinned beneath.

**Blinding and fairness.** No model, prompt, author, source, or latency information appears on either response. The two panes get visually identical treatment. Which response renders on top is re-randomised every battle; the chosen order is recorded server-side. A "Blinded · randomised" marker is shown so raters trust the fairness. Output length is never displayed.

**Outcomes.** The primary question: *which response better fulfils the task and would be more useful to the intended reader?* Outcomes are distinct and must stay distinct in the data:
- A is better
- B is better
- Effectively equal (tie)
- Both unacceptable
- Cannot assess (skip)

"Tie" means similar quality; "both unacceptable" means an absolute quality failure and must be visible in analytics; "cannot assess" is excluded from ranking.

**Rewrite (the flywheel).** After or instead of a plain vote, the rater may rewrite. They can start *from version A*, *from version B*, or *from scratch*. Starting from A or B records that side as `rewrite_forked_from` — a secondary, behavioural signal (the closer base), not a clean preference label, so it never substitutes for the preference outcome in the rating fit. A rewrite is saved as a new response (`origin_type = post_battle_rewrite`) with lineage to the parents it drew from; it can re-enter future battles, blinded. It never overwrites either original. Triggering a rewrite records the battle outcome as `both_unacceptable` (the "neither was good enough" case) unless a plain outcome was already submitted.

**Interaction.** Keyboard-first: `A` / `B` / `T` (tie) / `R` (rewrite → choose A / B / S). Decision latency and total duration are captured on every judgment. A small session counter shows contribution without gamifying volume.

**Diagnostic reason tags (v1.1).** An optional multi-select shown *after* the choice — e.g. better identification of what matters, better compression without loss, more faithful to source, better tone/audience fit, more actionable, clearer structure, fewer unsupported claims. Shown after the decision so they explain a preference rather than prime one. We deliberately do **not** ask for per-dimension numeric scores; the pairwise winner is the label, the tags explain it.

## 6. Ranking methodology

**Primary method.** Fit a Bradley–Terry (logistic) model over all valid A/B preferences from the relevant judgment set.
- Treat a tie as half a win for each side.
- Exclude "cannot assess" entirely.
- Exclude "both unacceptable" from the relative preference fit, but count it against both competitors' *absolute acceptability* metric.
- Compute bootstrap confidence intervals.
- Optionally transform coefficients onto an Elo-like display scale. Call the feature **Arena rating**, not Elo.

A cheap live/incremental rating may be kept purely to drive the UI and matchmaking, but it is never the source of truth and is always reconcilable to a ranking run.

**Reported per competitor version.** Arena rating; rank and rank range; confidence interval; judgment count; unique case count; distinct evaluator count; tie rate; unacceptable rate; head-to-head win matrix; performance by case segment (tag/kind/difficulty); position split (win rate when shown top vs bottom); response-length distribution (for our own bias-checking — not shown to raters). A single number is never the only view.

**Weighting.** The overall ranking should represent the intended task distribution, not whichever cases happened to attract the most votes. The weighting policy (by case, domain, difficulty, strategic importance) is stored on the suite/campaign version.

## 7. Matchmaking

**v1 — coverage.** Ensure every competitor is connected to several others (a connected comparison graph, so ratings are comparable); balance comparisons across case tags; prioritise pairs with little evidence; avoid showing the same pair to the same evaluator repeatedly. Random selection within those constraints is fine.

**Later — refinement.** Increase comparisons between similarly rated competitors and pairs with wide uncertainty; target weak or important segments; retain occasional cross-tier matches to detect non-transitivity (A>B>C>A cycles, which pure champion-vs-challenger schemes hide). When introducing a new challenger, compare it against the champion, one or more nearby competitors, and at least one materially different competitor, across representative cases.

## 8. Quality controls

Capture enough to diagnose, without auto-penalising raters in v1: left/right preference bias, very fast/inattentive voting, single-outcome overuse, agreement on intentionally repeated battles, disagreement by case type, duplicate/near-duplicate outputs, truncation/render failures, over-dependence on length, and over-exposure of one response to one rater. Preserve raw judgments; surface indicators; allow audited exclusion rules. Sophisticated rater weighting is deferred.

## 9. Roles and permissions

WorkOS authentication, restricted to one organisation (or an allowlist). A local user record maps to the WorkOS subject; application role is stored separately from identity.

| Role | Capabilities |
| --- | --- |
| Evaluator | Complete assigned battles and optional authorship tasks |
| Suite editor | Create and edit draft cases and rubrics |
| Experiment operator | Configure campaigns and generation jobs |
| Analyst | Access raw and aggregated evaluation data |
| Administrator | Manage roles, invalidations, exports, settings |

Raters should not evaluate a response they authored or a competitor they own where that is a material conflict; at minimum, record the relationships so such judgments can be filtered.

## 10. Optimisation workflow (modelled now, built later)

The later, manually-triggered data-science workflow is designed into the schema even though it is not implemented in v1: select a failure segment from the development set; diagnose common losing reasons and human rewrites; generate or author new prompt variants; register each as a new immutable competitor version; run hard checks (formatting, safety, execution); battle variants against parent and champion; validate the best on a separate validation set; run the final promotion test on an untouched holdout; promote without altering the old version. The development / validation / holdout split (stored per case) is what prevents the optimiser from overfitting the arena while appearing to improve.
