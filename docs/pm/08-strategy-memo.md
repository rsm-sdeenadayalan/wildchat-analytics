# Strategy memo

**What this is for:** Tell leadership of a company building a general-purpose AI assistant what a 3.2-million-conversation usage dataset implies for quality investment and reading early usage signals, and what is still unproven.
**Date:** 2026-09-20
**Status:** Final

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

## Where Loupe sits against what teams already use

"Doesn't every team already log requests?" Yes, and that is the premise, not the product. Logs are storage. Loupe is the reading: a fixed set of definitions and a labeled classifier that turn logs into four answers a product owner can defend. Three kinds of tool sit near it, and none does that job.

| Group | Examples | What it is good at | What it does not do | Loupe's position |
|---|---|---|---|---|
| General analytics and BI workbenches | Hex, Mode, Looker, Metabase, Amplitude, Mixpanel | Querying, charting and sharing any table; product funnels on event streams; AI-assisted SQL in Hex and Mode | Knows nothing about assistant logs. Someone still has to decide that a "user" is a hash of IP, agent and language, that return rate is undefined in the week before a collection gap, that intent needs a taxonomy with a measured label ceiling, and that one-and-done is a friction proxy worth validating. Every team re-derives those in a private notebook, differently. | Upstream of them. Loupe's aggregates are tables; Hex or Looker could be the screen tomorrow. The product is the metric layer, not the chart. |
| LLM observability and evaluation | LangSmith, Langfuse, Helicone, Arize Phoenix, Braintrust, DeepEval, promptfoo | Tracing individual calls, latency and cost, prompt versioning, developer-written evals and datasets, debugging a single bad response | Built for the engineer who owns the prompt. Units are traces and spans, not users and weeks. No pseudo-user retention, no intent mix over time, no suppression floor for publishing, no reconciliation between views. A PM opens them and sees a log viewer. | Adjacent and complementary. These tools answer "why did this call fail"; Loupe answers "who uses this, how often, for what, and where does it fail them." Their trace stores are an ideal input to Loupe's flatten stage. |
| In-house scripts and one-off pulls | A data engineer's SQL, a notebook per question, a weekend of reading transcripts | Flexible; answers the exact question asked | Not repeatable, not comparable week to week, defined differently each time, and gated on an engineer's time. This is the status quo the opportunity brief describes, and the results-actionability gap the 2026 study documents. | The thing Loupe replaces. |

Two tools deserve a specific note. **WildVis**, the dataset authors' own visualizer, is a search-and-browse tool for researchers reading conversations; it serves content, which Loupe deliberately never does. **Amplitude and Mixpanel** could compute retention on assistant events if a team instruments them as product events, but they cannot classify intent or score friction, and their retention assumes a stable user identifier that chat logs often lack.

What is defensible is not the dashboard. It is the set of decisions made once and tested, including the attribution rule (friction is charged to the responder whose reply the user reacted to, turn by turn, and only when the logs name that responder), the pseudo-user definition and its documented collection break, the return-rate rule, the seven-class taxonomy with an inter-rater ceiling the classifier gate is tied to, the friction proxies with a precision gate, the minimum-cell publication floor, and a reconciliation check that fails the build if any two views disagree. A team that adopts those definitions gets comparable numbers across quarters and across model handoffs, whichever tool draws the charts.

What is not yet proven, and would decide whether this becomes a product or stays an internal layer: whether teams will accept shared definitions over their own, whether an intent taxonomy transfers from a public chatbot to a vertical assistant without relabeling, and whether the friction proxies clear their precision gate on a different population. Those are the first three questions a design partner should answer.

## Recommendations

1. **Applied research or evaluation team.** Run the pending 300-label friction precision check before any friction number leaves internal review. Metric: proxy precision against hand labels. 90-day target: the two highest-volume proxies clear 70% precision, or are dropped.
2. **Platform team owning model routing.** Add a model-mix dimension to every usage and quality dashboard before drawing a trend line across a model transition. Metric: share of trend charts with a model-mix breakdown. 90-day target: 100% of leadership-facing charts carry it.
3. **Platform team owning model routing, second ask.** Run the intent-aware routing experiment sized in `10-routing-counterfactual.md`: the cost-aware rule would have cut single-turn exits among real requests from 20.6% to 8.2% for about 9% more spend in the four-model window, with the caveat that users chose their model. Metric: one-and-done among non-"other" requests, control versus routed. 90-day target: the experiment has run and been decided by the rule written before it.
4. **Product lead for the assistant surface.** Once intent labeling exists, prioritize quality work on the intent with the largest volume-weighted, validated friction gap, not the loudest anecdote. Metric: validated friction rate for that intent. 90-day target: a measured reduction from the labeling baseline, sized once it exists.

## Risks

Population skew: this population sought free GPT-4-class access, so its model mix, turn depth, and friction rates may not transfer to a different channel or price point. Pseudo-user weakness: return and concentration rest on a hashed-identity key that collapsed at a collection boundary (F1) and merges or splits real people both ways, so no return number here is a precise headcount. Unvalidated proxies: every friction number above is a pattern match until the 300-label check runs, and missing intent labeling makes recommendation 3 conditional. If the friction check fails its 70% gate, or intent labeling fails its 85% gate, pull the affected numbers from any external deck, not just add a caveat.

## What I would measure next

The in-market metrics this recommendation set answers to: weekly active users per onboarded team, answered questions per active user per week, share of exported answers keeping their caveat, and disputed numbers per 100 exports, from the PRD's success metrics. Two experiments first: a held-out precision test of the two highest-volume friction proxies against a fresh hand-labeled sample, to pick which earns an external dashboard slot; and a comparison of caveat styles, inline versus linked, testing whether a reader restates it unprompted, since that behavior leads the trust metrics above.
