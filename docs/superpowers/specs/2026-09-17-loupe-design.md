# Loupe — Design Spec

**Date:** 2026-09-17
**Author:** Shankar Deenadayalan
**Repo:** github.com/rsm-sdeenadayalan/wildchat-analytics
**Status:** Draft for review

## 1. Summary

Loupe is a user analytics product for teams that ship a GenAI assistant. It turns raw conversation logs into the answers a product manager needs: who uses the assistant, how intensely, for what, and where it fails them.

Loupe is built and demonstrated against WildChat-4.8M, a public dataset of 3.2 million real human–ChatGPT conversations, standing in for "our production logs." The demonstration ships two things: the product (a metrics pipeline and a dashboard) and the findings (a public trends report on how people actually use a general-purpose AI assistant).

Loupe is also a portfolio project. Its purpose is to show the full pre-build and post-launch work of a senior product manager, end to end, in public: opportunity brief, user research, metrics framework, PRD, roadmap, design, launch, findings, strategy memo, retrospective. The software is real but deliberately modest. The PM artifacts are the headline.

## 2. Why this project

Three target roles at Google were read in full. Their common thread is data-informed product judgment, and one of them (PM, Google User Analytics) is almost a spec for this project: "intensity measures, volume metrics, complex user activity logs," "GenAI products," "improve understanding of userbase trends," "advocate for great data interpretability," and "the complexities of working with sensitive user data." The YouTube PM role wants PRDs, launch ownership, and metric definition. The Cloud AI Strategy & Ops role wants trend analysis and written strategy.

Market evidence gathered 2026-09-17:

- Roughly 35% of teams shipping AI run no evaluation at all; most of the rest use ad-hoc scripts and manual transcript reading.
- The hardest part of measuring an AI product is deciding what to measure, not running the measurement.
- When every quality question requires an engineer to write a script, engineering becomes the bottleneck for every product decision.
- A 2026 study named a "results-actionability gap": teams that do measure still cannot tell what to change.

Incumbent tools (DeepEval, Braintrust, LangSmith, promptfoo, Confident AI) are developer tools that assume the user already knows their metrics and writes code. WildVis, the dataset authors' own tool, is a search-and-browse visualizer for researchers, not a metrics product for product owners. Loupe sits in the gap: opinionated, PM-facing, metrics-first.

## 3. Users and jobs

**Primary user:** the product manager or product analyst who owns a GenAI assistant feature and is accountable for its quality and adoption, but does not own the eval or analytics code.

**Jobs to be done:**

1. Understand who is using the assistant and how that population is changing.
2. Understand how intensely people use it, and whether intensity is growing or decaying.
3. Understand what people are trying to do with it.
4. Find where the assistant fails people, so engineering effort goes to the right place.
5. Defend all of the above with numbers that are reproducible and whose caveats are explicit.

**Secondary audience (portfolio):** recruiters and hiring managers for PM roles who need to judge product thinking in under ten minutes.

## 4. Goals and non-goals

**Goals**

- G1. Ship a complete, public, ordered set of senior-PM artifacts for one product, each dated and versioned in the repo.
- G2. Ship a working dashboard on shankard.com backed by metrics computed over all 3.2M conversations, reproducible from one command.
- G3. Publish a trends report with at least five findings a product owner would act on, each traceable to a metric definition and a query.
- G4. Complete six or more user interviews and a synthesis document; ship with whatever count lands, plus a plan for the rest.
- G5. Handle the sensitive-data dimension explicitly and well, because the target roles ask for it.

**Non-goals**

- Not a general-purpose eval framework. No metric authoring UI, no CI integration, no LLM-as-judge scoring of every response.
- Not a live ingestion product. No connectors to production logging systems in v1.
- Not a research paper. No claims about ChatGPT's user base at large; claims are about this dataset's population, stated as such.
- Not toxicity or safety analytics in v1. The public dataset has toxic conversations removed, so safety rates cannot be computed honestly from it. See Roadmap → Later.
- No re-hosting of the raw dataset. Hugging Face remains the source of truth.

## 5. The PM artifact set

