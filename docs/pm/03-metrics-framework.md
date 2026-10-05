# Metrics framework

**What this is for:** Define, before any pipeline code runs, exactly what Loupe measures about an assistant's usage, why, and where each number is honest versus biased.
**Date:** 2026-09-20
**Status:** Final

## Purpose

This document defines the analysis metrics: the numbers Loupe computes about the assistant it is pointed at (volume, intensity, intent, friction, data quality). It is distinct from Loupe's own product success metrics (weekly answered questions, adoption, retention, and the rest of Loupe-as-a-product's metrics tree), which live in the PRD (`04-prd.md`) under "Success metrics." Nothing in this document measures whether Loupe itself is succeeding; it only measures the thing Loupe points at.

Definitions are the contract the SQL implements; the SQL files are named per row so a reader can check each one. The SQL in `loupe/metrics/*.sql` is the executable form of this document, not the other way around: if the two disagree, this document is wrong and the query gets fixed to match it, or vice versa with a note in the decision log.

## North star

**Weekly returning pseudo-users**: of the pseudo-users active in week W, the share also active in week W+1 (`intensity_weekly.sql`, column `return_rate`).

**Why this one.** It captures both reach (a pseudo-user has to show up at all) and stickiness (they have to come back) in a single number, and it is the one metric in the framework that moves only when the assistant is actually useful to people — volume can rise from population growth alone, and intensity can rise from a shrinking population of power users. Return is the number a product manager should watch weekly, per the spec's user scenario (design spec Section 4).

**Bias caveat.** The pseudo-user key is a hash of `hashed_ip`, user agent, and accept-language (`loupe/text.py:pseudo_user`), not a login. It merges people behind a shared network (a household, a NAT, a school lab) into one pseudo-user, which understates the true user count and overstates per-user intensity. It also splits one real person across devices or networks into multiple pseudo-users, which overstates the user count and understates return, because the same person looks like two people who each showed up once. Both biases run in opposite directions on the return-rate number, and neither can be corrected from this data; the framework reports return as a bounded estimate, never as "unique users," and the caveat is repeated in every view that shows it.

A second, sharper problem with this specific dataset: pseudo-user key persistence is not stable across the collection period. The share of a quarter's pseudo-users active in more than one week falls from 8.5% (2024 Q3) to 0.8% (2024 Q4) — a collection-side change, not a real behavior change (`pseudo_user_persistence_quarterly.sql`). Week-over-week return is therefore not comparable across that boundary, and any trend line crossing 2024 Q3→Q4 must say so or it reads as a product collapse that never happened. `return_rate` is also `NULL`, by construction, for the 3 of 119 complete weeks with no following week in the data (including the final week), rather than a false 0.0 that would read as total churn.

## Metric families

**Volume.** Conversations, turns, and (where available) tokens, counted per day and per week, sliced by model family, country, and language. This is the reach layer: how much traffic exists and who sends it. It says nothing about whether that traffic was satisfied.

**Intensity.** How hard the population that does show up uses the assistant: conversations per pseudo-user per week (median and p90), the distribution of turns per conversation, the share of a week's conversations coming from its top 10% of pseudo-users, and week-over-week return. This is the layer that tells a PM whether growth is broad or concentrated in a shrinking core.

**Intent.** What people are trying to do, assigned from a fixed seven-class taxonomy (`loupe/taxonomy.json`, version v2; the ten-class v1 draft is kept in `loupe/taxonomy_v1.json`), by an LLM on a stratified ~10,000-conversation sample and then extended to the full corpus by a lightweight classifier trained on that sample. Reported per week, per model family, and per language, always with the classifier's held-out accuracy attached so a reader can weigh how much to trust the extension beyond the labeled sample.

**Friction.** Where the assistant fails people, computed from conversation structure alone (no content scoring, no LLM judge): a repeated request, a one-turn abandonment, a correction follow-up, and a refusal pattern. Each proxy is a rate per conversation, sliceable by intent and model family, and each is validated against 300 hand labels before it is trusted (see "Friction proxy validation" below). A proxy that fails validation is dropped from the dashboard, not shipped with a caveat.

**Data quality.** How much to trust the other four families: the PII-redaction rate, the empty-user-input rate (conversations excluded from intent and friction because there is no real request to analyze), and the coverage window of fields that were not collected from the start (tokens) or that fail on some fraction of rows (country, language). Every other family's numbers should be read next to this one.

## Definitions

