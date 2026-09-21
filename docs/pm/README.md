# Loupe case study

**What this is for:** Tell a reader what to read, in what order, and how long it takes.
**Date:** 2026-09-20
**Status:** Draft

Loupe is a user analytics product for teams that ship a GenAI assistant. This folder is the record of the product work behind it, in the order it was done. Every document is dated and carries a status. Numbers in the trends report are reproducible from the committed aggregates by running `uv run python scripts/check_report.py`.

## If you have ten minutes

1. [Opportunity brief](01-opportunity-brief.md), 3 minutes. The problem, who has it, and the wedge.
2. [Trends report](07-trends-report.md), 5 minutes. What 3.2 million real conversations say, and what a product owner should do about it.
3. [Retrospective](09-retro.md), 2 minutes. What shipped, what was cut, what was wrong.

## If you have thirty minutes, add

4. [Metrics framework](03-metrics-framework.md). Definitions, biases, and how the friction proxies were validated.
5. [PRD](04-prd.md). Requirements, success metrics, privacy, and the decision log.
6. [User research](02-user-research.md). Who we talked to and what changed because of it.

## The rest

7. [Roadmap](05-roadmap.md) with the cut list.
8. [Dashboard design](06-dashboard-design.md).
9. [Strategy memo](08-strategy-memo.md) for a company building an AI assistant.

## Research kits

The interview guide, outreach message, friction labeling guide, and usability test script are under [research/](research/). Participant files contain identifiers like P1, never names.

## Data and caveats

The demonstration data is WildChat-4.8M (ODC-By 1.0). It came from a free public chatbot the researchers hosted, not from ChatGPT's own product, so findings describe that population. "Pseudo-users" are a hash of network and browser headers, not accounts. Both caveats are repeated wherever numbers appear.
