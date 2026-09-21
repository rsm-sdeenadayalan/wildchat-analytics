"""Score the v1 launch checks (spec 6.3) from the usability and actionability CSVs."""
from __future__ import annotations

import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path

RESULTS = Path("docs/pm/research/usability_results.csv")
SURVEY = Path("docs/pm/research/actionability_survey.csv")
OUT = Path("docs/pm/research/launch_checks.json")


def _b(v) -> bool:
    return str(v).strip() in ("1", "true", "True", "yes")


def score(results: list[dict], survey: list[dict]) -> dict:
    secs = [float(r["seconds"]) for r in results]
    under = sum(1 for s in secs if s < 120) / len(secs)
    success = sum(1 for r in results if _b(r["correct"])) / len(results)
    by_p = {r["participant"]: _b(r["caveat_stated_after_test"]) for r in results}
    caveat = sum(by_p.values()) / len(by_p)
    votes = defaultdict(list)
    for s in survey:
        votes[s["finding_id"]].append(_b(s["would_act"]))
    actionable = sorted(f for f, v in votes.items() if sum(v) > len(v) / 2)
    out = {
        "time_to_answer_median_s": statistics.median(secs),
        "time_under_120_share": under,
        "task_success": success,
        "caveat_retention": caveat,
        "actionable_findings": actionable,
        "actionability_pass": len(actionable) >= 3,
    }
    out["pass"] = {
        "time_to_answer": under >= 0.8,
        "task_success": success >= 0.8,
        "caveat_retention": caveat >= 0.8,
        "actionability": out["actionability_pass"],
    }
    return out


def main() -> int:
    results = list(csv.DictReader(open(RESULTS, newline="")))
    survey = list(csv.DictReader(open(SURVEY, newline="")))
    s = score(results, survey)
    OUT.write_text(json.dumps(s, indent=2))
    for k, v in s["pass"].items():
        print(f"{'PASS' if v else 'FAIL'} {k}")
    print(json.dumps({k: v for k, v in s.items() if k != "pass"}, indent=2))
    return 0 if all(s["pass"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
