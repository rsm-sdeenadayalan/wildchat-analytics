# Trends report: what 3.2 million conversations say about using an AI assistant

**What this is for:** Give a product owner findings about real usage of a free public GPT-style assistant, each tied to a live dashboard view and a number anyone can re-run against the aggregates.
**Date:** 2026-09-20
**Status:** Draft

## Read this first

This report covers 3,199,860 conversations collected between 2023-04-09 and 2025-07-31.

<!-- loupe-check id=intro-total
sql: SELECT sum(conversations) FROM 'aggregates/volume_daily_model.parquet'
expect: 3199860
tolerance: 0.5
-->
<!-- loupe-check id=intro-date-min
sql: SELECT date_min::VARCHAR FROM read_json_auto('aggregates/meta.json')
expect: "2023-04-09"
-->
<!-- loupe-check id=intro-date-max
sql: SELECT date_max::VARCHAR FROM read_json_auto('aggregates/meta.json')
expect: "2025-07-31"
-->

Two caveats apply to every finding below. First, this population came to a free public chatbot hosted by the WildChat researchers, seeking free access to GPT-4-class models. It is not ChatGPT's own product and not a representative sample of AI assistant users generally; every claim here is scoped to this dataset's population. Second, "users" in this report are pseudo-users: a hash of IP address, user agent, and accept-language, not a login. A pseudo-user can be a whole household or lab sharing a network, or one person split across several pseudo-users across devices. Distinct-user counts, return rate, and concentration are all biased by this, in both directions at once, and neither bias can be corrected from this data.

Intent findings (F8 to F11) use labels predicted for every conversation by a classifier trained on 9,829 model-labeled examples. The classifier scores 78.6% on held-out data, against a gate of 78.4% set at 90% of the agreement between two independent labeling models on the same conversations (87.1%). That study also drove a taxonomy revision from ten classes to seven, because raters could not separate information seeking, homework, and advice, or general writing from business writing. Read a five-point difference between intent classes as real and a two-point difference as noise. Details are in the metrics framework.

<!-- loupe-check id=intro-clf-acc
sql: SELECT round(classifier_accuracy, 3) FROM read_json_auto('aggregates/meta.json')
expect: 0.786
-->
<!-- loupe-check id=intro-clf-gate
sql: SELECT classifier_threshold FROM read_json_auto('aggregates/meta.json')
expect: 0.7836
-->
<!-- loupe-check id=intro-rater-agree
sql: SELECT classifier_rater_agreement FROM read_json_auto('aggregates/meta.json')
expect: 0.8707
-->
<!-- loupe-check id=intro-taxonomy
sql: SELECT classifier_taxonomy_version FROM read_json_auto('aggregates/meta.json')
expect: "v2"
-->

The WildChat paper already reports this corpus's overall language mix, per-conversation turn counts, and toxicity rates. Everything below goes past that: it tracks change over time, breaks the data by model family, and surfaces a measurement problem (F1) the paper's cross-sectional numbers cannot show.

## Findings

### F1: A collection change makes return-rate trends before and after late 2024 incomparable

Loupe's north-star metric, weekly return, depends on pseudo-user keys persisting across weeks. That persistence collapses at the 2024 Q3 to Q4 boundary: the share of a quarter's pseudo-users seen active in more than one week falls from 8.5% in 2024 Q3 to 0.8% in 2024 Q4.

<!-- loupe-check id=F1-q3
sql: SELECT round(share_multi_week,3) FROM 'aggregates/pseudo_user_persistence_quarterly.parquet' WHERE quarter = DATE '2024-07-01'
expect: 0.085
tolerance: 0.0005
-->
<!-- loupe-check id=F1-q4
sql: SELECT round(share_multi_week,3) FROM 'aggregates/pseudo_user_persistence_quarterly.parquet' WHERE quarter = DATE '2024-10-01'
expect: 0.008
tolerance: 0.0005
-->

This is a tenfold drop quarter over quarter, far larger than any plausible behavior shift, and almost certainly a change in how the collectors logged IP/user-agent keys, not a real collapse in returning traffic. **Implication for a product owner:** never read a return-rate chart spanning this boundary at face value; split it in two, or the "collapse" will look like a product failure that never happened. **What would falsify this:** the same drop in real, authenticated user return, not just pseudo-user key survival, would make this a genuine behavior change instead of a measurement artifact. Live view: dashboard Intensity tab (`#intensity`).

