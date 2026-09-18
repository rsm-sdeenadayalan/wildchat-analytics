# Loupe — user analytics for GenAI assistants

Loupe turns raw conversation logs into the answers a product manager needs: who uses the assistant, how intensely, for what, and where it fails them.

It is built and demonstrated on [WildChat-4.8M](https://huggingface.co/datasets/allenai/WildChat-4.8M), 3.2 million real human–ChatGPT conversations, and it ships as both a product (pipeline + dashboard published from this repo via GitHub Pages) and a set of findings (a public trends report).

This repo is also an end-to-end record of the product management work behind it: opportunity brief, user research, metrics framework, PRD, roadmap, design, launch, findings, strategy memo, and retrospective. Start with the design spec:

- `docs/superpowers/specs/2026-09-17-loupe-design.md`

PM artifacts will live under `docs/pm/` in the order they were produced.

## Attribution

Data: Zhao et al., *WildChat: 1M ChatGPT Interaction Logs in the Wild*, ICLR 2024; Deng et al., *WildVis*, EMNLP 2024 Demos. The dataset is licensed under [ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/). Findings describe this dataset's population, which came from a free public chatbot hosted by the researchers, not from ChatGPT's own product.

## Reproduce

```bash
make setup            # uv, Python 3.12, dependencies
make test             # unit tests on a hand-built fixture
make flatten          # streams all 86 shards from Hugging Face, one at a time (~30 min)
make sample           # 20k stratified conversations for intent labeling
make label            # Anthropic Message Batches; refuses to run above LOUPE_LABEL_BUDGET_USD
make classify         # char n-gram classifier; stops if held-out accuracy < 0.85
make metrics          # writes aggregates/*.parquet and aggregates/meta.json
```

Only `aggregates/` is committed. Raw shards and any text live under `data/` and `samples/`, which are gitignored. `aggregates/meta.json` records the run: conversation count, date range, minimum cell size, and whether intent labels were available (`intent_coverage`).