Each artifact is a Markdown file under `docs/pm/`, numbered in the order a senior PM would produce them. Each has a one-line "what this is for" header, a date, and a status. They are rendered to plain HTML for the case-study pages on shankard.com (Section 9).

| # | Artifact | File | Done when |
|---|---|---|---|
| 01 | Opportunity brief | `01-opportunity-brief.md` | Two pages: problem, who has it, evidence, why now, why this wedge, what we will not do. |
| 02 | User research plan and synthesis | `02-user-research.md` | Interview guide, participant sourcing, N completed, verbatim quotes, ranked pain points, what changed in the PRD because of it. |
| 03 | Metrics framework | `03-metrics-framework.md` | North star, input metrics, guardrails, exact definitions, known biases of each, and the query that computes each. Written before pipeline code. |
| 04 | PRD | `04-prd.md` | Problem, goals, non-goals, personas, user stories, prioritized requirements (P0/P1/P2), success metrics, launch criteria, privacy and sensitive-data section, open questions, decision log. |
| 05 | Roadmap | `05-roadmap.md` | Now / Next / Later with the explicit cut list and the reason for every cut. |
| 06 | Dashboard design | `06-dashboard-design.md` | One page: information hierarchy, the five views, wireframe sketches, interaction rules, what is deliberately absent. |
| 07 | Trends report | `07-trends-report.md` | Public-facing. At least five findings, each with a chart, a plain-English implication for a product owner, and a link to the metric definition. |
| 08 | Strategy memo | `08-strategy-memo.md` | For a company building an AI assistant: what the usage data implies about segments, pricing, model mix, and where quality investment pays. Aimed at the Cloud strategy role. |
| 09 | Launch notes and retrospective | `09-retro.md` | What shipped, what was cut, what the numbers said, what was wrong in the PRD, what a v2 would do first. |

A tenth page, `docs/pm/README.md`, is the guided tour: it tells a recruiter what to read in what order and how long each takes.

## 6. Data

**Source:** `allenai/WildChat-4.8M` on Hugging Face. 3,199,860 conversations, 86 parquet shards, about 15 GB. Ungated. License: ODC-By (attribution required; attribution text goes in the repo README, the dashboard footer, and the trends report).

**Coverage:** April 2023 through 31 July 2025.

**Model mix in the data:** gpt-4o 1.54M, gpt-3.5-turbo 0.69M, gpt-4.1-mini 0.63M, gpt-4 0.20M, o1-mini 59k, o1-preview 53k, gpt-4-turbo 22k.

**Fields Loupe uses**

| Field | Grain | Used for |
|---|---|---|
| `timestamp` | conversation | All time series |
| `model` | conversation | Model mix, per-model intensity |
| `country`, `state` | conversation | Geography |
| `language` | conversation | Language mix |
| `turn` | conversation | Session depth |
| `hashed_ip` + `header` | conversation | Pseudo-user ID (see biases) |
| `conversation[].content`, `role` | turn | Intent classification sample, friction proxies |
| `conversation[].usage.*` | turn | Token volume (present in newer shards only) |
| `redacted` | conversation | PII-redaction rate as a data-quality metric |

**Known data quirks the pipeline handles**

- `conversation_hash` is not unique. The conversation key is the first `turn_identifier` in the conversation.
- Some conversations have empty user inputs (a quirk of the collection chatbot). These are excluded from intent and friction metrics and counted separately.
- Token usage fields are absent for older shards. Token metrics are reported only over the window where they exist, and that window is stated.

**Population caveat, stated everywhere the data is shown:** these conversations came from a free public chatbot the researchers hosted, not from ChatGPT's own product. The population skews toward people seeking free GPT-4-class access. Findings describe this population. They are suggestive, not representative, of AI assistant users in general.

## 7. Metrics framework (summary; the full document is artifact 03)

**North star (for the product being analyzed):** weekly returning pseudo-users. It captures both reach and stickiness, and it is the one number that moves only when the assistant is actually useful.

**Metric families and definitions**

