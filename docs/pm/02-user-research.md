# User research

**What this is for:** Record what we know about the user from public evidence, what we are assuming, and how each assumption would be tested first.
**Date:** 2026-09-20
**Status:** Draft

## Research questions

- How do owners answer usage questions today?
- How long does it take and who is involved?
- How do they judge a bad conversation?
- What number would they watch weekly?
- What would make them distrust a number?

## Method

Primary interviews were planned (guide and outreach are in research/) but were not conducted; the owner could not recruit participants in the project window. The method used is secondary research from sourced public evidence plus an explicit assumptions register.

## Participants

None; the participant log template remains in research/participants.csv for a future round.

## What we heard

### Secondary research

- A 2026 survey of 130 backend, full-stack, and AI engineers found that 35% of teams do no AI evals at all. ([daily.dev, "AI in production: the 2026 benchmark report"](https://daily.dev/posts/ai-in-production-the-2026-benchmark-report-yw32fuhfl))
- Choosing what to check is the hard part of evaluating an AI product, not running the check; a generic quality score almost always measures something other than what the team cares about. ([Vercel, "What is LLM evaluation? A developer's primer on evals"](https://vercel.com/i/what-are-llm-evals-developers-primer))
- Without an evaluation workflow of her own, a PM can describe a quality problem but cannot act on it, so AI quality moves at engineering's bandwidth and "is the product getting better" becomes a question nobody can answer quickly. ([Confident AI, "LLM Product Manager Workflows: A Complete Guide to AI Quality"](https://www.confident-ai.com/blog/llm-product-manager-workflows))
- A 2026 study named a "results-actionability gap": practitioners gather evaluation data but cannot translate the findings into concrete improvements. ([arXiv:2604.16304, "Results-Actionability Gap: Understanding How Practitioners Evaluate LLM Products in the Wild"](https://arxiv.org/abs/2604.16304))

### Assumptions register

| Assumption | Why we believe it | Risk if wrong | First test |
|---|---|---|---|
| Owners cannot answer usage questions without pulling an engineer into the work | Priya example: has to request a SQL pull and wait three days | We are solving a problem that is not acute or already has better solutions | 15-minute conversation asking a PM how they answer usage questions today |
| They judge quality by reading transcripts as the primary signal | Priya reads "a few hundred by hand over a weekend" | Quality judgments come from other sources; we are addressing a secondary concern | 15-minute conversation about how they currently evaluate quality |
| They would trust a number more if its caveat is always attached to it | Success metrics include "caveat retention"; job 5 requires explicit caveats | Caveats are ignored in practice or seen as noise; effort on caveat design is wasted | 5-question survey asking what makes them distrust a metric and what would help |
| Their decisions run on a weekly cadence | Priya's VP asks questions on Mondays; weekly metrics are the design north star | They need different cadence (daily, monthly, quarterly); our primary grain is misaligned | 15-minute conversation about their normal rhythm for product decisions and questions |
| Intent is the metric family they want first, before friction or other slices | Spec lists intent as job 3 of 5; jobs ordered by priority; intent is a natural first question | They care more about friction or raw volume; our sequencing is wrong | 10-minute usability task: participant enters dashboard and talks aloud about which view they would click first |
| Friction proxies (repeated requests, corrections, one-and-done) approximate where users did not get what they came for | Proxies are defined from transcript structure alone and require no code from the team | Proxies miss real friction or flag non-problems; the correlation is weak | Hand-label 300 conversations for "did user get what they came for" and compare to proxy flags |

## Pain points, ranked

Ranked from secondary research; not yet validated by primary research.

| Rank | Pain point | Source |
|------|-----------|--------|
| 1 | Engineering becomes the bottleneck for every quality question because the PM cannot run analysis on her own | Confident AI, "LLM Product Manager Workflows" |
| 2 | Choosing what to measure is the hard part of evaluation; deciding what to check is harder than running the check | Vercel, "What is LLM evaluation? A developer's primer" |
| 3 | Teams gather evaluation data but cannot translate findings into concrete improvements | arXiv:2604.16304, "Results-Actionability Gap" |
| 4 | A large share of teams (35%) run no systematic AI evaluation at all | daily.dev, "AI in production: the 2026 benchmark report" |

## What changed in the PRD

The PRD carries the assumptions register above as open questions. The launch checks in Section 6.3 require participants from a usability test pool that do not yet exist; they will be recruited in a future round.

## Gaps and next steps

As of 2026-09-20, zero interviews have been conducted. The top gap is primary evidence: we have no data that the problem is as acute as secondary research suggests, or that owners would trust Loupe's metrics framework. The two cheapest next steps are: three 15-minute conversations with product managers asking how they currently answer usage questions and whether engineering bandwidth is a real constraint (this unlocks confidence that the problem is real); two 10-minute usability sessions with participants looking at the dashboard and naming which view they would click first (this unlocks feedback on metric sequencing and readability). After these six conversations, we would have enough signal to revise assumptions or proceed to a larger usability test for launch checks.
