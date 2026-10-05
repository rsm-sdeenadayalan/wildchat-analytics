# Launch notes and retrospective

**What this is for:** Record what Loupe shipped, what was cut, what the launch checks found, and what a next run should do differently, honestly.
**Date:** 2026-09-20
**Status:** Final

## What shipped

- Five-stage pipeline (flatten, sample, label, classify, metrics) under `loupe/stages/`, 70-plus unit tests, CI on every push. 2026-09-20.
- Full flatten of all 86 WildChat-4.8M shards, 3,199,860 conversations, cached content-free. 2026-09-20.
- Committed aggregate set under `aggregates/*.parquet`, about 80 KB, regenerable from one command. 2026-09-20.
- Public dashboard, five analytic views (Overview, Intensity, Intent, Friction, Data quality), a Built-from-the-data view carrying the routing counterfactual and a live usage-weighted scorer (added 2026-10-03), plus a Query panel, over DuckDB-WASM: `https://loupe.shankard.com/`. 2026-09-20.
- Case-study renderer built and tested; PM artifacts published under `/docs/` on the live site. 2026-09-21.
- Seven PM artifacts plus this memo and retrospective: `docs/pm/01-opportunity-brief.md` through `docs/pm/09-retro.md`. 2026-09-20.
- Research kits for interviews, usability testing, and friction labeling under `docs/pm/research/`, unused. 2026-09-20.
- Four validation scripts: `check_docs.py` (OK), `check_report.py` (38/38 passing), and `friction_precision.py` and `score_usability.py`, which both exist and are tested but have no labeled or session data to run against yet; `export_friction_sample.py` prepares the labeling file when the owner is ready. 2026-09-20.

## What was cut

| Item | Reason at the time | Right call |
|---|---|---|
| Metric authoring UI | A fixed, validated metric set beats a framework to extend before any metric is validated. | Right; extending unvalidated metrics compounds the trust problem. |
| Live log ingestion | v1 is a static, reproducible batch build; continuous refresh is a different product. | Right for v1; revisit before this serves a real team. |
| LLM-as-judge on every response | Cost; friction proxies were meant to do the job more cheaply. | Premature; those proxies turned out unvalidated, so the tradeoff went untested. |
| Toxicity rates | The public build has toxic conversations removed; a rate would misstate safety. | Right; a number from a filtered corpus is worse than none. |
| Primary user interviews at v1 | Six were planned; recruiting was outside the project's control. | Mixed; the only option once recruiting failed, but should have been flagged sooner. |
| User-level drill-down | Privacy; the pseudo-user key is pseudonymous data. | Right; keep this cut unless identity changes. |
| Per-state maps | Small state-grain populations clear the minimum-cell threshold too rarely. | Right; a smaller cut leaks near-identifying cells. |
| A Postgres backend | Aggregates total roughly 80 KB; unneeded weight over a browser querying parquet. | Right for this volume. |

## Launch checks

| Check | Result | Date |
|---|---|---|
| `check_report.py` | 38/38 passed | 2026-09-20 |
| `check_docs.py` | OK | 2026-09-20 |
| `check_site.py` | OK | 2026-09-20 |
| CI (`uv run pytest`) | Green | 2026-09-20 |
| GitHub Pages deploy | Succeeded first run | 2026-09-20 |
| Six-item manual browser checklist | Not run until 2026-10-02; the first real browser load found the dashboard stuck on its loading line | 2026-10-02 |
| Headless-browser smoke check (`scripts/check_site_browser.py`, now a deploy gate) | Fails on the pre-fix build, passes after; every tab renders with no page errors | 2026-10-02 |
| Intent labeling (9,829 of 10,000 via the UCSD TritonAI gateway, claude-sonnet-5) | Ran; 98.3% labeled, 1.7% unparseable | 2026-09-25 |
| Inter-rater study (348 conversations, second model gemini-3.5-flash) | 83.6% agreement on ten classes, 87.1% on seven | 2026-09-26 |
| Intent classifier gate (90% of rater agreement = 78.4%, taxonomy v2) | Passed at 78.6% held-out, no override | 2026-09-26 |
| 300-label friction precision, 70% gate | Ran 2026-10-04 with a model labeler (377 conversations, second-model agreement 83% to 100%): correction 0.96 and repeat 0.78 pass; refusal 0.45 dropped from the dashboard; one-and-done 0.41 as a failure signal, reframed as engagement depth | 2026-10-04 |
| Five-participant usability test (PRD 6.3) | Not run; no recruits in the window | 2026-09-20 |
| Actionability survey (PRD 6.3) | Not run; same recruiting gap | 2026-09-20 |