1. **Volume.** Conversations, turns, and (where available) tokens, per day and per week, sliced by model, country, and language.
2. **Intensity.** Conversations per pseudo-user per week. Turns per conversation (distribution, median, p90). Share of weekly activity from the top 10% of pseudo-users. Pseudo-user return rate: of pseudo-users active in week W, the share active in W+1.
3. **Intent.** Conversation category from a fixed taxonomy of roughly twelve classes (coding, writing and editing, creative and roleplay, homework and study, information seeking, translation, business and professional, personal advice, other). Assigned by an LLM on a stratified sample of about 20,000 conversations, then extended to the full set by a lightweight classifier trained on the sample. Agreement between the two is reported.
4. **Friction.** Proxies computed from the transcript structure, each defined precisely in artifact 03: repeated request (user turn highly similar to their previous user turn), one-and-done abandonment (single turn, short assistant reply), correction follow-up (user turn beginning with a correction pattern in the top languages), and assistant refusal pattern. Each is a rate per conversation, sliced by intent and model.
5. **Data quality.** PII-redaction rate, empty-input rate, and the coverage window of each field.

**Pseudo-user bias, stated in the framework:** hashed IP plus header is the only user key available. It merges people behind shared networks and splits one person across devices and networks. Intensity metrics are therefore bounded estimates, and the framework says which direction each bias pushes each metric.

## 8. Architecture

Three layers, each with one job.

**8.1 Pipeline (`loupe/pipeline/`)** — Python 3.12, DuckDB, `uv`-managed.

- Reads parquet shards directly from Hugging Face over HTTPS using DuckDB's `httpfs`, one shard at a time. Nothing beyond the current shard and the aggregate outputs is kept on disk. A `--local` flag reads pre-downloaded shards for repeat runs.
- Stage 1 `flatten`: writes a conversation-level table and a turn-level table (without content) per shard to local parquet.
- Stage 2 `sample`: draws the stratified sample for intent classification and writes it with content.
- Stage 3 `classify`: calls the Anthropic API on the sample with a fixed prompt and the taxonomy, writes labels, then trains and applies the lightweight classifier to all conversations. Cost is capped and logged; the cap and the actual spend appear in the PRD's decision log.
- Stage 4 `metrics`: computes every metric in artifact 03 as SQL over the flattened tables and writes small aggregate parquet files to `aggregates/`, one file per metric family. Target total size under 25 MB.
- Stage 5 `publish`: copies the built dashboard and the aggregates into the portfolio repo folder (Section 9).
- One command, `make all`, runs stages 1 through 4. `make publish` runs stage 5.

**8.2 Aggregates (`aggregates/`)** — committed to the repo, versioned, the only thing the dashboard reads. Every number in the trends report is a query against these files, and the query is included in the report.

**8.3 Dashboard (`dashboard/`)** — static HTML, CSS, and JavaScript. No framework, no build step beyond copying files. DuckDB-WASM loads the aggregate parquet files and runs SQL in the browser. Charts follow the `dataviz` skill's guidance for one coherent visual system that works in light and dark. Five views, matching the metric families: Overview, Intensity, Intent, Friction, Data Quality. A "Query" panel lets a visitor run their own SQL against the aggregates. The population caveat and the ODC-By attribution are always visible in the footer.

**Dependencies:** duckdb, pyarrow, anthropic, scikit-learn (for the lightweight classifier), pytest. Dashboard: duckdb-wasm from a CDN, a single charting library.

## 9. Hosting on shankard.com

shankard.com is served by GitHub Pages from the `main` branch root of the private `rsm-sdeenadayalan/portfolio` repo, a single static page styled as a Windows XP desktop, with no build step.

- Loupe's code, docs, and aggregates live in the **public** repo `rsm-sdeenadayalan/wildchat-analytics`, cloned at `/Users/shankar/Documents/wildchat-analytics`. Everything is pushed there; nothing lives only on the laptop.
- `make publish` copies `dashboard/` and `aggregates/` into `portfolio/loupe/`, and renders each `docs/pm/*.md` to a plain, readable HTML page under `portfolio/loupe/docs/`. The result is `shankard.com/loupe/` (dashboard) and `shankard.com/loupe/docs/` (case study). The rendering step is a small Python script with no framework.
- The XP desktop gets one new icon, "Loupe," which opens a window in the existing window system with a short description, the dashboard in an iframe, and buttons to open the dashboard full screen and to read the case study. The window follows the markup pattern of the existing "My Projects" window and reuses `openWin`.
- The case-study pages use plain styling, not the XP chrome. A recruiter reading a PRD should not fight a theme.
- Committing to the portfolio repo is done by Shankar (or with explicit go-ahead), because it deploys immediately to a public site.

