# Built from the data, part 1: intent-aware model routing

**What this is for:** Take the sharpest thing the dashboard exposes and turn it into a change a routing team could ship, sized from the data, with the experiment that would prove or kill it.
**Date:** 2026-10-03
**Status:** Final

## The finding that asks for a fix

Between 2024-09-12 and 2025-01-05 the assistant behind these logs served four model families at once: gpt-4o, gpt-4o-mini, o1 and o1-mini. Users picked the model. That window is the only place in the data where two models can be compared on the same population in the same weeks, and inside it the differences by intent are not subtle.

| intent, era B | gpt-4o-mini | gpt-4o | o1 | o1-mini |
|---|---|---|---|---|
| coding, one-and-done | 42.7% | 19.5% | 3.6% | **3.2%** |
| questions, one-and-done | 44.2% | 17.2% | 12.5% | **9.9%** |
| image prompting, one-and-done | **2.3%** | 2.4% | 19.8% (n=106) | 6.9% (n=102) |

<!-- loupe-check id=coding-o1mini-oad
sql: SELECT round(one_and_done_rate, 3) FROM 'aggregates/friction_by_intent_model_era.parquet' WHERE era='B' AND intent='coding' AND model='o1-mini'
expect: 0.032
tolerance: 0.0005
-->
<!-- loupe-check id=coding-4omini-oad
sql: SELECT round(one_and_done_rate, 3) FROM 'aggregates/friction_by_intent_model_era.parquet' WHERE era='B' AND intent='coding' AND model='gpt-4o-mini'
expect: 0.427
tolerance: 0.0005
-->
<!-- loupe-check id=image-4omini-oad
sql: SELECT round(one_and_done_rate, 3) FROM 'aggregates/friction_by_intent_model_era.parquet' WHERE era='B' AND intent='image_prompting' AND model='gpt-4o-mini'
expect: 0.023
tolerance: 0.0005
-->

A coding request on gpt-4o-mini ended after one short reply 43% of the time; the same kind of request on o1-mini, 3%. Image-prompt generation did equally well on the cheapest model as on gpt-4o. Nothing routed those requests; people chose, and most chose the default.

## The change: route by intent

Loupe's classifier labels a first message with one of seven intents at 78.6% held-out accuracy, against an 87.1% inter-rater ceiling. That is enough to drive a routing rule: send each intent to the model that serves it well, and let cost decide among models that serve it about equally well.

The counterfactual below applies three such rules to the actual intent volumes of era B and asks what the volume-weighted one-and-done rate and the list-price cost would have been. "Other" (greetings, tests, gibberish, 14% of the window) is excluded from routing: no model rescues a probe. A model is eligible for an intent only with at least 1,000 conversations on that intent in the window.

| policy, era B | one-and-done | change | refusal | cost per 1k conversations | cost change | routes |
|---|---|---|---|---|---|---|
| Baseline: actual mix | 20.6% | | 1.7% | $12.60 | | as chosen by users |
| Best friction | 7.7% | −12.9 pts | 2.1% | $32.81 | +160% | coding→o1-mini, questions→o1-mini, writing→o1, creative→o1, translation→gpt-4o, image→gpt-4o-mini |
| **Cost-aware** (cheapest within 5 pts of best) | **8.2%** | **−12.4 pts** | 1.7% | **$13.78** | **+9%** | coding→o1-mini, questions→o1-mini, writing→o1-mini, creative→gpt-4o, translation→gpt-4o, image→gpt-4o-mini |
| Cheapest only | 34.3% | +13.7 pts | 1.4% | $0.70 | −94% | everything→gpt-4o-mini |

<!-- loupe-check id=eraB-baseline-oad
sql: SELECT round(eras.B.policies.baseline_actual_mix.one_and_done_rate, 3) FROM read_json_auto('aggregates/routing_counterfactual.json')
expect: 0.206
tolerance: 0.0005
-->
<!-- loupe-check id=eraB-costaware-oad
sql: SELECT round(eras.B.policies.cost_aware.one_and_done_rate, 3) FROM read_json_auto('aggregates/routing_counterfactual.json')
expect: 0.082
tolerance: 0.0005
-->
<!-- loupe-check id=eraB-costaware-cost
sql: SELECT round(eras.B.policies.cost_aware.cost_change_pct, 2) FROM read_json_auto('aggregates/routing_counterfactual.json')
expect: 0.09
tolerance: 0.005
-->
<!-- loupe-check id=eraB-bestfriction-cost
sql: SELECT round(eras.B.policies.best_friction.cost_change_pct, 2) FROM read_json_auto('aggregates/routing_counterfactual.json')
expect: 1.60
tolerance: 0.005
-->
<!-- loupe-check id=eraB-cheapest-oad
sql: SELECT round(eras.B.policies.cheapest_only.one_and_done_rate, 3) FROM read_json_auto('aggregates/routing_counterfactual.json')
expect: 0.343
tolerance: 0.0005
-->