### F2: In the comparable era, return rate is stable in the low teens, not trending up or down

Restricting to weeks before the persistence break (2023-04 through 2024-08, where return_rate is defined), the first eight comparable weeks average a 12.9% return rate and the last eight comparable weeks average 13.6%.

<!-- loupe-check id=F2-first8
sql: SELECT round(avg(return_rate),3) FROM (SELECT return_rate FROM 'aggregates/intensity_weekly.parquet' WHERE week < DATE '2024-09-01' AND return_rate IS NOT NULL ORDER BY week LIMIT 8) t
expect: 0.129
tolerance: 0.0005
-->
<!-- loupe-check id=F2-last8
sql: SELECT round(avg(return_rate),3) FROM (SELECT return_rate FROM 'aggregates/intensity_weekly.parquet' WHERE week < DATE '2024-09-01' AND return_rate IS NOT NULL ORDER BY week DESC LIMIT 8) t
expect: 0.136
tolerance: 0.0005
-->

That is a flat-to-mildly-rising line, not the steep climb or decline a growth narrative might assume. **Implication for a product owner:** any "return is improving" or "return is decaying" story built on this window needs a bigger, sustained gap to be worth acting on. **What would falsify this:** a query over the full comparable window showing a large, monotonic trend rather than a narrow band would contradict "stable." Live view: dashboard Intensity tab (`#intensity`).

### F3: The assistant behind the logs changed several times, and for most of the period more than one model family served traffic

No single model family holds 95% or more of a given week's conversations in 73 of the dataset's 119 weeks (61.3%): multi-family serving is the common case, not the exception.

<!-- loupe-check id=F3-multiweek-share
sql: WITH weekly AS (SELECT date_trunc('week',date)::DATE AS week, model, sum(conversations) AS c FROM 'aggregates/volume_daily_model.parquet' GROUP BY 1,2), tot AS (SELECT week, sum(c) AS total FROM weekly GROUP BY 1), top AS (SELECT w.week, max(w.c*1.0/t.total) AS top_share FROM weekly w JOIN tot t USING(week) GROUP BY w.week) SELECT round(sum(CASE WHEN top_share<0.95 THEN 1 ELSE 0 END)*1.0/count(*),3) FROM top
expect: 0.613
tolerance: 0.0005
-->

From 2023-04-09 through about 2024-04, gpt-3.5-turbo and gpt-4 coexist: both hold at least 20% of weekly volume in 28 of 57 weeks, for example the week of 2023-12-04, when gpt-3.5-turbo took 52.4% and gpt-4 took 47.6%.

<!-- loupe-check id=F3-two-family-weeks
sql: WITH weekly AS (SELECT date_trunc('week',date)::DATE AS week, model, sum(conversations) AS c FROM 'aggregates/volume_daily_model.parquet' WHERE model IN ('gpt-3.5-turbo','gpt-4') GROUP BY 1,2), tot AS (SELECT date_trunc('week',date)::DATE AS week, sum(conversations) AS total FROM 'aggregates/volume_daily_model.parquet' GROUP BY 1), sh AS (SELECT w.week, sum(CASE WHEN w.model='gpt-4' THEN w.c ELSE 0 END)*1.0/t.total AS gpt4_share, sum(CASE WHEN w.model='gpt-3.5-turbo' THEN w.c ELSE 0 END)*1.0/t.total AS gpt35_share FROM weekly w JOIN tot t USING(week) GROUP BY w.week, t.total) SELECT count(*) FROM sh WHERE gpt4_share >= 0.2 AND gpt35_share >= 0.2
expect: 28
-->
<!-- loupe-check id=F3-dec-gpt35
sql: WITH weekly AS (SELECT date_trunc('week',date)::DATE AS week, model, sum(conversations) AS c FROM 'aggregates/volume_daily_model.parquet' GROUP BY 1,2), tot AS (SELECT week, sum(c) AS total FROM weekly GROUP BY 1) SELECT round(w.c*1.0/t.total,3) FROM weekly w JOIN tot t USING(week) WHERE w.week = DATE '2023-12-04' AND w.model='gpt-3.5-turbo'
expect: 0.524
tolerance: 0.0005
-->
<!-- loupe-check id=F3-dec-gpt4
sql: WITH weekly AS (SELECT date_trunc('week',date)::DATE AS week, model, sum(conversations) AS c FROM 'aggregates/volume_daily_model.parquet' GROUP BY 1,2), tot AS (SELECT week, sum(c) AS total FROM weekly GROUP BY 1) SELECT round(w.c*1.0/t.total,3) FROM weekly w JOIN tot t USING(week) WHERE w.week = DATE '2023-12-04' AND w.model='gpt-4'
expect: 0.476
tolerance: 0.0005
-->

