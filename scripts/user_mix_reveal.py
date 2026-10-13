"""The user-mix reveal: model gaps in usage logs versus the same people on both models.

Within the four-model window (2024-09-12..2025-01-05), compare each model the way a dashboard does
(all conversations), then again for pseudo-users seen on both models with the same intent, each user
weighted equally. Two measures per pair: the share ending after one short reply (the original
measure, top-level fields) and the share with a repeated request or a correction (the two friction
signals that passed validation, under "friction"). A pair is not measurable on friction when either
model is almost always single-turn, since nobody can repeat themselves in a one-turn conversation.
Writes aggregates/user_mix_reveal.json. Needs data/flat (local); the JSON is committed so the site
build does not.
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
    con.execute(f"""CREATE VIEW conv AS SELECT c.pseudo_user, c.one_and_done, (c.repeated_request OR c.correction_followup) AS friction,
      c.n_turns > 1 AS multi_turn, i.intent, {FAMILY} AS fam
      FROM read_parquet('{flat}/conversations/*.parquet') c JOIN read_parquet('{flat}/intent/*.parquet') i USING (conv_id)
      WHERE NOT c.has_empty_user_input AND c.date BETWEEN DATE '{ERA[0]}' AND DATE '{ERA[1]}'""")
    rng = np.random.default_rng(seed)
    rng_friction = np.random.default_rng(seed + 1)  # its own stream, so the one-turn intervals reproduce exactly as published

    def compare(intent: str, a: str, b: str, col: str, rng: np.random.Generator) -> tuple[dict, dict, np.ndarray, list]:
        naive = dict(con.execute(f"SELECT fam, avg({col}::INT) FROM conv WHERE intent='{intent}' AND fam IN ('{a}','{b}') GROUP BY 1").fetchall())
        m = np.array(con.execute(f"""
          WITH u AS (SELECT pseudo_user, fam, avg({col}::INT) r FROM conv WHERE intent='{intent}' AND fam IN ('{a}','{b}') GROUP BY 1,2)
          SELECT x.r, y.r FROM u x JOIN u y USING (pseudo_user) WHERE x.fam='{a}' AND y.fam='{b}'
          ORDER BY pseudo_user""").fetchall(), dtype=float)  # a fixed row order, so the seeded bootstrap reproduces exactly
        diff = m[:, 0] - m[:, 1]
        boots = [diff[rng.integers(0, len(diff), len(diff))].mean() for _ in range(4000)]
        return naive, m, diff, boots

    rows = []
    for intent, a, b in PAIRS:
        n_conv = dict(con.execute(f"SELECT fam, count(*) FROM conv WHERE intent='{intent}' AND fam IN ('{a}','{b}') GROUP BY 1").fetchall())
        multi = dict(con.execute(f"SELECT fam, avg(multi_turn::INT) FROM conv WHERE intent='{intent}' AND fam IN ('{a}','{b}') GROUP BY 1").fetchall())
        naive, m, diff, boots = compare(intent, a, b, "one_and_done", rng)
        fn, fm, fdiff, fboots = compare(intent, a, b, "friction", rng_friction)
        rows.append({
            "intent": intent, "model_a": a, "model_b": b,
            "naive_a": naive[a], "naive_b": naive[b], "naive_gap": naive[a] - naive[b],
            "conversations_a": int(n_conv[a]), "conversations_b": int(n_conv[b]),
            "matched_users": int(len(m)), "matched_a": float(m[:, 0].mean()), "matched_b": float(m[:, 1].mean()),
            "matched_gap": float(diff.mean()), "matched_ci": [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))],
            "friction": {
                "measurable": bool(min(multi[a], multi[b]) >= 0.05),
                "multi_turn_a": float(multi[a]), "multi_turn_b": float(multi[b]),
                "naive_a": float(fn[a]), "naive_b": float(fn[b]), "naive_gap": float(fn[a] - fn[b]),
                "matched_a": float(fm[:, 0].mean()), "matched_b": float(fm[:, 1].mean()),
                "matched_gap": float(fdiff.mean()), "matched_ci": [float(np.percentile(fboots, 2.5)), float(np.percentile(fboots, 97.5))],
            },
        })
    res = {
        "window": {"start": ERA[0], "end": ERA[1]},
        "metric": "share of conversations that end after one turn with a short reply",
        "friction_metric": "share of conversations with a repeated request or a correction (the two friction signals that passed validation: 78% and 96% precision)",
        "caveats": [
            "Pseudo-users are a hash of IP address and browser headers. Merging two people into one key mixes people who chose different models, which keeps a gap rather than erasing it, so a collapsed gap is conservative; splitting one person across keys only shrinks the sample.",
            "Holding the person and the intent fixed removes who chose each model, but not which task a person brought to which model; only a randomized test removes that.",
        ],
        "method": "Naive: all conversations on each model, as a dashboard compares them. Matched: only pseudo-users seen on both models with the same intent in the window; each user's rate on each model, averaged with users weighted equally; 95% bootstrap interval over users.",
        "pairs": rows,
    }
    out.write_text(json.dumps(res, indent=2))
    for r in rows:
        f = r["friction"]
        print(f"  friction {r['intent']:10} {r['model_a']:12} vs {r['model_b']}: naive {f['naive_a']:.2%} vs {f['naive_b']:.2%}  matched {f['matched_a']:.2%} vs {f['matched_b']:.2%} "
              f"(gap {f['matched_gap']*100:+.2f} [{f['matched_ci'][0]*100:+.2f},{f['matched_ci'][1]*100:+.2f}]) measurable={f['measurable']}")
        print(f"{r['intent']:10} {r['model_a']:12} vs {r['model_b']}: naive {r['naive_a']:.1%} vs {r['naive_b']:.1%} (gap {r['naive_gap']*100:+.1f})  "
              f"matched n={r['matched_users']} {r['matched_a']:.1%} vs {r['matched_b']:.1%} (gap {r['matched_gap']*100:+.1f} [{r['matched_ci'][0]*100:+.1f},{r['matched_ci'][1]*100:+.1f}])")
    return res


if __name__ == "__main__":
    main()