## The headline friction number was wrong

For two weeks the largest number on the site was "51% of recent conversations end after one turn", labelled as friction, with "one-and-done" as the lead signal on the Friction view and the primary metric of the routing counterfactual. The metrics framework had said from the start that no proxy should be trusted before a 300-conversation precision check, and the check had not run because it needed a labeler.

On 2026-10-04 it ran, with a model as the labeler and a second model checking agreement, the same method the intent work used. One-and-done was 41% precise as a failure signal: most of the people it flagged got what they came for. Short question, correct short answer. The refusal pattern was 45% precise: it fired on the 2023 models' habit of opening a complete answer with "As an AI language model". Two of four signals failed the bar I had set.

What changed the same day: refusal left the dashboard; one-and-done was renamed "ended in one turn" and moved out of the friction group into engagement depth; the landing page's fourth question is now answered with repeated requests, the validated signal; the routing counterfactual reports repeats and corrections alongside the depth measure; and the metrics framework carries the table with the model-labeled caveat.

The lesson is the one the intent gate taught a week earlier, in a different form. A proxy that has not been measured against outcomes is a guess, and the more prominent a guess is on a page, the more it costs when it turns out wrong. The framework's rule was right; what was wrong was shipping the number above the fold before the rule had been applied. Next time the validation runs before the number gets a headline, not after.

## What the numbers said

The most surprising finding was the pseudo-user persistence collapse at the 2024 Q3 to Q4 boundary (F1): the share of pseudo-users seen in more than one week fell tenfold, from 8.5% to 0.8%, almost certainly a logging change, meaning the north-star metric cannot be trusted across that boundary. The claim that did not survive review was an early draft line describing "clean model handoffs" between eras; the data showed a 28-week stretch where gpt-3.5-turbo and gpt-4 both held at least 20% of weekly volume, so the line was rewritten to describe overlap instead. Both were caught by re-deriving numbers against the aggregates, not by reading the prose.

## What was wrong in the PRD

The classifier gate was set at 85% before anyone measured how consistently the labels could be produced; the first classifier scored 72%, and an inter-rater study showed two labeling models agreed only 84% of the time on the ten-class taxonomy, so the gate was above the ceiling by construction. The fix was measurement, a taxonomy revision, and a gate tied to the measured ceiling, not a lowered standard. The intent-labeling configuration as first planned would have exhausted a 64-token output cap, because the default model has thinking enabled and those tokens would consume the budget before any label was written; fixed by disabling thinking, raising the cap to 256 tokens, and requiring a 50-request canary to parse cleanly first. The return-rate metric as first implemented printed a data gap as a false 0.0 instead of NULL, which would read as churn that never happened; fixed before the trends report was written. A DuckDB sum-over-BIGINT type promotion would have silently broken the dashboard's number formatting; fixed with explicit casts. The five-day estimate became eight working days of effort, compressed into three calendar days, which the timeline did not anticipate. Six primary interviews were planned; zero were completed, and the PRD was revised to describe secondary research and an assumptions register instead.

The launch checks listed a manual browser pass and nobody ran it; the dashboard shipped with a module-ordering error (renderers registered before the registry existed) and showed only its loading line to every visitor for twelve days. Static checks, unit tests, and three review rounds all passed because none of them executed the page. The fix was one line; the real fix was a headless-browser check that now runs before every deploy. A launch check that no one is assigned to run is not a check.

## If I did it again

First, confirm the labeling API credential and budget before writing labeling-dependent requirements, such as the intent view and the 85% gate, into the PRD as committed scope rather than pending. Second, schedule friction-labeling and usability-test recruiting in parallel with the pipeline build, not after, so a slip does not strand both checks unmeasured at launch. Third, track estimate variance in working days spent, not calendar days, since that caught the five-day to eight-day gap only in retrospect.
