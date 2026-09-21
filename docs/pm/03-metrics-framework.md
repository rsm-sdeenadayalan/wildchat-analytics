# Metrics framework

**What this is for:** Define, before any pipeline code runs, exactly what Loupe measures about an assistant's usage, why, and where each number is honest versus biased.
**Date:** 2026-09-20
**Status:** Draft

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

**Intent.** What people are trying to do, assigned from a fixed ten-class taxonomy (`loupe/taxonomy.json`), by an LLM on a stratified ~20,000-conversation sample and then extended to the full corpus by a lightweight classifier trained on that sample. Reported per week, per model family, and per language, always with the classifier's held-out accuracy attached so a reader can weigh how much to trust the extension beyond the labeled sample.

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
| week, country | conversation, per week, per country | Weekly conversation and distinct-pseudo-user count by country. | `volume_weekly_country.sql` | Cells under `min_cell` and conversations with no usable country are not dropped; their total is published as one `suppressed_or_unknown` row per week. |
| pseudo_users (by country) | conversation, per week, per country | Distinct pseudo-users in the cell. | `volume_weekly_country.sql` | Same as above; `NULL` on the `suppressed_or_unknown` row (distinct count across a heterogeneous residual is not meaningful). |
| week, language | conversation, per week, per language | Weekly conversation count by detected language. | `volume_weekly_language.sql` | Cells under `min_cell` and conversations with no usable language roll into one `suppressed_or_unknown` row per week. |
| pseudo_users (weekly) | pseudo-user, per week | Distinct pseudo-users active in the week. | `intensity_weekly.sql` | None (population-level; no small-cell exposure). |
| convs_per_user_p50 / p90 | pseudo-user, per week | Median and 90th-percentile conversations per pseudo-user that week. | `intensity_weekly.sql` | None. |
| top10_share | pseudo-user, per week | Share of the week's conversations coming from its top 10% of pseudo-users by volume. | `intensity_weekly.sql` | None. |
| return_rate | pseudo-user, per week | Of pseudo-users active in week W, the share also active in W+1. | `intensity_weekly.sql` | `NULL` when week W+1 is absent from the data (`next_week_present = false`); not comparable across the 2024 Q3→Q4 persistence break (see North star). |
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
| Language and country mix | Language/country detection failures: 8.29% of conversations have no usable country and are published as a `suppressed_or_unknown` residual row rather than dropped silently; the language detector also produces implausible labels on garbled or emoji-heavy text (for example, "Yoruba" appears among the top-8 detected languages in this corpus, almost certainly a detector artifact rather than genuine Yoruba traffic at that scale). | Under-counts the true top languages/countries; overstates the share attributed to whichever spurious label the detector defaults to. | Publish the suppressed/unknown share explicitly instead of dropping it; flag any language whose share looks implausible relative to known WildChat detector quirks before citing it in the trends report. |
| Intent shares (full corpus) | Classifier error propagation: the ~20,000-conversation labeled sample over-weights tail languages against its per-stratum floor (e.g., English is 42% of the sample vs. 52.5% of the corpus; Yoruba is 5.0% of the sample vs. 2.9% of the corpus), so held-out accuracy is measured on a tail-heavy sample, and the classifier trained on that sample is then applied to the full, English-heavier corpus. | Classifier error on the full corpus may differ from (plausibly worse than, if tail languages are harder) the reported held-out accuracy; any systematic per-language error further skews intent shares by language. | Report held-out accuracy and macro-F1 alongside every intent number; do not report intent shares by language below the classifier's accuracy gate without saying so; a language whose intent labels look suspicious gets called out in the trends report rather than silently trusted. |

## Intent taxonomy

Ten classes (`loupe/taxonomy.json`, version `v1`):

| Class | Definition |
|---|---|
| coding | Writing, fixing, explaining, or converting code, scripts, SQL, configs, or software errors. |
| writing_editing | Drafting, rewriting, summarizing, or proofreading non-fiction text: emails, essays, posts, letters, reports. |
| creative_roleplay | Fiction, poems, stories, character roleplay, dialogue, or interactive scenarios. |
| image_prompting | Generating or refining prompts for image models such as Midjourney or Stable Diffusion, or describing images to generate. |
| homework_study | School or exam questions, worked problems, definitions to study, or explanations of academic concepts for learning. |
| information_seeking | Factual questions, recommendations, comparisons, how-to or general knowledge not tied to schoolwork. |
| translation | Translating text between languages, or asking about grammar, vocabulary, or usage in another language. |
| business_professional | Marketing copy, product descriptions, business plans, analysis, resumes, job applications, or workplace tasks. |
| personal_advice | Advice about relationships, health, mental wellbeing, finances, or life decisions for the person asking. |
| other | Anything else: greetings, tests of the assistant, gibberish, or requests that fit no class above. |