gpt-4-turbo bridges the two eras briefly (22,392 conversations total) before a four-family period opens: gpt-4o (from 2024-05-13), gpt-4o-mini (from 2024-08-07), and o1 and o1-mini together (from 2024-09-12). In the week of 2024-09-09, gpt-4o holds 40.0%, gpt-4o-mini 29.0%, o1 25.4%, and o1-mini 5.7%.

<!-- loupe-check id=F3-turbo-total
sql: SELECT sum(conversations) FROM 'aggregates/volume_daily_model.parquet' WHERE model='gpt-4-turbo'
expect: 22392
-->
<!-- loupe-check id=F3-gpt4o-first
sql: SELECT min(date)::VARCHAR FROM 'aggregates/volume_daily_model.parquet' WHERE model = 'gpt-4o'
expect: "2024-05-13"
-->
<!-- loupe-check id=F3-gpt4o-mini-first
sql: SELECT min(date)::VARCHAR FROM 'aggregates/volume_daily_model.parquet' WHERE model = 'gpt-4o-mini'
expect: "2024-08-07"
-->
<!-- loupe-check id=F3-o1-first
sql: SELECT min(date)::VARCHAR FROM 'aggregates/volume_daily_model.parquet' WHERE model = 'o1'
expect: "2024-09-12"
-->
<!-- loupe-check id=F3-sep-gpt4o
sql: WITH weekly AS (SELECT date_trunc('week',date)::DATE AS week, model, sum(conversations) AS c FROM 'aggregates/volume_daily_model.parquet' GROUP BY 1,2), tot AS (SELECT week, sum(c) AS total FROM weekly GROUP BY 1) SELECT round(w.c*1.0/t.total,3) FROM weekly w JOIN tot t USING(week) WHERE w.week = DATE '2024-09-09' AND w.model='gpt-4o'
expect: 0.4
tolerance: 0.0005
-->
<!-- loupe-check id=F3-sep-gpt4o-mini
sql: WITH weekly AS (SELECT date_trunc('week',date)::DATE AS week, model, sum(conversations) AS c FROM 'aggregates/volume_daily_model.parquet' GROUP BY 1,2), tot AS (SELECT week, sum(c) AS total FROM weekly GROUP BY 1) SELECT round(w.c*1.0/t.total,3) FROM weekly w JOIN tot t USING(week) WHERE w.week = DATE '2024-09-09' AND w.model='gpt-4o-mini'
expect: 0.29
tolerance: 0.0005
-->
<!-- loupe-check id=F3-sep-o1
sql: WITH weekly AS (SELECT date_trunc('week',date)::DATE AS week, model, sum(conversations) AS c FROM 'aggregates/volume_daily_model.parquet' GROUP BY 1,2), tot AS (SELECT week, sum(c) AS total FROM weekly GROUP BY 1) SELECT round(w.c*1.0/t.total,3) FROM weekly w JOIN tot t USING(week) WHERE w.week = DATE '2024-09-09' AND w.model='o1'
expect: 0.254
tolerance: 0.0005
-->
<!-- loupe-check id=F3-sep-o1mini
sql: WITH weekly AS (SELECT date_trunc('week',date)::DATE AS week, model, sum(conversations) AS c FROM 'aggregates/volume_daily_model.parquet' GROUP BY 1,2), tot AS (SELECT week, sum(c) AS total FROM weekly GROUP BY 1) SELECT round(w.c*1.0/t.total,3) FROM weekly w JOIN tot t USING(week) WHERE w.week = DATE '2024-09-09' AND w.model='o1-mini'
expect: 0.057
tolerance: 0.0005
-->

By 2025, gpt-4.1-mini is dominant again, holding 100% of the last complete week in the dataset (2025-07-21).

