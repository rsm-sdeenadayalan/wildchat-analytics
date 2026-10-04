# Built from the data, part 2: a usage-weighted evaluation mix

**What this is for:** Give a team shipping an assistant a way to score it on the mix of work people actually bring, rather than on whatever a benchmark's authors chose to test, using the observed intent distribution of a real population as the weights.
**Date:** 2026-10-03
**Status:** Final

## The problem with the usual eval

Most assistant evaluations are a set of prompts someone wrote, scored and averaged. The average treats a riddle and a cover-letter edit as equally important because the set has one of each. Real traffic is nothing like that. In these logs 27% of classified conversations are questions, 19% are coding and 5% are image-prompt generation; in the latest window more than a third are greetings, tests and gibberish. An assistant that is excellent at the rare things and mediocre at the common ones scores well on the set and badly with its users.

<!-- loupe-check id=mix-questions
sql: SELECT round(weights.questions, 3) FROM read_json_auto('aggregates/eval_mix.json')
expect: 0.270
tolerance: 0.0015
-->
<!-- loupe-check id=mix-coding
sql: SELECT round(weights.coding, 3) FROM read_json_auto('aggregates/eval_mix.json')
expect: 0.193
tolerance: 0.0015
-->
<!-- loupe-check id=mix-eraC-other
sql: SELECT round(by_era.C.weights.other, 3) FROM read_json_auto('aggregates/eval_mix.json')
expect: 0.375
tolerance: 0.0015
-->

## What Loupe publishes

`aggregates/eval_mix.json`, rebuilt on every pipeline run from the same aggregates the dashboard reads:

- **Overall weights** for the seven intents, and the same weights with "other" removed for teams that score real requests only.
- **By era**: the mix for each model-overlap window, because the mix moved. Questions were 42% of era A and 23% of era B; coding went from 12% to 30%; "other" went from 3% to 37% by era C. A team can weight by the era whose population resembles its own.
- **By model** and **by language**, for a team that serves one model tier or one market.
- The taxonomy version, the classifier's accuracy and the rater ceiling behind the labels, and the population caveat, so nobody mistakes the weights for universal truth.

No prompts ship with it. The logs' conversations are not served anywhere in Loupe, and an eval set is only useful on a team's own prompts anyway. What transfers is the weighting and the rubric: the seven intent definitions in `loupe/taxonomy.json`.

## How a team uses it

1. Label each prompt in their eval set with one of the seven intents, by hand or with Loupe's classifier (the model and its gate are documented in the metrics framework).
2. Score the prompts however they already do: a rubric, a judge model, pass/fail.
3. Run `scripts/eval_weighted_score.py results.csv`, with a column for intent and a column for score, optionally choosing `--era B`, `--language Chinese`, `--model gpt-4o-mini` or `--exclude-other`.

The output is the usage-weighted score beside the plain mean, the weight each intent carried, and, deliberately, the list of intents the set does not cover at all with the share of real usage they represent. An eval set with no translation prompts is told that it is blind to 6.7% of what people do; the score is renormalized over the covered weight and never quietly pretends to be complete.

A worked example, with made-up scores on a five-prompt set:

| intent | prompts | mean score | weight |
|---|---|---|---|
| questions | 2 | 0.80 | 27.0% |
| coding | 1 | 0.40 | 19.3% |
| writing_and_business | 2 | 0.90 | 16.6% |

Unweighted mean 0.76; usage-weighted 0.70; covered weight 62.9%; missing: creative_roleplay, image_prompting, other, translation. The weighted score is lower because the set's weakest result is on the second most common thing people do, and the coverage line says the set is silent on a third of real usage.

## Why this is the honest version of "built from the data"

The data cannot say how good any assistant is. It can say what people ask for, how often, and how that mix moved as the models and the population changed. Turning that into weights is the one use of the data that needs no assumption beyond the taxonomy and the classifier, both of which carry their measured error in the file. It also closes a loop with the first part of this pair: the routing counterfactual says where to send each intent; the weighted eval says how much each intent should count when judging the result.

## Limits

- The weights describe one population, a free public chatbot's users from 2023 to 2025. A vertical assistant should expect a different mix and can swap in its own once it has labels; the arithmetic is the same.
- The classifier is 78.6% accurate against an 87.1% ceiling, so the weights carry label noise of a few points per class. The file states both numbers.
- Whether a seven-class taxonomy built on a general chatbot transfers to a specialized assistant without relabeling is the open question named in the strategy memo, and this is the artifact a design partner would test it with.
