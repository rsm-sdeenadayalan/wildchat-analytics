# Strategy memo

**What this is for:** Tell leadership of a company building a general-purpose AI assistant what a 3.2-million-conversation usage dataset implies for quality investment and reading early usage signals, and what is still unproven.
**Date:** 2026-09-20
**Status:** Draft

## Situation

A free public GPT-style assistant logged 3.2 million conversations from 2023-04 to 2025-07, across several overlapping model-family periods (F3), from gpt-3.5-turbo through gpt-4.1-mini. That corpus is not this company's product; it came from people seeking free access to GPT-4-class capability, so usage concentrates wherever that population needs it to, not necessarily where a paid product's would. Read every number below as a hypothesis to test against this company's own logs, not a forecast of them.

## What the data says

- More than one model family served real volume most weeks: no family held 95% or more of a week's volume in 61.3% of the 119 weeks (F3 in the trends report).
- Reasoning-style models were used in a single turn essentially every time: o1 and o1-mini show 100% one-turn conversations, against 65.0% for gpt-3.5-turbo (F4 in the trends report).
- Two structural friction proxies moved in opposite directions across model transitions, one rising from 8.3% to 46.8%, the other falling from 11.3% to 0.6%, neither validated against hand labels yet (F5 in the trends report).
- 8.29% of conversations carry no usable country, and one detected-language label looks like a detector artifact rather than genuine usage at that share (F6 in the trends report).
- Weekly return rate held stable in the low teens in the one era it is measurable; a collection change makes it non-comparable before and after late 2024 (F2 and F1 in the trends report).

## Implications

Turn depth, not a labeled task, is the one segmentation this data supports: a single-turn segment, overrepresented among reasoning and newest-model traffic, behaves differently from a multi-turn segment tied to the earlier gpt-3.5-turbo/gpt-4 era (F3, F4). Segments like coding versus writing cannot be argued from this build; intent labeling has not run, so that cut is a gap, not a finding (see Risks).

On model mix: because more than one family serves real volume most weeks (F3), this data cannot show which family "holds" return and which "leaks" it; return rate is only measurable in an era predating the multi-family period (F1, F2). Track model mix as a first-class dimension on every chart, because a shift in which model served a week can be mistaken for a shift in behavior.

On where quality investment pays: the friction proxies most likely to matter, one-and-done and refusal, moved by tens of points across model eras (F5), but with zero precision validation, that movement could be real, collection-driven, or both. The honest allocation is upstream of any feature bet: validate the proxies against hand labels, then target whichever clears validation with the largest gap. Geography and language sizing (F6) needs the same discipline; an 8.29% unknown-country residual and one implausible language label mean no localization dollar should move until both are resolved.

On pricing: this dataset carries no price or plan signal — a free public chatbot — so it cannot say what people would pay. The only pricing-adjacent evidence is model mix (F3) and token coverage (F7), which bound cost, not willingness to pay. Any pricing decision should wait for the in-market metrics defined in the PRD.

## Recommendations

1. **Applied research or evaluation team.** Run the pending 300-label friction precision check before any friction number leaves internal review. Metric: proxy precision against hand labels. 90-day target: the two highest-volume proxies clear 70% precision, or are dropped.
2. **Platform team owning model routing.** Add a model-mix dimension to every usage and quality dashboard before drawing a trend line across a model transition. Metric: share of trend charts with a model-mix breakdown. 90-day target: 100% of leadership-facing charts carry it.
3. **Product lead for the assistant surface.** Once intent labeling exists, prioritize quality work on the intent with the largest volume-weighted, validated friction gap, not the loudest anecdote. Metric: validated friction rate for that intent. 90-day target: a measured reduction from the labeling baseline, sized once it exists.

## Risks

Population skew: this population sought free GPT-4-class access, so its model mix, turn depth, and friction rates may not transfer to a different channel or price point. Pseudo-user weakness: return and concentration rest on a hashed-identity key that collapsed at a collection boundary (F1) and merges or splits real people both ways, so no return number here is a precise headcount. Unvalidated proxies: every friction number above is a pattern match until the 300-label check runs, and missing intent labeling makes recommendation 3 conditional. If the friction check fails its 70% gate, or intent labeling fails its 85% gate, pull the affected numbers from any external deck, not just add a caveat.

## What I would measure next

The in-market metrics this recommendation set answers to: weekly active users per onboarded team, answered questions per active user per week, share of exported answers keeping their caveat, and disputed numbers per 100 exports, from the PRD's success metrics. Two experiments first: a held-out precision test of the two highest-volume friction proxies against a fresh hand-labeled sample, to pick which earns an external dashboard slot; and a comparison of caveat styles, inline versus linked, testing whether a reader restates it unprompted, since that behavior leads the trust metrics above.