<!-- loupe-check id=F3-last-week-share
sql: WITH weekly AS (SELECT date_trunc('week',date)::DATE AS week, model, sum(conversations) AS c FROM 'aggregates/volume_daily_model.parquet' GROUP BY 1,2), tot AS (SELECT week, sum(c) AS total FROM weekly GROUP BY 1) SELECT round(w.c*1.0/t.total,3) FROM weekly w JOIN tot t USING(week) WHERE w.week = DATE '2025-07-21' AND w.model='gpt-4.1-mini'
expect: 1.0
tolerance: 0.0005
-->

**Implication for a product owner:** model mix must be a first-class slice on every view; a trend line drawn without it risks confusing a model-mix shift with a real usage change. **What would falsify this:** a single family holding at least 95% of weekly volume for more than half of the 119 weeks would mean the corpus is effectively single-model, not the multi-family pattern described here. Live view: dashboard Overview tab (`#overview`).

### F4: Reasoning models here are used in a single turn, essentially always

Across the depth-by-model breakdown, both o1 and o1-mini show 100% of their conversations ending in exactly one turn. gpt-4.1-mini, the most recent non-reasoning model, is close behind at 96.0% one-turn, while gpt-3.5-turbo, the earliest model, is 65.0% one-turn.

<!-- loupe-check id=F4-reasoning
sql: SELECT round(sum(CASE WHEN depth_bucket='1' THEN conversations ELSE 0 END)*1.0/sum(conversations),3) FROM 'aggregates/depth_by_model.parquet' WHERE model IN ('o1','o1-mini')
expect: 1.0
tolerance: 0.0005
-->
<!-- loupe-check id=F4-41mini
sql: SELECT round(sum(CASE WHEN depth_bucket='1' THEN conversations ELSE 0 END)*1.0/sum(conversations),3) FROM 'aggregates/depth_by_model.parquet' WHERE model='gpt-4.1-mini'
expect: 0.96
tolerance: 0.0005
-->
<!-- loupe-check id=F4-gpt35
sql: SELECT round(sum(CASE WHEN depth_bucket='1' THEN conversations ELSE 0 END)*1.0/sum(conversations),3) FROM 'aggregates/depth_by_model.parquet' WHERE model='gpt-3.5-turbo'
expect: 0.65
tolerance: 0.0005
-->

A 100% one-turn rate for an entire model family is unusually clean and is at least as likely to reflect how those conversations were collected (a capped or single-shot logging window for reasoning models) as it is to reflect that every user got a complete answer in one message. **Implication for a product owner:** do not read "o1 satisfies people in one turn" from this number alone; check whether the collection pipeline capped these sessions before trusting it as a satisfaction signal. **What would falsify this:** a depth_by_model row for o1 or o1-mini with a bucket above "1" would directly falsify the 100% figure. Live view: dashboard Intensity tab, model filter (`#intensity`).

### F5: Structural friction proxies move in opposite directions across the model transitions; none are validated yet

Comparing the first eight weeks of the window to the last eight, one_and_done_rate (a conversation with exactly one short turn) rises from 8.3% to 46.8%, while assistant_refusal patterns fall from 11.3% to 0.6%. correction_followup stays low throughout, averaging 0.4% across the whole window.

<!-- loupe-check id=F5-oad-first8
sql: SELECT round(avg(one_and_done_rate),3) FROM (SELECT one_and_done_rate FROM 'aggregates/friction_weekly.parquet' ORDER BY week LIMIT 8) t
expect: 0.083
tolerance: 0.0005
-->
<!-- loupe-check id=F5-oad-last8
sql: SELECT round(avg(one_and_done_rate),3) FROM (SELECT one_and_done_rate FROM 'aggregates/friction_weekly.parquet' ORDER BY week DESC LIMIT 8) t
expect: 0.468
tolerance: 0.0005
-->
<!-- loupe-check id=F5-refusal-first8
sql: SELECT round(avg(refusal_rate),3) FROM (SELECT refusal_rate FROM 'aggregates/friction_weekly.parquet' ORDER BY week LIMIT 8) t
expect: 0.113
tolerance: 0.0005
-->
<!-- loupe-check id=F5-refusal-last8
sql: SELECT round(avg(refusal_rate),3) FROM (SELECT refusal_rate FROM 'aggregates/friction_weekly.parquet' ORDER BY week DESC LIMIT 8) t
expect: 0.006
tolerance: 0.0005
-->
<!-- loupe-check id=F5-correction-avg
sql: SELECT round(avg(correction_rate),3) FROM 'aggregates/friction_weekly.parquet'
expect: 0.004
tolerance: 0.0005
-->

