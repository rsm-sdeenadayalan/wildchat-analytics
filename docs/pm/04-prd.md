# PRD: Loupe v1

**What this is for:** Define what Loupe must do, for whom, at what priority, and how launch is judged, before dashboard and pipeline work is finalized.
**Date:** 2026-09-20
**Status:** Draft
**Version:** 0.1

## Problem

A person who owns an AI assistant feature cannot answer who uses it, how intensely, for what, or where it fails, without an engineer writing a one-off script. Priya is the product manager for the AI assistant inside a customer-support tool, and about 40,000 conversations a week flow through it. Her VP asks three questions on a Monday: is usage growing or is it the same power users every week, what are people using it for, and support tickets say the assistant "doesn't get it" so where is it failing. Today she asks a data engineer for a SQL pull, waits three days, gets a spreadsheet of 2,000 conversations, and reads a few hundred by hand over a weekend to form a gut impression that nobody else can check. A month later the same questions come back and she repeats the whole cycle.

This recreates a pattern documented across the industry: most teams shipping an AI feature either run no evaluation at all or use ad-hoc scripts that only an engineer can operate, so the PM who is accountable for the feature's quality and adoption cannot act on her own. Loupe closes that gap with a metrics pipeline and dashboard that a PM or analyst runs and reads without engineering help, demonstrated end to end on WildChat-4.8M as a stand-in for a team's own production logs.

## Goals

- G1. Ship a complete, public, ordered set of senior-PM artifacts for one product, each dated and versioned in the repo.
- G2. Ship a working, publicly hosted dashboard backed by metrics computed over all 3.2M conversations, reproducible from one command.
- G3. Publish a trends report with at least five findings a product owner would act on, each traceable to a metric definition and a query.
- G4. Complete six or more user interviews and a synthesis document; ship with whatever count lands, plus a plan for the rest.
- G5. Handle the sensitive-data dimension explicitly and well, because the target roles ask for it.
- G6. Meet the v1 launch criteria in Section 6.3, including a five-participant usability test and validation of every friction proxy against hand labels.
- G7. Pass all five launch checks in "Launch criteria" below.

## Non-goals

- Not a general-purpose eval framework. No metric authoring UI, no CI integration, no LLM-as-judge scoring of every response.
- Not a live ingestion product. No connectors to production logging systems in v1.
- Not a research paper. No claims about ChatGPT's user base at large; claims are about this dataset's population, stated as such.
- Not toxicity or safety analytics in v1. The public dataset has toxic conversations removed, so safety rates cannot be computed honestly from it. See Roadmap → Later.
- No re-hosting of the raw dataset. Hugging Face remains the source of truth.
- No changes to shankard.com. Loupe ships its own site; embedding or linking it from the personal site is outside this project.

## Personas

**Priya, PM at a mid-size SaaS company.** Context: owns the AI assistant inside a customer-support product; about 40,000 conversations a week; has a data engineer but no dedicated analyst, and every request to that engineer competes with other work. Job: answer her VP's volume, intent, and failure questions on a weekly or ad-hoc basis without filing a ticket. Good looks like: she opens the dashboard on a Monday, gets an answer with a caveat attached inside two minutes, and cites the number in the VP meeting without anyone disputing it.

**Dev, the analyst who owns the SQL.** Context: the one person on the team who can write the queries the PM's questions actually require; treated as a bottleneck because every product question becomes an engineering ticket. Job: stop being paged for questions that do not need a new query, and trust that the numbers the PM pulls herself are correct. Good looks like: Dev maps the team's logs to Loupe's schema once, then gets pulled in only for genuinely new questions, and can point to the Query view's SQL when someone doubts a number.

**Sam, the founder running a chatbot with no analyst on staff.** Context: ships a support or tutoring assistant, has no one dedicated to data, and currently reads a handful of transcripts by hand on weekends to get a gut feel for quality. Job: get a systematic read on volume, intent, and failure without hiring an analyst or writing SQL. Good looks like: Sam maps logs to the schema, opens the dashboard, and replaces the weekend transcript-reading habit with a five-minute weekly look at the same five views.

## User stories

1. As Priya, I want a volume view sliced by model, country, and language, so that I can tell my VP whether usage is growing and where it is coming from.
2. As Priya, I want an intensity view with return rate and top-10%-share, so that I can tell whether growth is broad or concentrated in a shrinking core of power users.
3. As Sam, I want an intent view built from a fixed taxonomy, so that I know what people are actually trying to do without reading transcripts myself.
4. As Priya, I want a friction view with proxies for repeated requests, corrections, one-turn abandonment, and refusals, so that I can tell engineering exactly which failure mode to fix first.
5. As any owner, I want every number I export to carry its population caveat and its pseudo-user caveat, so that I can defend the number when someone on my team questions it.
6. As Dev, I want a Query view that shows the exact SQL behind any number, so that I never have to re-derive a query from scratch when someone doubts a dashboard figure.
7. As any owner, I want the entire aggregate set to regenerate from one committed command against the same input data, so that I can prove a number is reproducible rather than a one-off pull.
8. As a hiring PM reviewing this project, I want the dashboard and every underlying aggregate to contain no row-level transcript content, so that I can trust the product handles sensitive user data the way the target roles require.

