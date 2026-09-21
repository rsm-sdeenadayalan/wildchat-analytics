# Opportunity brief

**What this is for:** Make the case for building Loupe before any design or code work starts.
**Date:** 2026-09-20
**Status:** Draft

## Problem

A person who owns an AI assistant feature cannot answer who uses it, how intensely, for what, or where it fails, without an engineer writing a one-off script. Priya is the product manager for the AI assistant inside a customer-support tool, and about 40,000 conversations a week flow through it. Her VP asks three questions on a Monday: is usage growing or is it the same power users every week, what are people using it for, and support tickets say the assistant "doesn't get it" so where is it failing. Priya asks a data engineer for a SQL pull, waits three days, gets a spreadsheet of 2,000 conversations, and reads a few hundred by hand over a weekend to form a gut impression that nobody else can check. A month later the same questions come back and she repeats the whole cycle.

## Who has it

- **PMs and analysts who own an assistant feature.** Today they file a data request and wait on an engineer's SQL pull, then read a transcript sample by hand.
- **Founders running a chatbot** (support, tutoring, or similar). Today they eyeball a handful of transcripts and rely on gut feel because there is no analyst on staff.
- **Internal-tool owners** (an IT-help bot, an internal copilot). Today they get usage counts from an infrastructure dashboard, with no visibility into intent or failure.
- **University product leads** running a student-advising assistant. Today they hear anecdotes from support staff, with no systematic read on volume, intent, or failure.

## Evidence

- A 2026 survey of 130 backend, full-stack, and AI engineers found that 35% of teams do no AI evals at all. ([daily.dev, "AI in production: the 2026 benchmark report"](https://daily.dev/posts/ai-in-production-the-2026-benchmark-report-yw32fuhfl))
- Choosing what to check is the hard part of evaluating an AI product, not running the check; a generic quality score almost always measures something other than what the team cares about. ([Vercel, "What is LLM evaluation? A developer's primer on evals"](https://vercel.com/i/what-are-llm-evals-developers-primer))
- Without an evaluation workflow of her own, a PM can describe a quality problem but cannot act on it, so AI quality moves at engineering's bandwidth and "is the product getting better" becomes a question nobody can answer quickly. ([Confident AI, "LLM Product Manager Workflows: A Complete Guide to AI Quality"](https://www.confident-ai.com/blog/llm-product-manager-workflows))
- A 2026 study named a "results-actionability gap": practitioners gather evaluation data but cannot translate the findings into concrete improvements. ([arXiv:2604.16304, "Results-Actionability Gap: Understanding How Practitioners Evaluate LLM Products in the Wild"](https://arxiv.org/abs/2604.16304))

Incumbent tools (DeepEval, Braintrust, LangSmith, promptfoo, Confident AI) are developer tools that assume the user already knows their metrics and writes code. WildVis, the dataset authors' own tool, is a search-and-browse visualizer for researchers, not a metrics product for product owners. Loupe is demonstrated on WildChat-4.8M, 3.2 million real human-ChatGPT conversations, standing in for a team's own production logs. Its findings describe this dataset's population; they are suggestive, not representative, of AI assistant users in general.

## Why now

35% of teams shipping AI still run no evaluation at all, and choosing what to measure, not running the measurement, is the hard part. Evaluation tooling matured fast over the last two years, and it matured for the people who write the prompts and the code, not for the people who own the product decision. A PM who is accountable for an assistant's quality and adoption still has no product built for her.

## The wedge

Loupe is opinionated, PM-facing, metrics-first analytics over conversation logs, not a general eval framework. It covers five families a product owner asks about, in this order: volume (who and how many), intensity (how often, growing or decaying), intent (what people are trying to do), friction (where the assistant fails), and data quality (how much to trust the rest). Friction, not a full eval product, is the wedge. A full eval product asks an engineer to define pass/fail criteria for every response, which recreates the same bottleneck this brief opens with. Friction proxies (a repeated request, a one-turn abandonment, a correction, a refusal pattern) are computed from conversation structure alone, need no code from the team, and point a PM straight at which failure mode to escalate. That claim is narrower than "we score every response," and it is one a PM without an eval engineer can use.

## What we will not do

- Not a general-purpose eval framework. No metric authoring UI, no CI integration, no LLM-as-judge scoring of every response.
- Not a live ingestion product. No connectors to production logging systems in v1.
- Not a research paper. No claims about ChatGPT's user base at large; claims are about this dataset's population, stated as such.
- Not toxicity or safety analytics in v1. The public dataset has toxic conversations removed, so safety rates cannot be computed honestly from it.
- No re-hosting of the raw dataset. Hugging Face remains the source of truth.
- No changes to shankard.com. Loupe ships its own site; embedding or linking it from the personal site is a separate decision.

## Decision requested

Build v1 as specified in the PRD, demonstrated on WildChat, with all findings labeled as describing that dataset's population, time-boxed to eight working days.