Grain, SQL file, and suppression rule for every column in every committed aggregate. `min_cell` is 20 by default (`loupe/stages/metrics.py:run`); a row is suppressed if a slice's conversation count falls below it.

| Metric (column) | Grain | Definition | SQL file | Suppression rule |
|---|---|---|---|---|
| date | conversation, per day, per model | Calendar date of the conversation's first turn. | `volume_daily_model.sql` | None. |
| model | conversation, per day, per model | Model family (see below); the point-release suffix is stripped. | `volume_daily_model.sql` | None. |
| conversations | conversation, per day, per model | Count of conversations. | `volume_daily_model.sql` | None. |
| turns | conversation, per day, per model | Sum of `n_turns` (user+assistant turns) across conversations in the cell. | `volume_daily_model.sql` | None. |
| prompt_tokens | conversation, per day, per model | Sum of prompt tokens, over conversations where the field exists. | `volume_daily_model.sql` | None; interpret only alongside `conversations_with_tokens`. |
| completion_tokens | conversation, per day, per model | Sum of completion tokens, same coverage caveat as `prompt_tokens`. | `volume_daily_model.sql` | None; interpret only alongside `conversations_with_tokens`. |
| conversations_with_tokens | conversation, per day, per model | Count of conversations in the cell that actually carry token-usage fields. | `volume_daily_model.sql` | None; this is the normalizer for the two token sums. |
| week, country | conversation, per week, per country | Weekly conversation and distinct-pseudo-user count by country. | `volume_weekly_country.sql` | Nothing is dropped: conversations with no country in the logs are published as a `not recorded` row per week (6.79% of conversations) and cells under `min_cell` are folded into a `small cells` row (1.49%), so rows always sum to the weekly total. |
| pseudo_users (by country) | conversation, per week, per country | Distinct pseudo-users in the cell. | `volume_weekly_country.sql` | Same as above; `NULL` on the two residual rows (a distinct count across a heterogeneous residual is not meaningful). |
| week, language | conversation, per week, per language | Weekly conversation count by detected language. | `volume_weekly_language.sql` | Same two residual rows as country: `not recorded` (none in this corpus; every conversation has a detected language) and `small cells` (0.82%). |
| pseudo_users (weekly) | pseudo-user, per week | Distinct pseudo-users active in the week. | `intensity_weekly.sql` | None (population-level; no small-cell exposure). |
| convs_per_user_p50 / p90 | pseudo-user, per week | Median and 90th-percentile conversations per pseudo-user that week. | `intensity_weekly.sql` | None. |
| top10_share | pseudo-user, per week | Share of the week's conversations coming from its top 10% of pseudo-users by volume. | `intensity_weekly.sql` | None. |
| return_rate | pseudo-user, per week | Of pseudo-users active in week W, the share also active in W+1. | `intensity_weekly.sql` | `NULL` when week W+1 is absent from the data (`next_week_present = false`); not comparable across the 2024 Q3→Q4 persistence break (see North star). |
| return_rate (per model) | pseudo-user × model family, per week | Of pseudo-users who used model M in week W, the share who used M again in W+1: model retention, not any-model return. | `intensity_weekly_model.sql` | Same `NULL` rule; week × model cells with fewer than `min_cell` pseudo-users are suppressed. Chosen over "active on any model in W+1" because that mixes traffic migration between models into the number. Powers the dashboard's model filter. |
| per-model weekly cuts | week × model family | `intent_weekly`, `friction_weekly` and `data_quality_weekly` recomputed per model family. | `*_weekly_model.sql` | Cells under `min_cell` conversations suppressed; summing over models recovers the all-model weekly totals (tested). |
| quarter, pseudo_users, avg_weeks_active, share_multi_week | pseudo-user, per quarter | How many distinct weeks a quarter's pseudo-users are seen active; `share_multi_week` is the fraction active in more than one week. | `pseudo_user_persistence_quarterly.sql` | None; this metric exists to diagnose the return-rate break, not to feed the dashboard's headline numbers directly. |
| model, depth_bucket, conversations, median_turns | conversation, per model, per turn-count bucket (1 / 2 / 3-5 / 6-10 / 11+) | Distribution of conversation depth by model family. | `depth_by_model.sql` | None. |
| week, intent, conversations | conversation, per week, per intent | Weekly conversation count by intent class, over conversations with a non-null intent label. | `intent_weekly.sql` | None; conversations with no intent label (unclassified, or excluded for empty input) are excluded from the numerator, so shares are of *labeled* traffic only. |
| model, intent, conversations | conversation, per model, per intent | Conversation count by intent class and model family. | `intent_by_model.sql` | None. |
| language, intent, conversations | conversation, per language (top 10 by volume), per intent | Conversation count by intent class, restricted to the ten most common detected languages. | `intent_by_language.sql` | Cells under `min_cell` are dropped from this table (not rolled into a residual row, unlike the volume tables). |
| intent, model, conversations, repeat_rate, one_and_done_rate, correction_rate, refusal_rate | conversation, per intent, per model | Friction proxy rates within each intent × model cell, over conversations with a non-empty user input and a labeled intent. | `friction_by_intent_model.sql` | Cells under `min_cell` are dropped. |
| week, conversations, repeat_rate, one_and_done_rate, correction_rate, refusal_rate | conversation, per week | Friction proxy rates over time, over conversations with non-empty user input. | `friction_weekly.sql` | None. |
| week, conversations, redacted_rate, empty_input_rate, token_usage_coverage | conversation, per week | Share of conversations redacted for PII, share with an empty user input, and share carrying usable token fields. | `data_quality_weekly.sql` | None. |