## Requirements

| ID | Requirement | Priority | Acceptance check |
|---|---|---|---|
| R1 | Dashboard ships five views: Overview, intensity, intent, friction, data quality. | P0 | Each view renders with real aggregate data and no console errors, in one browser. |
| R2 | Minimum-cell suppression (`min_cell = 20`) applied on every geography and language slice; suppressed or unknown rows appear as an explicit residual row rather than vanishing. | P0 | `loupe/metrics/volume_weekly_country.sql` and `volume_weekly_language.sql` output a `suppressed_or_unknown` row per week; no cell under 20 conversations appears broken out. |
| R3 | Every view carries the applicable caveats (population, pseudo-user, coverage) visibly, not in a footnote link. | P0 | Manual review of each view confirms the caveat text from `aggregates/meta.json` is rendered, not just linked. |
| R4 | The full aggregate set regenerates from one committed command run against the cached flat tables. | P0 | `make all` (flatten, sample, label, classify, metrics) followed by `uv run python scripts/check_report.py` once the report exists; `aggregates/meta.json` records the run. |
| R5 | No row-level conversation content is served by the dashboard or committed to the repo. | P0 | Grep of `aggregates/` and the dashboard's served files for free-text conversation content returns nothing; only the gitignored labeling sample under `samples/` ever holds content, and it is never published. |
| R6 | A Query view lets a reader run the same SQL the dashboard uses against the committed parquet files, in the browser. | P1 | DuckDB-WASM query against `aggregates/*.parquet` in the browser returns the same number shown on the corresponding dashboard tile. |
| R7 | A coverage banner states token-usage coverage window, intent-labeling coverage, and geography/language suppression share on the relevant views. | P1 | Banner text matches `aggregates/meta.json` fields (`token_coverage_first_week`, `intent_coverage`) on every load, and the `suppressed_or_unknown` residual rows in `volume_weekly_country.parquet` and `volume_weekly_language.parquet` sum with the kept rows to `meta.json`'s `conversations` total. |
| R8 | Dashboard supports dark mode. | P1 | Toggling the OS or in-app theme switch changes the dashboard's rendered theme with no unreadable contrast. |
| R9 | Dashboard is usable at phone width. | P1 | Manual check at a 375px viewport: no horizontal scroll, all five views usable. |
| R10 | Aggregates are also queryable from a MotherDuck-hosted table, not only local parquet files. | P2 | A MotherDuck connection string in the docs resolves to a live table matching the committed aggregates. |
| R11 | Safety and toxicity metrics are computed once a dataset build that retains toxic conversations is available. | P2 | A safety metric family ships against a gated dataset build, with the same suppression and caveat rules as the rest of the framework. |
| R12 | Connectors exist for at least one live production logging system, not only the static WildChat build. | P2 | A documented connector maps a live log format to Loupe's schema and produces the same aggregate set. |

Labeling (Stage 3a, `loupe/stages/label.py`) and classification (Stage 3b, `loupe/stages/classify.py`) have not run on this build: no API credential is present on the development machine. R1 (intent view), R3 (intent-coverage caveat), and the 85%-accuracy gate below are therefore pending until those stages run. `aggregates/meta.json` currently reports `intent_coverage: "none"` and `intent_labeled_conversations: 0`.

## Success metrics

These are the metrics for Loupe itself, distinct from the analysis metrics Loupe computes about an assistant (defined in `03-metrics-framework.md`).

**North star: weekly answered questions.** A session in which a user reaches a view and exports, shares, or copies a number with its caveat attached. Usage alone does not count; the user has to take something away.

### Metrics tree, for Loupe in market

| Layer | Metric | Why it is here | Target at 90 days |
|---|---|---|---|
| Adoption | Teams with logs mapped to the Loupe schema | The product only works once a team's data is in | 5 teams |
| Adoption | Weekly active users per team | One analyst, or the whole product team | 3 or more |
| Engagement | Time from log connection to first exported answer | The onboarding promise | Under 1 day |
| Engagement | Answered questions per active user per week | Habit, not a one-time report | 3 or more |
| Trust | Share of exported answers that keep the caveat line | Interpretability, measured in behavior | 90% or higher |
| Trust | Disputed numbers per 100 exports | Do people argue with Loupe's math | Under 2 |
| Outcome | Product decisions citing Loupe, self-reported quarterly | The lagging proof of value | 1 per team per month |
| Retention | Teams active 4 weeks after onboarding | Does it stick | 80% or higher |