## 10. Privacy and sensitive data

This is a first-class section of the PRD and a stated theme of the project, because the target roles ask for it.

- The dataset is already de-identified by its authors (Presidio, regex, manual review, TruffleHog for secrets). Loupe never displays raw transcript content on the public dashboard. Only aggregates leave the pipeline.
- The intent-classification sample, which contains content, is sent to the Anthropic API under the project's own key and is not committed to the repo. The trends report quotes no conversation verbatim.
- Hashed IP is treated as a pseudonymous key and is never shown or exported at row level. Geography is reported at country and US-state grain only, and cells below a minimum count are suppressed in the dashboard.
- The repo README documents how to honor a data-removal request that the dataset authors forward, by re-running the pipeline against the updated dataset.

## 11. Testing

- Every metric definition in artifact 03 has a unit test against a tiny hand-built fixture where the correct answer is known by inspection. The test name matches the metric name.
- The pipeline runs end to end on one shard in CI (GitHub Actions) on every push. The full run is manual.
- The classifier stage reports agreement between the LLM labels and the lightweight classifier on a held-out slice of the sample. The threshold for shipping is stated in the PRD.
- The dashboard has a smoke check: every aggregate file loads, every view renders with no console errors, in one browser.
- The trends report has a reproducibility check: each finding's query, run against the committed aggregates, yields the number printed in the report.

## 12. Sequencing

Aimed at five working days. Interviews run in parallel because scheduling is outside our control.

| Day | Deliverables |
|---|---|
| 1 | Repo scaffold. Artifact 01 opportunity brief. Artifact 03 metrics framework. Interview outreach sent to at least fifteen people. Pipeline stage 1 running on one shard. |
| 2 | Artifact 04 PRD. Artifact 05 roadmap. Stages 1 and 4 running over the 1M subset. Metric unit tests. First interviews. |
| 3 | Artifact 06 dashboard design. Dashboard views built against 1M aggregates. Stage 3 classifier on the sample. Full 3.2M run started. |
| 4 | Artifact 07 trends report from full aggregates. Artifact 02 research synthesis with interviews so far. Publish to shankard.com behind the XP icon. |
| 5 | Artifact 08 strategy memo. Artifact 09 retro. `docs/pm/README.md` guided tour. Review pass on every document. Public repo. |

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Fewer than six interviews land in five days | Ship artifact 02 with whatever N is reached, name the gap, and schedule the rest. Partial honest research beats none. |
| Pseudo-user key is weak | State the bias direction per metric. Report intensity as bounded estimates. Never call a hashed IP a "user" in public copy. |
| Streaming 15 GB from Hugging Face is slow or rate-limited | Develop on the 1M subset. Run the full pass overnight with `--local` after a one-time download to external disk if needed. |
| Intent classifier disagrees with LLM labels | Report the agreement number. If below threshold, ship intent metrics over the labeled sample only and say so. |
| The population caveat undermines the findings | Lead with it. The project's claim is "here is how a real product team would analyze real logs," not "here is what ChatGPT users do." |
| Scope creep toward a full eval product | The non-goals list and the roadmap cut list are the contract. Friction stays one metric family. |

## 14. Open questions

- Which single charting library for the dashboard. Decided in artifact 06 after reading the `dataviz` skill.
- Exact intent taxonomy. Drafted in artifact 03, finalized after reading 200 sampled conversations by hand.
- Whether to add a MotherDuck-hosted copy of the conversation-level table for a shareable SQL endpoint. Roadmap → Later.
- Whether the shankard.com headline should change from "AI Engineer & Data Scientist" once Loupe is live. Separate decision, out of scope here.

## 15. Attribution

Data: Zhao et al., "WildChat: 1M ChatGPT Interaction Logs in the Wild," ICLR 2024, and Deng et al., "WildVis," EMNLP 2024 Demos. Dataset licensed under ODC-By 1.0.
