# Roadmap

**What this is for:** Show what Loupe ships now, what comes next, what is deferred, and what was cut on purpose.
**Date:** 2026-09-20
**Status:** Final

## Now

Everything P0 and P1 from the PRD ships, over the full 3.2M-conversation corpus:

- Five views (Overview, Intensity, Intent, Friction, Data quality) plus a Query panel (R1, R6).
- Minimum-cell suppression (min_cell = 20) on every geography and language slice, with explicit `not recorded` and `small cells` rows instead of a silent drop (R2), and a reconciliation check that fails the build if any table stops summing to the total.
- Population, pseudo-user, and coverage caveats visible on every view, not linked in a footnote (R3).
- The full aggregate set regenerates from one committed command against cached flat tables (R4).
- No row-level conversation content served by the dashboard or committed to the repo (R5).
- A coverage banner stating the token-usage window, intent-labeling coverage, and suppression share (R7).
- Dark mode (R8) and usability at 400 px width (R9).

Labeling and classification ran after the v1 site went live (2026-09-25 to 26) through the university gateway; the Intent view carries the classifier's measured reliability on the view itself.

## Next

- Run the 300-conversation friction labeling and the precision check (labeling and classification ran on 2026-09-25 and 2026-09-26; the Intent view is live with taxonomy v2). Add a third rater to the inter-rater study and revisit whether "other" should split into greetings and tests versus unreadable input.
- Instrument the in-market metrics from PRD 6.1: export events, so exporting a number with its caveat counts as an answered question, plus a caveat retention check.
- Build a second adapter for a common log format, OpenAI-compatible chat completion logs as JSONL, to prove the schema is not WildChat-specific (R12).
- Run usability test round two with in-market pilot users, not the interview-pool proxy sample used for the v1 launch criteria, on real questions.
- ~~Act on the findings~~ Shipped 2026-10-03: an intent-aware routing counterfactual sized from the four-model window (`10-routing-counterfactual.md`, Friction view card) and a usage-weighted eval mix with a scorer (`11-usage-weighted-eval.md`, `aggregates/eval_mix.json`). Both are observational; the routing experiment and a design partner for the taxonomy are the next real tests.
- ~~Story landing page~~ Shipped 2026-10-03: scroll-driven four-beat story at the root with the dashboard at `/app/`, one visual system across all pages, numbers from a build-time `story.json`.
- ~~Cross-view model filter~~ Shipped 2026-10-02: a picker under the tabs isolates one model family on every view, backed by four weekly aggregates re-cut by model under the same `min_cell` rule; return becomes same-model retention. Countries, languages and quarterly persistence have no per-model cut and carry an "all models" tag.

## Later

- A MotherDuck-hosted copy of the conversation table, so SQL against Loupe's data is shareable as a link rather than a download (R10).
- Safety and toxicity metrics, once a gated dataset build that retains toxic conversations exists to compute them honestly (R11).
- LLM-judged quality on a sample, a cheaper step short of judging every response.
- ~~Instrument Loupe's own metrics~~ Shipped 2026-10-05: PostHog on all pages with events mapped to the PRD tree; a two-week read of the numbers is the follow-up.
- ~~Multi-assistant attribution~~ Shipped 2026-10-04: turn-level attribution (`attributed_to` on turns, `friction_by_responder`), the one-field adapter contract (`responder` per assistant message), and the Friction view's contract card. Raised by an outside reader; the data has a single responder per conversation so the capability is demonstrated as a schema and a test rather than a new finding.
- Refusal detector v2: a model judgment on the assistant reply, or a reply-length-and-pattern rule, validated on a larger stratified sample; the pattern proxy was dropped on 2026-10-04 at 0.45 precision.
- Human relabel of the 377 model-labeled friction conversations, to replace model agreement with ground truth.
- Threshold alerts (a return-rate drop, a spike in repeated requests), once export instrumentation exists to trigger them on something real.

## Cut list

| Item | Why cut | What would bring it back |
|---|---|---|
| Metric authoring UI | Non-goal. A fixed, validated metric set, not a framework users extend. | A team needs a proxy Loupe does not define, validated against hand labels first. |
| Live log ingestion | v1 is static; one command regenerates aggregates from cached tables. | A real team's production logs need continuous refresh, not a batch run. |
| LLM-as-judge on every response | Cost; friction proxies do the job cheaply from structure, validated against hand labels. | Quality scoring the proxies cannot approximate, with judging cost budgeted. |
| Toxicity rates | Public WildChat has toxic conversations removed, so a rate would read as false safety. | A gated build that retains toxic conversations becomes available (see Later). |
| Per-state maps | Privacy. State grain plus a small population produces cells under min_cell = 20 too often. | A population large enough to clear min_cell at state grain, with a suppression-aware map. |
| User-level drill-down | Privacy. A pseudo-user key is pseudonymous personal data; drilling in defeats the aggregate-only design. | Not on this key; only a login-based identity, in a permissioned, audited view. |
| A Postgres backend | Aggregates total roughly 80 KB; unneeded weight when a browser queries parquet directly. | Aggregate volume outgrows a browser, or a team needs write access. |
| Primary user interviews at v1 | Not possible in a five-day window with scheduling outside the team's control. | Already first in Next, above; recruitment plan is in the user research document. |

## Sequencing rationale

Data came first because a wrong number destroys the premise of a self-serve tool: if a reader cannot trust a figure without checking it, Loupe recreates the problem it was built to remove. Every guardrail shipped before the dashboard touched a screen: minimum-cell suppression, the 85% classifier agreement gate, and the 70% friction proxy precision gate, with a failing proxy dropped rather than softened.

Trust came second because a correct number nobody believes is as useless as a wrong one. Once the aggregates were sound, the next risk was whether a reader acts on them without disputing them, so caveats stay visible on every view instead of behind a link, the Query panel re-runs the SQL behind any tile, and the usability test checks whether a caveat survives being repeated back unprompted. This is why Next leads with usability testing and caveat retention, not new features.

Reach comes third because expanding to more teams or log formats only pays off once the first two risks are retired. A second adapter or a hosted SQL endpoint multiplies whatever is already true of the tool, wrong numbers and unearned trust included, so pushing reach first would make both problems bigger. That is why live ingestion and a database backend sit in the cut list, not the roadmap.
