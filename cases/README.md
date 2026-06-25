# cases/ — Riplo eval corpus (Stream A seed)

Path-encoded taxonomy: `cases/<domain>/<kind>/<case-slug>/case.json`. Each `case.json` is self-contained — the source material is embedded in `source_blocks`, so a case is fully battle-ready with no external file.

- **domains:** pe-diligence · market-sizing · offer-factory · ddq · cross
- **kinds:** compression · de-slop · action-title · pyramid-restructure · register-switch · earned-antithesis · comparable · judgment · dependency-naming · synthesis-title-test
- **suite:** "Riplo Consulting v1"
- **dataset_split:** dev (iterate) · validation (test promoted variants) · holdout (never battled routinely)

All companies, people, funds and figures are **synthetic**. The pe-diligence cases share a consistent invented target (Halden, a food-safety standards SaaS — see `eval-source_project-saffron-storyline.md` for the full storyline they were sliced from).

Schema per case.json: `kind`, `title`, `guidance`, `output_spec{target,parts}`, `runner_input{instruction,constraints}`, `source_blocks[]`, `hidden_metadata{domain,difficulty,failure_modes}`, `tags[]`, `dataset_split`, `rubric_notes[]`, `suite`.

`rubric_notes` is authoring discipline + future LLM-judge seed — NOT the scoring mechanism (scoring stays pairwise-preference).