**How it was finalized.** The design spec drafted nine candidate classes (Section 9); `image_prompting` was added as a tenth after the finalization pass, because a meaningful share of hand-read conversations were prompt-engineering requests for an image model that did not fit `creative_roleplay` or `information_seeking` without stretching either definition. The taxonomy was finalized by hand-reading 200 sampled conversations against the draft class list, noting every conversation an author found ambiguous or a poor fit, and adjusting class boundaries and the `other` catch-all until the ambiguous count stopped falling with further edits. Any conversation an intent class does not clearly cover routes to `other` rather than forcing a borderline fit into a more specific class.

**Classifier accuracy.** The LLM-labeled sample and the lightweight classifier's held-out agreement, plus macro-F1, are read from `aggregates/intent_classifier_report.json`, written by the classify stage. Intent labeling has not run on this build (`aggregates/meta.json` reports `intent_coverage: "none"`, `intent_labeled_conversations: 0`), so classifier accuracy and macro-F1 are **pending** here until that stage runs. The shipping gate, unchanged by that: 85% agreement or higher on the held-out slice (design spec Section 6.2, Section 13). Below that gate, intent metrics ship over the labeled sample only, with that scope stated, per the design spec's risk mitigation (Section 15).

## Friction proxy validation

Four proxies, each computed from conversation structure alone (`loupe/text.py`), with exact rules:

- **repeated_request**: the current user turn's word-token Jaccard similarity to the immediately preceding user turn is at or above 0.6 (`REPEAT_THRESHOLD`, `loupe.text.is_repeat` / `jaccard`).
- **correction_followup**: a user turn matches an anchored correction pattern at the start of the turn, in English, Chinese, Russian, Spanish, or French (`loupe.text._CORRECTION`; e.g., English "no,", "not what/that", "wrong", "that's not/wrong", "i said/meant", "incorrect", "you didn't", "try again", explicitly excluding "no problem/worries/thanks/need"; equivalent anchored patterns for zh, ru, es, fr).
- **assistant_refusal**: an assistant turn matches an anchored refusal pattern at the start of the turn, in English, Chinese, or Russian (`loupe.text._REFUSAL`; e.g., "I'm sorry", "I cannot/can't help/assist/provide/...", "I'm unable", "as an AI", "unfortunately I cannot"; equivalent patterns for zh, ru).
- **one_and_done**: the conversation has exactly one turn and its assistant reply is under 200 characters (`ONE_AND_DONE_MAX_ASSISTANT_CHARS`, `loupe/schema.py`).

**Labeling procedure.** 300 conversations are exported by `scripts/export_friction_sample.py` (random sample, 1-6 turns, no empty user input, seed 11) to a local, gitignored CSV under `samples/`. Each row is hand-labeled per `docs/pm/research/friction-labeling-guide.md` for `got_what_they_came_for`, `is_repeat`, `is_correction`, and `is_refusal`. The labeled columns (text columns dropped) are committed to `docs/pm/research/friction_labels.csv`. `scripts/friction_precision.py` joins those labels against the corresponding proxy flags in the flat conversation table and computes, per proxy, predicted count, true positives, and precision; `one_and_done` has no directly corresponding human label, so it is judged instead against the outcome column (`got_what_they_came_for == 0`, i.e., did abandoning after one short reply actually track with not getting what they came for).

**Precision table.** Labeling has not run yet; the table below carries the four proxies with the column pending until `docs/pm/research/friction_labels.csv` is populated and `scripts/friction_precision.py` is run (its output overwrites this table with the real numbers, per the labeling guide).

| proxy | predicted | true positives | precision |
|---|---|---|---|
| repeated_request | pending | pending | pending |
| correction_followup | pending | pending | pending |
| assistant_refusal | pending | pending | pending |
| one_and_done | pending | pending | pending |

A proxy scoring under 0.70 precision against the hand labels is **dropped from the dashboard entirely**, not shipped with a softened label or a caveat. The 0.70 gate is the design spec's shipping threshold (Section 6.2, Section 13).

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
