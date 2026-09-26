"""Inter-rater agreement between the primary labeler and a second model on the same conversations.

Reads the primary labels (samples/intent_labels.parquet, v1 class names) and the second rater's
progress file (samples/rater2_<name>_progress.jsonl, also v1 names), maps both to the current
taxonomy via its merged_from lists, and writes aggregates/intent_rater_agreement.json.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import duckdb

TAXONOMY = Path("loupe/taxonomy.json")
OUT = Path("aggregates/intent_rater_agreement.json")


def v1_to_current() -> dict[str, str]:
    tax = json.loads(TAXONOMY.read_text())
    m = {}
    for c in tax["classes"]:
        m[c["name"]] = c["name"]
        for old in c.get("merged_from", []):
            m[old] = c["name"]
    return m


def compute(primary: dict[int, str], second: dict[int, str], mapping: dict[str, str]) -> dict:
    ids = sorted(set(primary) & set(second))
    raw = sum(primary[i] == second[i] for i in ids) / max(1, len(ids))
    mapped = sum(mapping.get(primary[i], primary[i]) == mapping.get(second[i], second[i]) for i in ids) / max(1, len(ids))
    dis = Counter((mapping.get(primary[i], primary[i]), mapping.get(second[i], second[i])) for i in ids
                  if mapping.get(primary[i], primary[i]) != mapping.get(second[i], second[i]))
    return {"n": len(ids), "agreement_v1_classes": round(raw, 4), "agreement_current_taxonomy": round(mapped, 4),
            "top_disagreements_current": [{"primary": a, "second": b, "count": c} for (a, b), c in dis.most_common(5)]}


def main(second_progress: str = "samples/rater2_gemini_progress.jsonl", second_model: str = "gemini-3.5-flash") -> int:
    primary = {int(c): i for c, i in duckdb.sql("SELECT conv_id, intent FROM 'samples/intent_labels.parquet'").fetchall()}
    second = {}
    for line in Path(second_progress).read_text().splitlines():
        rec = json.loads(line)
        if "intent" in rec:
            second[int(rec["conv_id"])] = rec["intent"]
    result = compute(primary, second, v1_to_current())
    result.update({"primary_model": "claude-sonnet-5", "second_model": second_model,
                   "taxonomy_version": json.loads(TAXONOMY.read_text())["version"]})
    OUT.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
