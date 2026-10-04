"""Write aggregates/routing_counterfactual.json from the era-restricted friction aggregate. Run after `loupe metrics`."""
from __future__ import annotations

import sys
from pathlib import Path

from loupe.routing import run


def main() -> int:
    res = run(out_path=Path("aggregates/routing_counterfactual.json"))
    for era, e in res["eras"].items():
        b = e["policies"]["baseline_actual_mix"]
        print(f"era {era} {e['start']}..{e['end']}: {b['conversations']:,} conversations in cells; baseline one-and-done {b['one_and_done_rate']:.1%}", file=sys.stderr)
        for name in ("best_friction", "cost_aware", "cheapest_only"):
            p = e["policies"][name]
            print(f"  {name:14} one-and-done {p['one_and_done_rate']:.1%} ({p['one_and_done_change_pts']*100:+.1f} pts)  cost {p['cost_change_pct']*100:+.0f}%  routes {p['routes']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
