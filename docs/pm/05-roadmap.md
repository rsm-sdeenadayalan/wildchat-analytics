# Roadmap

**What this is for:** Show what Loupe ships now, what comes next, what is deferred, and what was cut on purpose.
**Date:** 2026-09-20
**Status:** Draft

## Now

Everything P0 and P1 from the PRD ships, over the full 3.2M-conversation corpus:

- Five views (Overview, Intensity, Intent, Friction, Data quality) plus a Query panel (R1, R6).
- Minimum-cell suppression (min_cell = 20) on every geography and language slice, with a `suppressed_or_unknown` row instead of a silent drop (R2).
- Population, pseudo-user, and coverage caveats visible on every view, not linked in a footnote (R3).
- The full aggregate set regenerates from one committed command against cached flat tables (R4).
- No row-level conversation content served by the dashboard or committed to the repo (R5).
- A coverage banner stating the token-usage window, intent-labeling coverage, and suppression share (R7).
- Dark mode (R8) and usability at 400 px width (R9).

One gap inside "shipped": labeling and classification have not run, for lack of an API credential. The Intent view shows "not available" rather than fabricated numbers, and the friction precision table carries "pending" instead of real scores.

## Next

- Run labeling (Stage 3a) and classification (Stage 3b) if not already run, unlocking the Intent view and the friction proxy precision table against the 300 hand labels, and checking the 85% classifier gate.
- Instrument the in-market metrics from PRD 6.1: export events, so exporting a number with its caveat counts as an answered question, plus a caveat retention check.
- Build a second adapter for a common log format, OpenAI-compatible chat completion logs as JSONL, to prove the schema is not WildChat-specific (R12).
- Run usability test round two with in-market pilot users, not the interview-pool proxy sample used for the v1 launch criteria, on real questions.
- Dashboard polish (from the design review): legend for the p50/p90 pair, a muted token for the suppressed_or_unknown bar, a fixed taxonomy-order color domain for intent charts.

## Later

- A MotherDuck-hosted copy of the conversation table, so SQL against Loupe's data is shareable as a link rather than a download (R10).
- Safety and toxicity metrics, once a gated dataset build that retains toxic conversations exists to compute them honestly (R11).
- LLM-judged quality on a sample, a cheaper step short of judging every response.
- Threshold alerts (a return-rate drop, a spike in refusals), once export instrumentation exists to trigger them on something real.

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
