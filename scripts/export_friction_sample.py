"""Local-only: export 300 conversations with text for hand labeling. Output stays under samples/ (gitignored)."""
from __future__ import annotations

import csv
import sys
from pathlib import Path

import duckdb

LABEL_COLS = ["got_what_they_came_for", "is_repeat", "is_correction", "is_refusal", "notes"]


def export(raw_shard: Path, out_csv: Path, n: int = 300, seed: int = 11) -> int:
    con = duckdb.connect()
    con.execute(f"SELECT setseed({(seed % 1000) / 1000.0})")
    rows = con.execute(f"""
      WITH c AS (
        SELECT conversation, turn FROM read_parquet('{raw_shard}')
        WHERE turn BETWEEN 1 AND 6
          AND NOT list_has_any(list_transform(conversation, m -> struct_extract(m,'role') = 'user' AND trim(coalesce(struct_extract(m,'content'),'')) = ''), [true])
        ORDER BY random() LIMIT {int(n)}
      )
      SELECT struct_extract(conversation[1], 'turn_identifier') AS conv_id, turn,
             list_aggregate(list_transform(list_filter(conversation, m -> struct_extract(m,'role')='user'), m -> struct_extract(m,'content')), 'string_agg', ' ||| ') AS user_turns,
             list_aggregate(list_transform(list_filter(conversation, m -> struct_extract(m,'role')='assistant'), m -> left(struct_extract(m,'content'), 400)), 'string_agg', ' ||| ') AS assistant_turns
      FROM c
    """).fetchall()
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with open(out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["conv_id", "n_turns", "user_turns", "assistant_turns", *LABEL_COLS])
        for r in rows:
            w.writerow([*r, *([""] * len(LABEL_COLS))])
    return len(rows)


if __name__ == "__main__":
    shard = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/raw/data/train-00000-of-00086.parquet")
    print(export(shard, Path("samples/friction_sample.csv")))
