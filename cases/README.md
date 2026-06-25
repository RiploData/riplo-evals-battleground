# cases/ — Riplo eval corpus (rev 2)

Clean rebuild per review. Path-encoded: `cases/<domain>/<kind>/<slug>/case.json`. Same self-contained schema as before (source embedded in `source_blocks`) — nothing new added to the file shape.

40 cases, all `dataset_split: dev`. Domains: pe-diligence, market-sizing, ddq, cross (offer-factory removed). Kinds: compression, action-title, de-slop, pyramid-restructure, register-switch, judgment(confidence). Removed: comparable, earned-antithesis, synthesis-title-test, dependency-naming.

Volumes: compression 14 (10 single-bullet + 4 one-pager) · action-title 8 · de-slop 6 · pyramid 4 · register-switch 4 · judgment-confidence 4.

Two rules applied throughout:
1. `constraints` are OUTPUT FORMAT ONLY — no language guidance (no 'avoid em-dashes', no banned words). Whether the model produces clean MBB language unprompted is the thing being tested.
2. The quality bar lives in `guidance` (rater-facing) and `rubric_notes` (hidden). Output formats are standardised markdown (single bullet / title only / title+3 bullets / nested bullets / table).

This corpus replaced the original `cases/` tree (rev 1) as the new starting point.
