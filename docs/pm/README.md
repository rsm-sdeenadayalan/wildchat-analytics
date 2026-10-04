# Loupe case study

**What this is for:** Tell a reader what to read, in what order, and how long it takes.
**Date:** 2026-09-20
**Status:** Final

Loupe is a user analytics product for teams that ship a GenAI assistant. The crux: a PM who owns an assistant usually cannot answer who uses it, how intensely, for what, and where it fails them without an engineer writing a one-off script. Loupe answers those four questions from logs alone, and the [live dashboard](https://loupe.shankard.com/app/) demonstrates it on 3.2 million real conversations from the public WildChat dataset, standing in for a team's own logs. This folder is the record of the product work behind it, in the order it was done. Every document is dated and carries a status. Numbers in the trends report are reproducible from the committed aggregates by running `uv run python scripts/check_report.py`.

## If you have ten minutes

1. [Opportunity brief](01-opportunity-brief.md), 3 minutes. The problem, who has it, and the wedge.
2. [Trends report](07-trends-report.md), 5 minutes. What 3.2 million real conversations say, and what a product owner should do about it.
3. [Retrospective](09-retro.md), 2 minutes. What shipped, what was cut, what was wrong.

## If you have thirty minutes, add

4. [Metrics framework](03-metrics-framework.md). Definitions, biases, and how the friction proxies were validated.
5. [PRD](04-prd.md). Requirements, success metrics, privacy, and the decision log.
6. [User research](02-user-research.md). Public evidence on the problem and the assumptions register that would be tested first; no interviews were possible in the v1 window.

## Built from the data

Two pieces that act on what the dashboard exposes, each checked against the aggregates on every build.

7. [Intent-aware model routing](10-routing-counterfactual.md), 4 minutes. A routing rule sized from the one window where four models served the same people: 20.6% to 8.2% single-turn exits for 9% more cost, the selection-bias caveat, and the experiment that would settle it.
8. [Usage-weighted evaluation mix](11-usage-weighted-eval.md), 3 minutes. The observed intent mix as weights for a team's own eval set, with a scorer that refuses to hide what the set does not cover.

## The rest

9. [Roadmap](05-roadmap.md) with the cut list.
10. [Dashboard design](06-dashboard-design.md).
11. [Strategy memo](08-strategy-memo.md) for a company building an AI assistant.

## Research kits

The interview guide, outreach message, friction labeling guide, and usability test script are under [research/](research/). Participant files contain identifiers like P1, never names.

## Data and caveats

The demonstration data is WildChat-4.8M (ODC-By 1.0). It came from a free public chatbot the researchers hosted, not from ChatGPT's own product, so findings describe that population. "Pseudo-users" are a hash of network and browser headers, not accounts. Both caveats are repeated wherever numbers appear.
