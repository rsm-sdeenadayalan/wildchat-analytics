# Launch notes and retrospective

**What this is for:** Record what Loupe shipped, what was cut, what the launch checks found, and what a next run should do differently, without smoothing over what did not work.
**Date:** 2026-09-20
**Status:** Draft

## What shipped

- Five-stage pipeline (flatten, sample, label, classify, metrics) under `loupe/stages/`, 70-plus unit tests, CI on every push. 2026-09-20.
- Full flatten of all 86 WildChat-4.8M shards, 3,199,860 conversations, cached content-free. 2026-09-20.
- Committed aggregate set under `aggregates/*.parquet`, about 80 KB, regenerable from one command. 2026-09-20.
- Public dashboard, six views (Overview, Intensity, Intent, Friction, Data quality, Query) over DuckDB-WASM: `https://rsm-sdeenadayalan.github.io/wildchat-analytics/`. 2026-09-20.
- Case-study pages rendered from the PM artifacts under `/docs/` on the same site. 2026-09-20.
- Seven PM artifacts plus this memo and retrospective: `docs/pm/01-opportunity-brief.md` through `docs/pm/09-retro.md`. 2026-09-20.
- Research kits for interviews, usability testing, and friction labeling under `docs/pm/research/`, unused this round, ready for the next. 2026-09-20.
- Three validation scripts: `check_docs.py`, `check_report.py` (38/38 passing), `friction_precision.py`; a fourth, `score_usability.py`, has nothing to score yet. 2026-09-20.

## What was cut

| Item | Reason at the time | Right call |
|---|---|---|
| Metric authoring UI | A fixed, validated metric set beats a framework to extend before any metric is validated. | Right; extending unvalidated metrics would compound the trust problem. |
| Live log ingestion | v1 is a static, reproducible batch build; continuous refresh is a different product. | Right for v1; revisit before this serves a real team. |
| LLM-as-judge on every response | Cost; friction proxies were meant to do the job more cheaply. | Premature; those proxies turned out unvalidated, so the tradeoff was never tested. |
| Toxicity rates | The public build has toxic conversations removed; a rate would misstate safety. | Right; a number from a filtered corpus would be worse than none. |
| Primary user interviews at v1 | Six were planned; recruiting was outside the project's control. | Mixed; the only option once recruiting failed, but should have been flagged earlier. |
| User-level drill-down | Privacy; the pseudo-user key is pseudonymous personal data. | Right; keep this cut unless the identity model changes. |

## Launch checks

| Check | Result | Date |
|---|---|---|
| `check_report.py`, numbers re-derived from aggregates | 38/38 passed | 2026-09-20 |
| `check_docs.py`, required sections and header | OK | 2026-09-20 |
| `check_site.py`, CDN hosts, relative paths, files | OK | 2026-09-20 |
| CI (`uv run pytest`) | Green | 2026-09-20 |
| GitHub Pages deploy | Succeeded first run | 2026-09-20 |
| Six-item manual browser checklist (render, caveats, banner, Query errors, 400px, dark mode) | Not run; handed to the owner, no pass recorded | 2026-09-20 |
| Intent labeling and classification, 85% accuracy gate | Not run; no API credential on the machine | 2026-09-20 |
| 300-label friction precision, 70% gate | Not run; same missing credential | 2026-09-20 |
| Five-participant usability test (PRD 6.3) | Not run; no recruits in the window | 2026-09-20 |
| Actionability survey (PRD 6.3) | Not run; same recruiting gap | 2026-09-20 |

## What the numbers said

The most surprising finding was the pseudo-user persistence collapse at the 2024 Q3 to Q4 boundary (F1): the share of a quarter's pseudo-users seen in more than one week fell tenfold, from 8.5% to 0.8%, almost certainly a logging change, and it means the north-star metric cannot be trusted across that boundary. The claim that did not survive review was an early draft line describing "clean model handoffs" between eras; the data showed a 28-week stretch where gpt-3.5-turbo and gpt-4 both held at least 20% of weekly volume, so the line was rewritten to describe overlap instead. Both were caught by re-deriving every number against the aggregates before publishing, not by reading the prose.

## What was wrong in the PRD

The intent-labeling configuration as first planned would have exhausted a 64-token output cap, because the default model has thinking enabled and thinking tokens would consume the budget before any label was written; caught in review and fixed by disabling thinking, raising the cap to 256 tokens, and requiring a 50-request canary to parse cleanly first. The return-rate metric as first implemented printed a data gap as a false 0.0 instead of NULL, which would read as churn that never happened; fixed before the trends report was written. A DuckDB sum-over-BIGINT type promotion would have silently broken the dashboard's number formatting; fixed with explicit casts before the aggregates shipped. The five-day estimate became eight working days of actual effort, compressed into four calendar days, which the timeline did not anticipate. Six primary interviews were planned in the PRD's research goal; zero were completed, and the PRD was revised to describe secondary research and an assumptions register instead of leaving that target standing unmet.

## If I did it again

First, confirm the labeling API credential and budget before writing labeling-dependent requirements, such as the intent view and the 85% gate, into the PRD as committed scope rather than pending. Second, schedule friction-labeling and usability-test recruiting in parallel with the pipeline build, not after it, so a recruiting slip does not strand both checks unmeasured at launch. Third, track estimate variance in working days actually spent, not calendar days elapsed, since that is what caught the five-day to eight-day gap only in retrospect.
