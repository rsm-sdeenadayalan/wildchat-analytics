# Loupe — user analytics for GenAI assistants

Loupe turns raw conversation logs into the answers a product manager needs: who uses the assistant, how intensely, for what, and where it fails them.

It is built and demonstrated on [WildChat-4.8M](https://huggingface.co/datasets/allenai/WildChat-4.8M), 3.2 million real human–ChatGPT conversations, and it ships as both a product (pipeline + dashboard at [shankard.com/loupe](https://shankard.com/loupe/)) and a set of findings (a public trends report).

This repo is also an end-to-end record of the product management work behind it: opportunity brief, user research, metrics framework, PRD, roadmap, design, launch, findings, strategy memo, and retrospective. Start with the design spec:

- `docs/superpowers/specs/2026-09-17-loupe-design.md`

PM artifacts will live under `docs/pm/` in the order they were produced.

## Attribution

Data: Zhao et al., *WildChat: 1M ChatGPT Interaction Logs in the Wild*, ICLR 2024; Deng et al., *WildVis*, EMNLP 2024 Demos. The dataset is licensed under [ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/). Findings describe this dataset's population, which came from a free public chatbot hosted by the researchers, not from ChatGPT's own product.
