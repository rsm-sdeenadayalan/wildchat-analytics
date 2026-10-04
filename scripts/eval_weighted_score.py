"""Score a per-prompt results CSV (columns: intent, score) by Loupe's observed usage mix.

  uv run python scripts/eval_weighted_score.py results.csv            # overall weights
  uv run python scripts/eval_weighted_score.py results.csv --era B    # weights for one model-overlap window
  uv run python scripts/eval_weighted_score.py results.csv --language Chinese
  uv run python scripts/eval_weighted_score.py results.csv --exclude-other
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from loupe.evalmix import read_results_csv, weighted_score


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("results")
    ap.add_argument("--mix", default="aggregates/eval_mix.json")
    ap.add_argument("--era")
    ap.add_argument("--language")
    ap.add_argument("--model")
    ap.add_argument("--exclude-other", action="store_true")
    a = ap.parse_args()
    mix = json.loads(Path(a.mix).read_text())
    if a.era:
        weights = mix["by_era"][a.era]["weights"]
    elif a.language:
        weights = mix["by_language"][a.language]
    elif a.model:
        weights = mix["by_model"][a.model]
    elif a.exclude_other:
        weights = mix["weights_excluding_other"]
    else:
        weights = mix["weights"]
    out = weighted_score(read_results_csv(Path(a.results)), weights)
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
