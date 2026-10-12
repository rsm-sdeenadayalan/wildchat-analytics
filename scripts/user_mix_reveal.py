"""The user-mix reveal: model gaps in usage logs versus the same people on both models.

Within the four-model window (2024-09-12..2025-01-05), compare one-turn share by model the way a
dashboard does (all conversations), then again for pseudo-users seen on both models with the same
intent, each user weighted equally. Writes aggregates/user_mix_reveal.json. Needs data/flat (local);
the JSON is committed so the site build does not.
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb
import numpy as np

ERA = ("2024-09-12", "2025-01-05")
PAIRS = [("coding", "gpt-4o-mini", "gpt-4o"), ("questions", "gpt-4o-mini", "gpt-4o"),
         ("coding", "o1-mini", "gpt-4o"), ("questions", "o1-mini", "gpt-4o")]
FAMILY = r"regexp_replace(regexp_replace(c.model, '-(\d{4}-\d{2}-\d{2}|\d{4}|preview)$', ''), '-(\d{4}-\d{2}-\d{2}|\d{4}|preview)$', '')"


def main(flat: Path = Path("data/flat"), out: Path = Path("aggregates/user_mix_reveal.json"), seed: int = 7) -> dict:
    con = duckdb.connect()
    con.execute(f"""CREATE VIEW conv AS SELECT c.pseudo_user, c.one_and_done, i.intent, {FAMILY} AS fam
      FROM read_parquet('{flat}/conversations/*.parquet') c JOIN read_parquet('{flat}/intent/*.parquet') i USING (conv_id)
      WHERE NOT c.has_empty_user_input AND c.date BETWEEN DATE '{ERA[0]}' AND DATE '{ERA[1]}'""")
    rng = np.random.default_rng(seed)
    rows = []
    for intent, a, b in PAIRS:
        naive = dict(con.execute(f"SELECT fam, avg(one_and_done::INT) FROM conv WHERE intent='{intent}' AND fam IN ('{a}','{b}') GROUP BY 1").fetchall())
        n_conv = dict(con.execute(f"SELECT fam, count(*) FROM conv WHERE intent='{intent}' AND fam IN ('{a}','{b}') GROUP BY 1").fetchall())
        m = np.array(con.execute(f"""
          WITH u AS (SELECT pseudo_user, fam, avg(one_and_done::INT) r FROM conv WHERE intent='{intent}' AND fam IN ('{a}','{b}') GROUP BY 1,2)
          SELECT x.r, y.r FROM u x JOIN u y USING (pseudo_user) WHERE x.fam='{a}' AND y.fam='{b}'""").fetchall(), dtype=float)
        diff = m[:, 0] - m[:, 1]
        boots = [diff[rng.integers(0, len(diff), len(diff))].mean() for _ in range(4000)]
        rows.append({
            "intent": intent, "model_a": a, "model_b": b,
            "naive_a": naive[a], "naive_b": naive[b], "naive_gap": naive[a] - naive[b],
            "conversations_a": int(n_conv[a]), "conversations_b": int(n_conv[b]),
            "matched_users": int(len(m)), "matched_a": float(m[:, 0].mean()), "matched_b": float(m[:, 1].mean()),
            "matched_gap": float(diff.mean()), "matched_ci": [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))],
        })
    res = {
        "window": {"start": ERA[0], "end": ERA[1]},
        "metric": "share of conversations that end after one turn with a short reply",
        "method": "Naive: all conversations on each model, as a dashboard compares them. Matched: only pseudo-users seen on both models with the same intent in the window; each user's rate on each model, averaged with users weighted equally; 95% bootstrap interval over users.",
        "pairs": rows,
    }
    out.write_text(json.dumps(res, indent=2))
    for r in rows:
        print(f"{r['intent']:10} {r['model_a']:12} vs {r['model_b']}: naive {r['naive_a']:.1%} vs {r['naive_b']:.1%} (gap {r['naive_gap']*100:+.1f})  "
              f"matched n={r['matched_users']} {r['matched_a']:.1%} vs {r['matched_b']:.1%} (gap {r['matched_gap']*100:+.1f} [{r['matched_ci'][0]*100:+.1f},{r['matched_ci'][1]*100:+.1f}])")
    return res


if __name__ == "__main__":
    main()
