"""Write aggregates/eval_mix.json, the observed intent mix a team can weight its own eval scores by."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from loupe.evalmix import build_mix


def main() -> int:
    mix = build_mix()
    Path("aggregates/eval_mix.json").write_text(json.dumps(mix, indent=2))
    print("eval mix: " + ", ".join(f"{i} {w:.1%}" for i, w in mix["weights"].items()), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