These proxies are structural pattern matches, not hand-validated signals: per the metrics framework, each needs 0.70 precision against 300 hand labels before it can be trusted, and that labeling has not run. The one_and_done rise lines up closely with F4's reasoning-model and gpt-4.1-mini one-turn behavior, so it is plausibly the same collection effect, not real new abandonment. **Implication for a product owner:** do not brief "friction is dropping" or "abandonment is rising" from these numbers until the precision check runs; treat this as a hypothesis, not a result. **What would falsify this:** a one_and_done precision under 0.70 in the 300-label check would mean this trend should be dropped from the dashboard, not just caveated. Live view: dashboard Friction tab (`#friction`).

### F6: Geography and language are usable but not clean; one label is likely a detector artifact

8.29% of conversations carry no usable country and are published as a residual rather than dropped. Of conversations with a detected language, English is the majority at 52.5%, but "Yoruba" is the sixth most common label at 2.8% of all conversations, an implausible share for a language with far smaller global reach on English-language chatbots, and almost certainly a langdetect artifact on short or garbled text rather than genuine Yoruba usage at that scale.

<!-- loupe-check id=F6-unknown-country
sql: SELECT round(sum(CASE WHEN country='suppressed_or_unknown' THEN conversations ELSE 0 END)*1.0/sum(conversations),4) FROM 'aggregates/volume_weekly_country.parquet'
expect: 0.0829
tolerance: 0.00005
-->
<!-- loupe-check id=F6-english-share
sql: SELECT round(sum(CASE WHEN language='English' THEN conversations ELSE 0 END)*1.0/sum(conversations),3) FROM 'aggregates/volume_weekly_language.parquet'
expect: 0.525
tolerance: 0.0005
-->
<!-- loupe-check id=F6-yoruba-share
sql: SELECT round(sum(CASE WHEN language='Yoruba' THEN conversations ELSE 0 END)*1.0/sum(conversations),3) FROM 'aggregates/volume_weekly_language.parquet'
expect: 0.028
tolerance: 0.0005
-->

**Implication for a product owner:** any language-mix chart or localization decision needs the Yoruba row pulled or footnoted, and any geography-based sizing needs the 8.29% unknown share stated next to it. **What would falsify this:** a manual read of a Yoruba-labeled sample showing genuine Yoruba text, not detector noise, would mean the language should be reported as-is. Live view: dashboard Data quality tab (`#quality`).

### F7: Token usage data barely covers the window it exists in

Token-usage fields exist only for conversations between 2024-09-09 and 2024-12-30, a 17-week slice of the full collection window, and even inside that slice the conversation-weighted average coverage is 9.9%.

<!-- loupe-check id=F7-window-weeks
sql: SELECT count(DISTINCT week) FROM 'aggregates/data_quality_weekly.parquet' WHERE week BETWEEN DATE '2024-09-09' AND DATE '2024-12-30'
expect: 17
-->
<!-- loupe-check id=F7-first-week
sql: SELECT min(week) FROM 'aggregates/data_quality_weekly.parquet' WHERE token_usage_coverage > 0
expect: "2024-09-09"
-->
<!-- loupe-check id=F7-last-week
sql: SELECT max(week) FROM 'aggregates/data_quality_weekly.parquet' WHERE token_usage_coverage > 0
expect: "2024-12-30"
-->
<!-- loupe-check id=F7-weighted-cov
sql: SELECT round(sum(conversations*token_usage_coverage)/sum(conversations),3) FROM 'aggregates/data_quality_weekly.parquet' WHERE week BETWEEN DATE '2024-09-09' AND DATE '2024-12-30'
expect: 0.099
tolerance: 0.0005
-->

**Implication for a product owner:** there is no basis in this data for a cost-per-conversation or token-volume estimate outside that 17-week window, and even inside it, any number not normalized by conversations_with_tokens is describing under one in ten conversations, not the whole slice. **What would falsify this:** finding nonzero token_usage_coverage outside 2024-09-09 to 2024-12-30 in a re-pull of the raw data would mean the window is wider than this aggregate shows. Live view: dashboard Data quality tab (`#quality`).

### F8: Questions are the largest use, then coding; the classifier and the labeled sample agree within three points