### Guardrails

Any of these blocks a release regardless of the metrics above.

- Zero row-level transcript content reachable from the dashboard.
- Minimum-cell suppression applied on every geography and language slice.
- Intent classifier agreement with LLM labels at 85% or higher on the held-out sample.
- Friction proxy precision at 70% or higher against 300 hand-labeled conversations (Section 13).
- Pipeline cost per million conversations under the cap set in the PRD before the classifier stage runs.
- Aggregates never older than one week from the latest log.

## Launch criteria

Loupe has one "team" (the WildChat demonstration) and no in-market users at launch. The in-market metrics above are therefore unmeasured at launch, and the PRD says so. The launch criteria below are proxies, each mapped to the metric it predicts. Instrumenting the real metrics is a roadmap item.

| Launch check | Method | Target | Proxy for |
|---|---|---|---|
| Time to answer | Moderated test: 5 participants from the interview pool, 5 canned questions each, one per job in Section 3 | Under 2 minutes per question | Time to first exported answer |
| Task success | Same test | 80% of questions answered correctly | Answered questions per user |
| Caveat retention | Participants asked to explain a result after the test; count who state the population or pseudo-user caveat unprompted | 80% | Share of exports keeping the caveat |
| Actionability | Interviewees rate each trends-report finding "would act on" or not | 3 of 5 findings rated actionable by a majority | Decisions citing Loupe |
| Reproducibility | Automated check that every report number regenerates from committed aggregates via the included query | 100% | Disputed numbers |

Plus: docs check and report check pass.

All five checks are unmeasured at this version, per the reframed research method in `02-user-research.md` (no interviews were conducted in the project window). They remain the defined bar for launch; the pending recruitment plan is carried in `02-user-research.md` → "Gaps and next steps."

## Privacy and sensitive data

**What the dataset authors already did.** WildChat-4.8M is de-identified by its authors before release: Presidio and regex-based PII detection, manual review of a sample, and TruffleHog scanning for leaked secrets. Toxic conversations were removed from the public build entirely, which is why Loupe defers safety and toxicity metrics to a future dataset build (see Roadmap → Later, and the decision log below).

**What Loupe adds on top of that.** Loupe never displays raw transcript content on the public dashboard; only aggregates leave the pipeline, and the committed `aggregates/*.parquet` files carry no `conv_id`-to-text mapping. Minimum-cell suppression (`min_cell = 20`) applies to every geography and language slice, and suppressed or excluded rows are published as an explicit residual row rather than silently dropped, so a reader cannot infer that a small cell was hidden versus simply absent. The intent-classification sample, the one artifact in the pipeline that touches conversation content directly, is sent to the labeling API under the project's own credential and is never committed to the repo; the local cache of that sample (`intent_text`, capped at 2000 characters per conversation, kept only so classification runs in one pass) lives outside version control. The trends report and dashboard quote no conversation verbatim.

**How a removal request is honored.** The repo README documents the procedure: if the dataset authors forward a data-removal request, the affected shard is removed from the local cache and the full pipeline (ingest through metrics) is re-run against the updated corpus, regenerating every aggregate from source. Because Loupe holds no independent copy of raw conversation content, honoring a removal request is a re-run, not a manual redaction.

**Why hashed IP is treated as personal data anyway.** The pseudo-user key (`loupe/text.py:pseudo_user`) is a hash of IP address, user agent, and accept-language, and the dataset's own IP field is already hashed before Loupe ever sees it. A hash is not the same as anonymization. The same input reliably produces the same hash, so anyone who can compute the same hash function over a candidate IP, user agent, and accept-language tuple can test whether a specific real person's traffic is in the dataset. The combination of IP-adjacent signal, browser fingerprint, and language is itself a quasi-identifier, even without decrypting anything. Loupe therefore treats every pseudo-user key as pseudonymous personal data, not anonymous data: it is never shown or exported at row level, it appears only inside aggregate counts, and it is subject to the same minimum-cell suppression as any other identifying slice.

## Open questions

- Which charting library the dashboard uses. Resolved in `06-dashboard-design.md`.
- Final boundaries of the ten-class intent taxonomy once labeling has actually run at scale; the taxonomy in `03-metrics-framework.md` was finalized by hand-reading 200 conversations, not by running the classifier against real held-out accuracy numbers.
- Whether to host aggregates on MotherDuck in addition to static parquet files (R10, P2), and if so, on what schedule.
- Whether intent classification should ship sample-only (the ~10,000-conversation labeled slice, with that scope stated) if the classifier fails the 85% held-out accuracy gate, rather than extending to the full corpus.
- All six assumptions in the assumptions register (`02-user-research.md` → "Assumptions register") remain open until primary research runs: how owners answer usage questions today, how they judge quality, whether a caveat increases trust, their decision cadence, whether intent is the first metric family they want, and whether the friction proxies track real user outcomes.