The cost-aware rule is the recommendation. On the data as it stands it would have cut single-turn exits among real requests from one in five to one in twelve, for nine percent more spend. Sending everything to the cheapest model saves 94% and loses a third of real requests after one turn; sending everything to the best model for friction costs 2.6 times as much for half a point of extra benefit over the cost-aware rule.

Routing by request is an existing market: OpenRouter's Auto, Martian, Not Diamond and the RouteLLM paper all do versions of it. The data arrived at the same conclusion on its own. What none of them publish is the size of the prize on real traffic by intent, or an outcome measured from what users did next. That is what this page adds, and what a team would need to decide whether to turn a router on.

The earlier window tells a different story and is worth stating because it is a null result. Between 2023-04-09 and 2024-05-06 only gpt-3.5-turbo and gpt-4 overlapped, and routing barely moves friction: the best policy gains 1.6 points for 184% more cost. Routing is worth doing when the models differ by intent, not as a rule in itself.

<!-- loupe-check id=eraA-best-gain
sql: SELECT round(-eras.A.policies.best_friction.one_and_done_change_pts, 3) FROM read_json_auto('aggregates/routing_counterfactual.json')
expect: 0.016
tolerance: 0.0015
-->
<!-- loupe-check id=eraA-best-cost
sql: SELECT round(eras.A.policies.best_friction.cost_change_pct, 2) FROM read_json_auto('aggregates/routing_counterfactual.json')
expect: 1.84
tolerance: 0.005
-->

## What this is and is not

**Its metric was validated after it was written, and did not hold as a failure measure.** On 2026-10-04 the friction precision check found that one-and-done, the measure these policies are chosen on, is 41% precise as a failure signal: most flagged conversations got what they came for. It is a sound measure of engagement depth, so the result above should be read as "routing by intent would have led far more conversations to continue past one turn", not "would have fixed most failures". The two signals that did survive validation, repeated requests (0.78) and corrections (0.96), move the same way under every policy: the cost-aware rule cuts repeats from 1.33% to 0.08% and corrections from 0.17% to 0.03% of routable conversations in era B. The experiment below now uses repeated requests as its primary metric.

<!-- loupe-check id=eraB-costaware-repeat
sql: SELECT round(eras.B.policies.cost_aware.repeat_rate, 4) FROM read_json_auto('aggregates/routing_counterfactual.json')
expect: 0.0008
tolerance: 0.00005
-->
<!-- loupe-check id=eraB-baseline-repeat
sql: SELECT round(eras.B.policies.baseline_actual_mix.repeat_rate, 4) FROM read_json_auto('aggregates/routing_counterfactual.json')
expect: 0.0133
tolerance: 0.00005
-->

**It is observational.** Users chose their model. The people who picked o1-mini for coding were, very likely, heavier and more deliberate users than the people who took the default, and some of o1-mini's 3% is them, not the model. The gap is too large to be only selection, but the counterfactual sizes a prize; it does not claim it.

**The depth measure is not a failure measure.** One-and-done is a structural rule (one turn, short reply); validation found a short, correct answer that satisfied the person counts here 59% of the time. That cuts in the same direction for every model, so the comparison between models is fairer than the level, and the validated signals agree with its direction.

**Cost is an assumption, not a measurement.** gpt-4o and gpt-4o-mini conversations in these logs carry no token counts, so every model is priced on the same assumed conversation (1,500 prompt and 800 completion tokens) at late-2024 list prices. The numbers are in `loupe/model_prices.json`; change them and re-run `scripts/routing_counterfactual.py`. Reasoning models bill hidden reasoning tokens, so their true cost is higher than shown and the cost-aware rule is, if anything, optimistic about o1-mini.

<!-- loupe-check id=price-assumption-recorded
sql: SELECT price_assumptions.as_of FROM read_json_auto('aggregates/routing_counterfactual.json')
expect: "2024-12"
-->

## The experiment that would settle it

- **Unit and split.** Pseudo-user, randomized 50/50 on first visit in the window. Control: the default model. Treatment: the cost-aware rule, decided by the classifier on the first message.
- **Primary metric.** Repeated-request rate among non-"other" requests, the validated friction signal, with share ending after one turn as the depth check; both measured as Loupe measures them, so the result lands on the same dashboard that motivated the test.
- **Guardrails.** Refusal rate (reasoning models refuse slightly more), cost per 1k conversations against the +9% estimate, and week-over-week return as the long-run check.
- **Size.** With a baseline of 20.6% and a hoped-for 8%, a few thousand conversations per arm detect the effect; a two-week run at this traffic is far more than enough, which leaves room to read it by intent.
- **Decision rule, written before the run.** Ship if repeated requests fall by at least a third and one-turn share by at least 6 points, with cost within +15%. Revisit routes if neither moves. Kill if corrections rise without a repeat gain.

## Where it lives

`loupe/metrics/friction_by_intent_model_era.sql` produces the era-restricted cells; `loupe/routing.py` applies the policies and writes `aggregates/routing_counterfactual.json`; the Friction view of the dashboard shows the policy table for era B. Every number on this page is checked against those files on every build.