Across all classified conversations, asking questions (information, explanations, homework, advice) accounts for 27.0% of traffic, coding for 19.3%, writing and business documents for 16.6%, creative and roleplay for 6.9%, translation for 6.7%, and image-prompt generation for 5.3%. The residual "other" class, greetings, tests of the assistant, and unreadable input, is 18.1%. As a calibration check, the same seven shares computed on the 9,829 model-labeled conversations, without the classifier, are 28.1%, 19.3%, 17.0%, 8.1%, 6.3%, 6.2%, and 14.9%: every class within about three points, with the classifier over-calling "other" by three points.

<!-- loupe-check id=F8-questions
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet'), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent = 'questions'
expect: 27.0
-->
<!-- loupe-check id=F8-coding
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet'), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent = 'coding'
expect: 19.3
-->
<!-- loupe-check id=F8-writing
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet'), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent = 'writing_and_business'
expect: 16.6
-->
<!-- loupe-check id=F8-other
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet'), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent = 'other'
expect: 18.1
-->
<!-- loupe-check id=F8-creative
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet'), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent = 'creative_roleplay'
expect: 6.9
-->
<!-- loupe-check id=F8-translation
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet'), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent = 'translation'
expect: 6.7
-->
<!-- loupe-check id=F8-image
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet'), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent = 'image_prompting'
expect: 5.3
-->

Implication: the assistant is a question-answering and coding tool first; writing is third, not first, which changes where quality effort should go. What would falsify it: a hand-labeled random sample of 300 conversations whose question share differs from 27% by more than the classifier's known error. Live view: [Intent tab](https://rsm-sdeenadayalan.github.io/wildchat-analytics/#intent).

### F9: In 2025, more than a third of traffic is greetings, tests, or gibberish, and it is almost all single-turn

The "other" class was 2.7% of 2023 conversations and 11.2% of 2024, then 37.5% of 2025. Conversations classed "other" end after one turn 83.7% of the time, against 17.3% for questions and 23.7% for coding. Translation also rises from 1.0% in 2023 to 15.3% in 2025, while questions fall from 45.1% to 18.6%. This is the same 2025 population that F1 and F3 flag as a collection change: a different assistant model, and pseudo-user keys that no longer persist. The most likely reading is that a large share of 2025 traffic is automated probing or one-shot testing rather than people using the assistant.

<!-- loupe-check id=F9-other-2023
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet' WHERE year(week)=2023), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent='other' AND year(week)=2023
expect: 2.7
-->
<!-- loupe-check id=F9-other-2024
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet' WHERE year(week)=2024), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent='other' AND year(week)=2024
expect: 11.2
-->
<!-- loupe-check id=F9-other-2025
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet' WHERE year(week)=2025), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent='other' AND year(week)=2025
expect: 37.5
-->
<!-- loupe-check id=F9-other-oad
sql: SELECT round(sum(conversations*one_and_done_rate)/sum(conversations), 3) FROM 'aggregates/friction_by_intent_model.parquet' WHERE intent='other'
expect: 0.837
-->
<!-- loupe-check id=F9-questions-oad
sql: SELECT round(sum(conversations*one_and_done_rate)/sum(conversations), 3) FROM 'aggregates/friction_by_intent_model.parquet' WHERE intent='questions'
expect: 0.173
-->
<!-- loupe-check id=F9-coding-oad
sql: SELECT round(sum(conversations*one_and_done_rate)/sum(conversations), 3) FROM 'aggregates/friction_by_intent_model.parquet' WHERE intent='coding'
expect: 0.237
-->
<!-- loupe-check id=F9-translation-2023
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet' WHERE year(week)=2023), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent='translation' AND year(week)=2023
expect: 1.0
-->
<!-- loupe-check id=F9-translation-2025
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet' WHERE year(week)=2025), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent='translation' AND year(week)=2025
expect: 15.3
-->
<!-- loupe-check id=F9-questions-2023
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet' WHERE year(week)=2023), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent='questions' AND year(week)=2023
expect: 45.1
-->
<!-- loupe-check id=F9-questions-2025
sql: SELECT round(100.0*sum(conversations)/(SELECT sum(conversations) FROM 'aggregates/intent_weekly.parquet' WHERE year(week)=2025), 1) FROM 'aggregates/intent_weekly.parquet' WHERE intent='questions' AND year(week)=2025
expect: 18.6
-->

