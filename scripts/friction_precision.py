"""Precision of each friction proxy against hand labels in docs/pm/research/friction_labels.csv."""
from __future__ import annotations

import csv
import json
from pathlib import Path

import duckdb

LABELS = Path("docs/pm/research/friction_labels.csv")
OUT = Path("docs/pm/research/friction_precision.json")
PROXY_TO_LABEL = {"repeated_request": "is_repeat", "correction_followup": "is_correction", "assistant_refusal": "is_refusal"}


def _b(v) -> bool:
    return str(v).strip() in ("1", "true", "True", "yes")


def precision(labels: list[dict], flags: dict[int, dict]) -> dict:
    out: dict = {}
    for proxy, col in PROXY_TO_LABEL.items():
        pred = [row for row in labels if flags.get(int(row["conv_id"]), {}).get(proxy)]
        tp = sum(1 for row in pred if _b(row[col]))
        out[proxy] = {"predicted": len(pred), "true_positives": tp, "precision": (tp / len(pred)) if pred else None}
    pred = [row for row in labels if flags.get(int(row["conv_id"]), {}).get("one_and_done")]
    tp = sum(1 for row in pred if not _b(row["got_what_they_came_for"]))
    out["one_and_done"] = {"predicted": len(pred), "true_positives": tp, "precision": (tp / len(pred)) if pred else None}
    fired = [row for row in labels if any(flags.get(int(row["conv_id"]), {}).values())]
    bad = sum(1 for row in fired if not _b(row["got_what_they_came_for"]))
    out["friction_vs_outcome"] = (bad / len(fired)) if fired else None
    out["n_labels"] = len(labels)
    return out


def main() -> int:
    labels = list(csv.DictReader(open(LABELS, newline="")))
    ids = ",".join(str(int(r["conv_id"])) for r in labels)
    rows = duckdb.sql(f"""SELECT conv_id, repeated_request, correction_followup, assistant_refusal, one_and_done
                          FROM 'data/flat/conversations/*.parquet' WHERE conv_id IN ({ids})""").fetchall()
    flags = {r[0]: {"repeated_request": r[1], "correction_followup": r[2], "assistant_refusal": r[3], "one_and_done": r[4]} for r in rows}
    result = precision(labels, flags)
    OUT.write_text(json.dumps(result, indent=2))
    print("| proxy | predicted | true positives | precision |\n|---|---|---|---|")
    for k in ("repeated_request", "correction_followup", "assistant_refusal", "one_and_done"):
        v = result[k]
        p = "n/a" if v["precision"] is None else f"{v['precision']:.2f}"
        print(f"| {k} | {v['predicted']} | {v['true_positives']} | {p} |")
    print(f"\nShare of friction-flagged conversations where the person did not get what they came for: {result['friction_vs_outcome']:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
