# Skills

Git-authored Agent Skills used by `execution_mode: "skill"` competitors. Each skill
runs inside the **provider's own hosted sandbox** — we never provision or manage a
container. Anthropic runs an Agent Skill via the Messages API `container.skills`
loop; OpenAI runs the closest hosted analog via a code-interpreter `auto` container
on the Responses API.

## Layout

```
skills/
  <skill-name>/
    SKILL.md                 # YAML frontmatter (name, description) + the guide body
    references/              # optional deep-reference files, read on demand
      *.md
```

`SKILL.md` is required and must sit at the skill root. Reference paths cited inside
`SKILL.md` (e.g. `references/de-slop-flags.md`) must resolve against this folder —
the importer and uploaders read the tree exactly as laid out here.

## How a skill becomes a competitor

1. Author the skill folder here.
2. Register it with the providers: `npm run skills:upload` → writes provider handles
   to `config/skill-registry.json` (commit it).
3. Add a competitor version that points at the skill:

   ```jsonc
   // competitors/<slug>/versions/v1.json
   {
     "model_provider": "anthropic",          // or "openai"
     "model_identifier": "claude-opus-4-8",
     "execution_mode": "skill",
     "prompt_bundle": { "skill_ref": "mbb-language" },
     "model_parameters": { "max_tokens": 4096 },
     "source_type": "manual"
   }
   ```
4. `npm run seed` imports it. The competitor version's content hash folds in the
   skill's content hash, so editing the skill produces a new immutable version.

That's the whole extension path: **new skill = a folder + `skills:upload`; new
skillful competitor = one version JSON.** Adding a new *provider* = implement a
`SkillUploader` (`src/services/skills/uploaders/`) and a `SkillExecutor`
(`src/services/generation/skill-executors/`) and register each in its `index.ts`.

## Commands

| Command | What it does |
|---|---|
| `npm run skills:dryrun` | Probes whether the API keys can run the skill loops (code-execution beta, Skills API, OpenAI code-interpreter). No uploads, no persistence. Run this first. |
| `npm run skills:upload` | Uploads every skill to every provider; idempotent (re-uploads only on content change). |
| `npm run skills:upload -- --skills mbb-language --providers anthropic` | Scope to specific skills/providers. |
| `npm run skills:upload -- --force` | Re-upload even when unchanged. |

All three need the relevant keys in the environment (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`).

## Updating a skill and re-uploading to the platforms

1. Edit files under `skills/<name>/`.
2. `npm run skills:upload` — the content hash changed, so:
   - **Anthropic:** a new *version* is created on the existing skill (`skills.versions.create`); the skill ID is stable, the version bumps.
   - **OpenAI:** the reference files are re-uploaded (new file IDs) and the previous build's files are best-effort deleted.
   - `config/skill-registry.json` is rewritten with the new handles — **commit it**.
3. `npm run seed` — skillful competitors that reference the skill get a new immutable
   competitor version (their content hash includes the skill's). Prior versions and
   any responses already generated against them are untouched.

> Re-running `skills:upload` with no edits is a no-op (`unchanged`), so it's safe to
> run any time. The manifest is the source of truth the runtime reads — there is no
> live provider call at generation time beyond running the skill itself.

## How each provider runs it (and why they differ)

- **Anthropic — real Agent Skill.** One `beta.messages.create` with
  `container: { skills: [{ type: "custom", skill_id, version }] }` and the
  `code_execution` tool. Anthropic provisions the sandbox, mounts the whole skill,
  and runs progressive disclosure server-side. The skill's `description` triggers it
  naturally — no forced instruction. Our client just re-POSTs on `pause_turn`.

- **OpenAI — hosted-container analog.** OpenAI has no Skills primitive. One
  `responses.create` with `tools: [{ type: "code_interpreter", container: { type: "auto", file_ids } }]`.
  The `SKILL.md` body becomes the request `instructions` (the always-loaded guide);
  the `references/*` files ride on the auto container and the model reads them on
  demand via the code interpreter. OpenAI runs the loop to completion in one call.
  Triggering stays natural — the instructions describe the guide, they don't command
  its use.

This is deliberate: each provider delivers the skill via **its own best-effort
hosted mechanism**, so what we measure is "the skill, as it would actually ship on
that provider," not a lowest-common-denominator flattening.

> **Data retention:** Skills and code execution are **not** ZDR-eligible on either
> provider. Confirm the eval org isn't on zero-data-retention before uploading.