Implication: a product owner should track junk traffic as its own metric and exclude it from engagement and quality denominators, or every 2025 number is diluted. What would falsify it: reading a random 100 of the 2025 "other" conversations and finding most are real requests the classifier mislabeled. Live view: [Intent tab](https://rsm-sdeenadayalan.github.io/wildchat-analytics/#intent).

### F10: Image-prompt generation lived almost entirely on the cheapest model, and reasoning models pulled coding work

Image-prompt generation (writing prompts for Midjourney-style tools) is 19.2% of gpt-3.5-turbo conversations and 0.5% of gpt-4 conversations. On the reasoning models the mix tilts to code: coding is 42.4% of o1-mini conversations and 32.4% of o1, against 10.5% on gpt-3.5-turbo and 15.1% on gpt-4. Era and model are confounded here (F3), so this describes which model served which work in this collection, not which model people would choose given a free pick.

<!-- loupe-check id=F10-img-35
sql: SELECT round(100.0*conversations/(SELECT sum(conversations) FROM 'aggregates/intent_by_model.parquet' WHERE model='gpt-3.5-turbo'), 1) FROM 'aggregates/intent_by_model.parquet' WHERE model='gpt-3.5-turbo' AND intent='image_prompting'
expect: 19.2
-->
<!-- loupe-check id=F10-img-4
sql: SELECT round(100.0*conversations/(SELECT sum(conversations) FROM 'aggregates/intent_by_model.parquet' WHERE model='gpt-4'), 1) FROM 'aggregates/intent_by_model.parquet' WHERE model='gpt-4' AND intent='image_prompting'
expect: 0.5
-->
<!-- loupe-check id=F10-code-o1mini
sql: SELECT round(100.0*conversations/(SELECT sum(conversations) FROM 'aggregates/intent_by_model.parquet' WHERE model='o1-mini'), 1) FROM 'aggregates/intent_by_model.parquet' WHERE model='o1-mini' AND intent='coding'
expect: 42.4
-->
<!-- loupe-check id=F10-code-o1
sql: SELECT round(100.0*conversations/(SELECT sum(conversations) FROM 'aggregates/intent_by_model.parquet' WHERE model='o1'), 1) FROM 'aggregates/intent_by_model.parquet' WHERE model='o1' AND intent='coding'
expect: 32.4
-->
<!-- loupe-check id=F10-code-35
sql: SELECT round(100.0*conversations/(SELECT sum(conversations) FROM 'aggregates/intent_by_model.parquet' WHERE model='gpt-3.5-turbo'), 1) FROM 'aggregates/intent_by_model.parquet' WHERE model='gpt-3.5-turbo' AND intent='coding'
expect: 10.5
-->
<!-- loupe-check id=F10-code-4
sql: SELECT round(100.0*conversations/(SELECT sum(conversations) FROM 'aggregates/intent_by_model.parquet' WHERE model='gpt-4'), 1) FROM 'aggregates/intent_by_model.parquet' WHERE model='gpt-4' AND intent='coding'
expect: 15.1
-->

Implication: the cheap tier carried a distinct, prompt-generation workload that the premium tier did not; a product owner sizing model tiers should look at intent mix per tier, not just volume. What would falsify it: an intent-by-model table where image prompting is spread evenly across families. Live view: [Intent tab](https://rsm-sdeenadayalan.github.io/wildchat-analytics/#intent).

### F11: Friction differs by what people are doing: creative and question conversations draw the most refusals, coding the most single-turn exits among real requests

Excluding the "other" class, one-turn exits are highest for coding (23.7%) and lowest for image prompting (0.8%), which runs as long multi-turn prompt-refinement sessions. Refusal patterns are most frequent in creative and roleplay conversations (4.3%) and questions (3.8%), and rarest in image prompting (0.6%). Repeated requests are most common for questions (5.4%). These are structural proxies, still unvalidated against hand labels (F5); the ordering across intents is more trustworthy than any single rate.

<!-- loupe-check id=F11-img-oad
sql: SELECT round(sum(conversations*one_and_done_rate)/sum(conversations), 3) FROM 'aggregates/friction_by_intent_model.parquet' WHERE intent='image_prompting'
expect: 0.008
-->
<!-- loupe-check id=F11-creative-refusal
sql: SELECT round(sum(conversations*refusal_rate)/sum(conversations), 3) FROM 'aggregates/friction_by_intent_model.parquet' WHERE intent='creative_roleplay'
expect: 0.043
-->
<!-- loupe-check id=F11-questions-refusal
sql: SELECT round(sum(conversations*refusal_rate)/sum(conversations), 3) FROM 'aggregates/friction_by_intent_model.parquet' WHERE intent='questions'
expect: 0.038
-->
<!-- loupe-check id=F11-img-refusal
sql: SELECT round(sum(conversations*refusal_rate)/sum(conversations), 3) FROM 'aggregates/friction_by_intent_model.parquet' WHERE intent='image_prompting'
expect: 0.006
-->
<!-- loupe-check id=F11-questions-repeat
sql: SELECT round(sum(conversations*repeat_rate)/sum(conversations), 3) FROM 'aggregates/friction_by_intent_model.parquet' WHERE intent='questions'
expect: 0.054
-->

Implication: quality investment should be intent-specific; a refusal-rate target that ignores intent will be dominated by creative conversations. What would falsify it: the 300-label precision check showing the refusal proxy fires mostly on non-refusals in creative conversations. Live view: [Friction tab](https://rsm-sdeenadayalan.github.io/wildchat-analytics/#friction).

## Method

Aggregates are built by Loupe's pipeline from the raw WildChat-4.8M shards: parse and redact, compute per-conversation features (turns, model family, pseudo-user key, friction proxies), then roll up into the tables read here. Every column's grain, SQL source, and suppression rule are defined in `03-metrics-framework.md`. The intent taxonomy is `v2` (seven classes; the v1 ten-class draft and the merge provenance are in `loupe/taxonomy.json` and the metrics framework). Classifier accuracy: 78.6% held-out on 1,966 conversations (macro F1 0.805) with taxonomy v2; gate 78.4%, set at 90% of the 87.1% inter-rater agreement measured on 348 conversations; `intent_coverage` is `"full"`.

<!-- loupe-check id=method-intent-coverage
sql: SELECT intent_coverage FROM read_json_auto('aggregates/meta.json')
expect: "full"
-->

Any slice under the `min_cell` of 20 conversations is dropped or rolled into a `suppressed_or_unknown` row, depending on the table (see `03-metrics-framework.md`). Aggregates cover 2023-04-09 through 2025-07-31, with complete weeks from 2023-04-10 through 2025-07-21.

<!-- loupe-check id=method-cw-from
sql: SELECT complete_weeks_from::VARCHAR FROM read_json_auto('aggregates/meta.json')
expect: "2023-04-10"
-->
<!-- loupe-check id=method-cw-through
sql: SELECT complete_weeks_through::VARCHAR FROM read_json_auto('aggregates/meta.json')
expect: "2025-07-21"
-->

Every number here is re-derived from the committed `aggregates/*.parquet` files by `scripts/check_report.py`, runnable locally or via the dashboard's Query tab.

## Limitations

The biases that matter for the findings above, drawn from `03-metrics-framework.md`'s biases table: this is a free public chatbot's population, not a representative or paid-product population (affects every finding's generalizability, especially F3 and F4); the pseudo-user key merges shared networks and splits single people across devices, in opposite directions (affects F1 and F2 specifically); langdetect produces implausible labels like the Yoruba anomaly on garbled or short text (affects F6); token-usage fields exist for a minority of conversations in a limited window (affects F7 and blocks any cost analysis outside it); and the four friction proxies in F5 are unvalidated pattern matches, not hand-checked signals, until the pending 300-label precision check runs.

## What a product owner should do

1. Before trusting any retention or week-over-week return chart, confirm which side of the 2024 Q3/Q4 boundary it covers; never compare across it without saying so (F1).
2. Treat the comparable-era return rate, roughly 13%, as the current baseline for return-rate goals, not a number pulled from the post-break period (F2).
3. When comparing model families on any metric, control for era first; a difference between gpt-3.5-turbo and gpt-4.1-mini may be population drift, not model quality (F3, F4).
4. Hold the friction dashboard's one_and_done, correction, and refusal trends out of any external-facing deck until the 300-label precision check runs and clears the 0.70 gate (F5).
5. Scope any cost, token-budget, or geography/language sizing work to the windows where the underlying data actually has coverage: 2024-09-09 to 2024-12-30 for tokens, and the majority of conversations that carry a usable country for geography (F6, F7).
6. Report junk traffic (the "other" class) as its own line and exclude it from engagement denominators before comparing 2025 to earlier periods (F9).
7. Set quality targets per intent, starting with refusals in creative conversations and single-turn exits in coding (F11); size model tiers by intent mix, not volume (F10).