## Decision log

| Date | Decision | Alternatives | Reason |
|---|---|---|---|
| 2026-09-17 | Build a user-analytics product on public conversation logs (approach 1) | An evals product for non-engineers; a pure strategy memo with no working software | Approach 1 maps most directly to the target PM roles' stated work: intensity measures, volume metrics, complex user activity logs, and GenAI product understanding |
| 2026-09-17 | Demonstrate on WildChat-4.8M | LMSYS-Chat-1M | WildChat-4.8M is ungated, extends to July 2025, and carries token usage fields that LMSYS-Chat-1M does not |
| 2026-09-17 | Stream shards via `huggingface_hub` and DuckDB, caching content-free flat tables locally | The `datasets` library | The `datasets` library requires a 15 GB download plus a 42 GB local Arrow cache; streaming and caching only content-free flat tables avoids both |
| 2026-09-17 | Ship Loupe as a standalone site on its own GitHub Pages | Embedding or linking Loupe from shankard.com | No changes to the personal site are in scope for this project |
| 2026-09-17 | Keep a 2000-character `intent_text` per conversation cached locally | Re-fetching conversation text at classification time; no local text cache at all | A single local field lets intent classification run in one pass without re-streaming shards |
| 2026-09-17 | Defer safety and toxicity metrics past v1 | Estimating safety rates from the public build anyway, with a caveat | The public WildChat-4.8M build has toxic conversations already removed, so a safety rate computed from it cannot be reported honestly |
| 2026-09-20 | Label the intent sample with claude-haiku-4-5 under a $15 budget cap (superseded 2026-09-25, see below) | claude-sonnet-5 or claude-opus-5, which cost more per token; an uncapped budget | The owner chose the cheapest model that supports the required JSON-schema output; estimated cost is about $9 for 20,000 conversations, leaving headroom under the $15 cap; thinking is explicitly disabled on thinking-capable models so thinking tokens cannot truncate the JSON output, and a 50-request canary must parse at 90% or higher before the main batch is submitted |
| 2026-09-20 | Report intent and volume model slices by model family, not by dated point release | Reporting every dated model string (e.g., `gpt-4o-2024-05-13`) separately | Dated point releases fragment the same underlying model into many near-duplicate rows; stripping the date/preview suffix keeps slices readable without losing the model-family signal |
| 2026-09-20 | Publish suppressed and unknown geography as an explicit residual row | Dropping small or unresolvable geography cells silently | A silent drop makes suppression invisible and could read as a smaller population than actually exists; an explicit residual row states the size of what was suppressed or unresolved |
| 2026-09-20 | Report `return_rate` as `NULL` for weeks with no following week in the data, and record the 2024-10 pseudo-user persistence break as a caveat rather than correcting for it | Reporting a false 0.0 for the trailing week; smoothing or interpolating across the persistence break | A false 0.0 would read as total churn that never happened; the persistence break is a collection-side artifact, not a real behavior change, and cannot be corrected from this data, so it is disclosed instead |
| 2026-09-20 | Reframe user research as secondary research plus an assumptions register, and leave the Section 6.3 launch checks defined but unmeasured at v1 | Skipping the research artifact entirely; fabricating interview data; delaying the whole project until interviews can be scheduled | No user interviews were possible within the project window; the artifact set still needs a research document, so it documents what is known from public evidence, what is assumed, and how each assumption would be tested first |
| 2026-09-20 | Write labeling- and classification-dependent requirements (intent view coverage, the 85% accuracy gate, friction proxy precision) as pending rather than filling in placeholder numbers | Inventing plausible-looking numbers; leaving the sections blank | No API credential is present on the development machine, so the labeling and classification stages have not run; pending is an honest status that a hiring reader can verify against `aggregates/meta.json` |
| 2026-09-25 | Label through the UCSD TritonAI gateway (OpenAI-compatible, model claude-sonnet-5) with a 10,000-conversation sample, six parallel requests, resumable progress, and a 50-request canary | Anthropic Message Batches with an API key the owner does not have; keep 20,000 | The university gateway is available at no cost to the owner but caps parallelism at 7 and about 60 requests a minute; 10,000 labels keep 8,000 for training and 2,000 held out and finish in about three hours instead of six; 5,000 would be almost entirely per-stratum floors |

After interviews complete, this document moves to **Version: 1.0**. Each PRD change made because of interview findings gets its own row here, tagged with the participant ids that motivated it, mirrored under "What changed in the PRD" in `02-user-research.md`.