**Model family.** `model_family` strips a trailing date, year, or `-preview` suffix from the raw `model` string (`loupe/stages/metrics.py:_MODEL_FAMILY_SQL`), so `gpt-4o-2024-05-13` and `gpt-4o` both roll up to `gpt-4o`. This is why slices read as `gpt-4o` rather than as dated point releases.

## Known biases

| Metric | Bias source | Direction | What we do about it |
|---|---|---|---|
| Pseudo-user counts, return rate, top10_share | Pseudo-user merging: a hashed IP shared by a household, NAT, or school lab collapses several real people into one pseudo-user. | Under-counts distinct users; over-states per-user intensity and top10_share (fewer "users" absorb the same volume). | State the merge direction wherever pseudo-user counts appear; never call a pseudo-user a "user" in any public-facing copy. |
| Pseudo-user counts, return rate | Pseudo-user splitting: one real person across devices, browsers, or networks gets a different key each time. | Over-counts distinct users; under-states return rate (the same person's second visit looks like a different user's first). | Same disclosure; report return as a bounded estimate, not a precise figure. |
| Intent mix, volume composition | Population skew: this population came to a free public chatbot seeking free GPT-4-class access, not a representative slice of AI assistant users. | Skews intent mix and model mix toward whatever this population sought (e.g., coding and homework help are likely over-represented relative to a paid enterprise assistant's traffic). | State the population caveat everywhere findings are shown; claims are scoped to "this dataset's population," never "AI assistant users in general." |
| Token volume, token coverage | Token-usage fields were only added to the collection pipeline partway through: they exist from 2024-09-09 onward and, even then, cover a minority of conversations. | Under-counts token volume for the full window; any token-per-conversation average computed without normalizing by `conversations_with_tokens` is biased toward the covered minority. | Report token metrics only over the window they exist in, state that window explicitly, and always normalize by `conversations_with_tokens`. |
| Language and country mix | Language/country detection failures: 6.79% of conversations have no country in the logs and another 1.49% sit in cells under the floor; both are published as explicit residual rows (`not recorded`, `small cells`) rather than dropped silently; the language detector also produces implausible labels on garbled or emoji-heavy text (for example, "Yoruba" appears among the top-8 detected languages in this corpus, almost certainly a detector artifact rather than genuine Yoruba traffic at that scale). | Under-counts the true top languages/countries; overstates the share attributed to whichever spurious label the detector defaults to. | Publish both residual shares explicitly instead of dropping them; flag any language whose share looks implausible relative to known WildChat detector quirks before citing it in the trends report. |
| Intent shares (full corpus) | Classifier error propagation: held-out accuracy is 78.6% (gate 78.4%, 90% of the 87.1% inter-rater agreement); errors concentrate between questions, writing_and_business, and other, and the classifier over-calls other by about three points against the labeled sample. The labeled sample over-weights tail languages against its per-stratum floor (English 42% of the sample vs. 52.5% of the corpus), so accuracy is measured on a tail-heavy mix. | Classifier error on the full corpus may differ from (plausibly worse than, if tail languages are harder) the reported held-out accuracy; any systematic per-language error further skews intent shares by language. | Report held-out accuracy and macro-F1 alongside every intent number; do not report intent shares by language below the classifier's accuracy gate without saying so; a language whose intent labels look suspicious gets called out in the trends report rather than silently trusted. |

## Intent taxonomy

Seven classes (`loupe/taxonomy.json`, version `v2`, revised 2026-09-26):

| Class | Definition | Merged from (v1) |
|---|---|---|
| coding | Writing, fixing, explaining, or converting code, scripts, SQL, configs, or software errors. | |
| questions | Asking for information, explanations, definitions, comparisons, recommendations, or advice, whether for school, work, or the person's own life. | information_seeking, homework_study, personal_advice |
| writing_and_business | Drafting, rewriting, summarizing, or proofreading text of any kind: emails, essays, posts, reports, marketing copy, resumes, business plans, or workplace documents. | writing_editing, business_professional |
| creative_roleplay | Fiction, poems, stories, character roleplay, dialogue, or interactive scenarios. | |
| image_prompting | Generating or refining prompts for image models such as Midjourney or Stable Diffusion, or describing images to generate. | |
| translation | Translating text between languages, or asking about grammar, vocabulary, or usage in another language. | |
| other | Anything else: greetings, tests of the assistant, gibberish, or requests that fit no class above. | |

**How it was revised.** Labeling ran with the ten-class v1 taxonomy on 9,829 conversations (claude-sonnet-5 through the UCSD TritonAI gateway). The first classifier trained on those labels scored 72% held-out against the 85% gate, and every cheap improvement (word features, more data, English only, a multilingual embedding model) topped out under 80%. The confusions sat almost entirely among information_seeking, homework_study, personal_advice, and between writing_editing and business_professional. An inter-rater study then had a second model (gemini-3.5-flash) label 348 of the same conversations: the two raters agreed 83.6% of the time on ten classes and 87.1% on the merged seven. A classifier cannot be expected to exceed the agreement of the raters that produced its labels, so the overlapping classes were merged (provenance recorded per class in `loupe/taxonomy.json`), the v1 labels were mapped forward without relabeling, and the gate was restated as 90% of measured inter-rater agreement (78.4% for v2). The results are in `aggregates/intent_rater_agreement.json` and `aggregates/intent_classifier_report.json`; the procedure is `scripts/rater_agreement.py`.

**Classifier accuracy.** Held-out accuracy 78.6% on 1,966 conversations (macro F1 0.805), gate 78.4%, passed without override. Per-class F1: image_prompting 0.93, coding 0.84, translation 0.83, other 0.80, creative_roleplay 0.75, questions 0.76, writing_and_business 0.72. The model is a character plus word n-gram TF-IDF with logistic regression; a multilingual sentence-embedding model (multilingual-e5-small) was tested and scored lower (78% on the seven-class taxonomy), which supports the label-ceiling reading. Calibration: on the labeled sample itself the seven class shares differ from the classifier's full-corpus shares by at most three points, with the classifier over-calling "other" by about three points.

## How this site measures itself

The PRD defines Loupe's own metrics tree and, until 2026-10-05, nothing measured it. The site now runs PostHog (US cloud, free tier) with session replay on, disclosed in every footer. It measures visitors to this site, not the WildChat data, which is never tracked at row level anywhere.

Events, each mapped to the question it answers:

| Event | Fires when | Answers |
|---|---|---|
| `$pageview`, `$pageleave` | any page | Where visitors come from (LinkedIn, GitHub, shankard.com, direct) and how long they stay |
| `story_beat_reached` | each of the four story beats first appears | How far the story carries a reader before they leave |
| `link_click` | a call to action or outbound link (`nav_open_dashboard`, `beat4_open_dashboard`, `finale_open_dashboard`, `finale_read_docs`, `resume`, `github`, `personal_site`) | Whether the story converts into the dashboard, the docs, or the resume, and from which point |
| `view_opened` | a dashboard tab opens, with the active model filter | Which of the seven views people use |
| `model_filter` | the model picker changes | Whether anyone uses the cross-view filter |
| `series_isolated` | a legend chip isolates or compares a series | Whether the interactive legends get used |
| `dashboard_loaded`, `dashboard_failed` | DuckDB-WASM finishes or fails, with milliseconds | Load time and failure rate of the fragile part |
| `query_run` | the Query tab runs SQL | Whether anyone goes past the prepared views |
| `eval_scorer_used` | a score is typed into the usage-weighted scorer | Whether the second built artifact is tried |
| `read_depth` | 50% and 90% of a document or the story is scrolled | Which documents are read, not just opened |

Local previews never record. What to do with it: after two weeks, read the funnel from story to dashboard to docs, the per-view usage, and the dashboard load times, and write down what the numbers say should change. That note belongs in the retro.

## Attribution: who is answerable for friction

Friction is read from the user's side of a conversation: a repeated request or a correction is something the person did in reaction to the reply they had just received. Loupe therefore attributes each friction event to the responder that produced that reply, turn by turn (`loupe/attribution.py`), and rolls up from there. The `turns` table carries `attributed_to`: on an assistant turn, its producer; on a user turn, the producer of the reply it reacts to. The first user turn reacts to nothing and is attributed to no one. `friction_by_responder.sql` publishes repeats and corrections per 1,000 replies by responder.

In WildChat one model answers every turn, so per-responder equals per-model and the aggregate is a consistency check on the by-model cut. The design exists for the case an outside reader raised: an orchestrator that hands turns to several sub-assistants, where the user sees only the final reply and blame cannot be read from the text. The adapter contract is a single optional field, `responder`, logged on each assistant message. With it, friction splits by sub-assistant with no further code. Without it, every reply is charged to the conversation's default model and Loupe reports at that level rather than infer a culprit from content.

**Inferred versus reported failure.** These logs carry no explicit feedback: no thumbs-down, no rating, no regenerate click. Every friction signal here is therefore inferred from conversation structure, and the validation below is the test of whether those inferences hold. On a team's own logs that do carry feedback events, those events are the primary friction signal, attributed per turn in exactly the same way, and the structural proxies become supporting evidence. The flatten adapter is where a team maps such events in.

<!-- loupe-check id=responder-families
sql: SELECT count(*) FROM 'aggregates/friction_by_responder.parquet' r WHERE r.responder NOT IN (SELECT DISTINCT model FROM 'aggregates/volume_daily_model.parquet')
expect: 0
-->

## Friction proxy validation

Four proxies, each computed from conversation structure alone (`loupe/text.py`), with exact rules:

- **repeated_request**: the current user turn's word-token Jaccard similarity to the immediately preceding user turn is at or above 0.6 (`REPEAT_THRESHOLD`, `loupe.text.is_repeat` / `jaccard`).
- **correction_followup**: a user turn matches an anchored correction pattern at the start of the turn, in English, Chinese, Russian, Spanish, or French (`loupe.text._CORRECTION`; e.g., English "no,", "not what/that", "wrong", "that's not/wrong", "i said/meant", "incorrect", "you didn't", "try again", explicitly excluding "no problem/worries/thanks/need"; equivalent anchored patterns for zh, ru, es, fr).
- **assistant_refusal**: an assistant turn matches an anchored refusal pattern at the start of the turn, in English, Chinese, or Russian (`loupe.text._REFUSAL`; e.g., "I'm sorry", "I cannot/can't help/assist/provide/...", "I'm unable", "as an AI", "unfortunately I cannot"; equivalent patterns for zh, ru).
- **one_and_done**: the conversation has exactly one turn and its assistant reply is under 200 characters (`ONE_AND_DONE_MAX_ASSISTANT_CHARS`, `loupe/schema.py`).

**Labeling procedure.** 300 conversations are exported by `scripts/export_friction_sample.py` (random sample, 1-6 turns, no empty user input, seed 11) to a local, gitignored CSV under `samples/`. Each row is hand-labeled per `docs/pm/research/friction-labeling-guide.md` for `got_what_they_came_for`, `is_repeat`, `is_correction`, and `is_refusal`. The labeled columns (text columns dropped) are committed to `docs/pm/research/friction_labels.csv`. `scripts/friction_precision.py` joins those labels against the corresponding proxy flags in the flat conversation table and computes, per proxy, predicted count, true positives, and precision; `one_and_done` has no directly corresponding human label, so it is judged instead against the outcome column (`got_what_they_came_for == 0`, i.e., did abandoning after one short reply actually track with not getting what they came for).

**Precision table (2026-10-04, model-labeled).** No human labeler was available in the project window, so the first validation pass used the same approach the intent work did: a model labels, a second model checks agreement, and the result is reported as a model's judgment rather than ground truth. 399 conversations from one shard were sampled, stratified so each proxy had about 75 fired cases plus 100 with nothing fired; 377 parsed. The labeler was claude-sonnet-5 at temperature 0 following the labeling guide verbatim; gemini-3.5-flash relabeled a 53-conversation slice and agreed on 94% to 100% of the behavior labels and 83% of the outcome label. Labels (no conversation text) are in `docs/pm/research/friction_labels.csv`; the full result is `docs/pm/research/friction_precision.json`.

| proxy | flagged | labeler agreed | precision | recall on sample | verdict |
|---|---|---|---|---|---|
| correction_followup | 72 | 69 | **0.96** | 0.76 | keep |
| repeated_request | 78 | 61 | **0.78** | 0.60 | keep |
| assistant_refusal | 116 | 52 | **0.45** | 0.73 | **dropped from the dashboard** |
| one_and_done (as a failure signal) | 76 | 31 | **0.41** | n/a | **reframed as depth, not friction** |

<!-- loupe-check id=precision-correction
sql: SELECT round(correction_followup.precision, 2) FROM read_json_auto('docs/pm/research/friction_precision.json')
expect: 0.96
tolerance: 0.005
-->
<!-- loupe-check id=precision-repeat
sql: SELECT round(repeated_request.precision, 2) FROM read_json_auto('docs/pm/research/friction_precision.json')
expect: 0.78
tolerance: 0.005
-->
<!-- loupe-check id=precision-refusal
sql: SELECT round(assistant_refusal.precision, 2) FROM read_json_auto('docs/pm/research/friction_precision.json')
expect: 0.45
tolerance: 0.005
-->
<!-- loupe-check id=precision-oad
sql: SELECT round(one_and_done.precision, 2) FROM read_json_auto('docs/pm/research/friction_precision.json')
expect: 0.41
tolerance: 0.005
-->
<!-- loupe-check id=precision-n
sql: SELECT n_labels FROM read_json_auto('docs/pm/research/friction_precision.json')
expect: 377
-->

**Why refusal failed.** 49 of the 64 false positives begin "As an AI language model, I…" and then answer the question in full ("…I don't have an accent, but here are some tips"). That is a verbal habit of the 2023 models, not a refusal. Removing the "as an AI" clause raises precision to 0.66 at the cost of recall (0.58); requiring a short reply as well reaches 0.69 to 0.72 but catches under half of real refusals. No pattern variant clears the gate with usable recall, so refusal needs a different detector (a model judgment on the reply, or a reply-length-and-pattern rule validated on a larger sample) before it returns. Refusal rates stay in the aggregates for anyone who wants them; the dashboard does not show them.

**Why one_and_done failed as a failure signal.** 59% of the conversations it flags ended with the person getting what they came for: short factual questions answered correctly, greetings and tests answered sensibly, a one-shot code fix. Among real requests only (excluding "other") the figure is 60%, so the problem is not junk traffic. The rule measures brevity well and failure badly. It stays on the dashboard as "ended in one turn", an engagement-depth measure, and is no longer called friction. The routing counterfactual (`10-routing-counterfactual.md`), which chose policies on this measure, now reports the two validated signals alongside it; both move in the same direction under every policy.

**What holds.** Conversations flagged by any proxy really are worse: 41% of flagged conversations ended without the person getting what they wanted, against 25% of unflagged ones, so the signals point the right way even where two of them fire too often.

A proxy scoring under 0.70 precision is **dropped from the dashboard entirely**, not shipped with a softened label or a caveat. The 0.70 gate is the design spec's shipping threshold (Section 6.2, Section 13). This rule was applied on 2026-10-04 to assistant_refusal, and one_and_done was reclassified rather than softened. A human relabel of the same 377 conversations is the next step and the labels file is laid out for it.

## Queries

Every number in this document, the dashboard, and the trends report is reproducible from the committed aggregates in `aggregates/`, either in the dashboard's "Query" panel (DuckDB-WASM against the aggregate parquet files, in the browser) or locally with DuckDB against the same files. Nothing in either path touches raw transcript content: the aggregates carry no `conv_id`-to-text mapping.

**Worked example: this week's return rate and top10_share, most recent complete week.**

```sql
SELECT week, pseudo_users, conversations, return_rate, top10_share
FROM read_parquet('aggregates/intensity_weekly.parquet')
WHERE week = (
  SELECT max(week) FROM read_parquet('aggregates/intensity_weekly.parquet') WHERE next_week_present
)
ORDER BY week;
```

Run locally: `uv run python -c "import duckdb; print(duckdb.sql(open('query.sql').read()).fetchall())"`, or paste the same SQL into the dashboard's Query view, which runs it against the same committed parquet files via DuckDB-WASM. `next_week_present` in the `WHERE` clause is deliberate: it excludes the trailing week whose `return_rate` is `NULL` by construction (see "North star"), so the query returns the most recent week for which return is actually measurable.
