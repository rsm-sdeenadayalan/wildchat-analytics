# Opportunity brief

**What this is for:** Make the case for building Loupe before any design or code work starts.
**Date:** 2026-09-20
**Status:** Draft

## Problem

A person who owns an AI assistant feature cannot answer who uses it, how intensely, for what, or where it fails, without an engineer writing a one-off script. Priya is the product manager for the AI assistant inside a customer-support tool, and about 40,000 conversations a week flow through it. Her VP asks three questions on a Monday: is usage growing or is it the same power users every week, what are people using it for, and support tickets say the assistant "doesn't get it" so where is it failing. Priya asks a data engineer for a SQL pull, waits three days, gets a spreadsheet of 2,000 conversations, and reads a few hundred by hand over a weekend to form a gut impression that nobody else can check. A month later the same questions come back and she repeats the whole cycle.

## Who has it

- **PMs and analysts who own an assistant feature.** Today they file a data request and wait on an engineer's SQL pull, then read a transcript sample by hand.
- **Founders running a chatbot** (support, tutoring, or similar). Today they eyeball a handful of transcripts and rely on gut feel because there is no analyst on staff.
- **Internal-tool owners** (an IT-help bot, an internal copilot). Today they get usage counts from a BI dashboard built for infrastructure, not for conversation content, and have no visibility into intent or failure.
- **University product leads** running a student-advising or tutoring assistant. Today they hear anecdotes from support staff and have no systematic read on volume, intent, or where the assistant is failing students.

## Evidence

- Roughly 35% of teams shipping AI run no evaluation at all; most of the rest use ad-hoc scripts and manual transcript reading. ([daily.dev, AI in engineering: Q2 2026 benchmarks & research readout](https://daily.dev/posts/ai-in-engineering-q2-2026-benchmarks-research-readout-a5bsn2lal))
- The hardest part of measuring an AI product is deciding what to measure, not running the measurement. ([Vercel, "What is LLM evaluation? A developer's primer on evals"](https://vercel.com/i/what-are-llm-evals-developers-primer))
- When every quality question requires an engineer to write a script, engineering becomes the bottleneck for every product decision. ([Confident AI, "LLM Product Manager Workflows: A Complete Guide to AI Quality"](https://www.confident-ai.com/blog/llm-product-manager-workflows))
- A 2026 study named a "results-actionability gap": teams that do measure still cannot tell what to change. ([arXiv:2604.16304, "Results-Actionability Gap: Understanding How Practitioners Evaluate LLM Products in the Wild"](https://arxiv.org/abs/2604.16304))

Incumbent tools (DeepEval, Braintrust, LangSmith, promptfoo, Confident AI) are developer tools that assume the user already knows their metrics and writes code. WildVis, the dataset authors' own tool, is a search-and-browse visualizer built for researchers, not a metrics product for product owners. Loupe is demonstrated on WildChat-4.8M, a public dataset of 3.2 million real human-ChatGPT conversations, standing in for a team's own production logs. The findings it produces describe this dataset's population; they are suggestive, not representative, of AI assistant users in general.

## Why now

2026 is the year AI features moved from demos to accountability. Teams are past shipping a chatbot and into defending its numbers to a VP or a board, but 35% still measure nothing and most of the rest patch together scripts. Evaluation tooling matured fast over the last two years, and it matured for the people who write the prompts and the code, not for the people who own the product decision. A PM who is accountable for an assistant's quality and adoption still has no product built for her.

## The wedge

Loupe is opinionated, PM-facing, metrics-first analytics over conversation logs, not a general eval framework. It covers five families a product owner asks about, in this order: volume (who and how many), intensity (how often, growing or decaying), intent (what people are trying to do), friction (where the assistant fails), and data quality (how much to trust the rest). Friction, not a full eval product, is the wedge. A full eval product asks an engineer to define pass/fail criteria for every response, which recreates the same bottleneck this brief opens with. Friction proxies (a repeated request, a one-turn abandonment, a correction, a refusal pattern) are computed from conversation structure alone, need no code from the team, and point a PM straight at which failure mode to escalate. That is a narrower claim than "we score every response," and it is the claim a PM without an eval engineer can actually use.

## What we will not do

- Not a general-purpose eval framework. No metric authoring UI, no CI integration, no LLM-as-judge scoring of every response.
- Not a live ingestion product. No connectors to production logging systems in v1.
- Not a research paper. No claims about ChatGPT's user base at large; claims are about this dataset's population, stated as such.
- Not toxicity or safety analytics in v1. The public dataset has toxic conversations removed, so safety rates cannot be computed honestly from it.
- No re-hosting of the raw dataset. Hugging Face remains the source of truth.
- No changes to shankard.com. Loupe ships its own site; embedding or linking it from the personal site is a separate decision.

## Decision requested

Build v1 as specified in the PRD, demonstrated on WildChat, time-boxed to eight working days.
