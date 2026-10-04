"""Usage-weighted evaluation: score an assistant on the mix of work people actually bring it.

Most evaluation sets weight tasks by whatever their authors chose. Loupe publishes the observed intent mix
of a real population (by era and by language) so a team can weight its own per-prompt scores by it. The
prompts are the team's own; this module ships weights and the arithmetic, never conversation content.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import duckdb


def build_mix(agg_dir: Path = Path("aggregates")) -> dict:
    con = duckdb.connect()
    t = lambda name: f"'{agg_dir / name}.parquet'"  # noqa: E731
    meta = json.loads((agg_dir / "meta.json").read_text())
    overall = con.execute(f"SELECT intent, sum(conversations) FROM {t('intent_by_model')} GROUP BY 1 ORDER BY 2 DESC").fetchall()
    total = sum(n for _, n in overall)
    by_model = con.execute(f"SELECT model, intent, conversations FROM {t('intent_by_model')} ORDER BY 1, 2").fetchall()
    by_language = con.execute(f"SELECT language, intent, conversations FROM {t('intent_by_language')} ORDER BY 1, 2").fetchall()
    # eras follow the model-overlap windows used elsewhere; weekly cut gives the mix per window
    eras = {"A": ("2023-04-09", "2024-05-06"), "B": ("2024-09-12", "2025-01-05"), "C": ("2025-01-06", meta["complete_weeks_through"])}
    by_era = {}
    for era, (d0, d1) in eras.items():
        rows = con.execute(f"SELECT intent, sum(conversations) FROM {t('intent_weekly')} WHERE week BETWEEN DATE '{d0}' AND DATE '{d1}' GROUP BY 1").fetchall()
        n = sum(x for _, x in rows) or 1
        by_era[era] = {"start": d0, "end": d1, "conversations": int(n), "weights": {i: x / n for i, x in sorted(rows, key=lambda r: -r[1])}}

    def group(rows, key_idx):
        out = {}
        for r in rows:
            out.setdefault(r[key_idx], {})[r[1]] = out.get(r[key_idx], {}).get(r[1], 0) + r[2]
        return {k: {i: n / sum(v.values()) for i, n in sorted(v.items(), key=lambda kv: -kv[1])} for k, v in out.items()}

    return {
        "taxonomy_version": meta.get("taxonomy_version"),
        "classifier_accuracy": meta.get("classifier_accuracy"), "classifier_rater_agreement": meta.get("classifier_rater_agreement"),
        "population_caveat": meta.get("population_caveat"),
        "labeled_conversations": int(total),
        "weights": {i: n / total for i, n in overall},
        "weights_excluding_other": {i: n / (total - dict(overall).get("other", 0)) for i, n in overall if i != "other"},
        "by_era": by_era,
        "by_model": group(by_model, 0),
        "by_language": group(by_language, 0),
        "min_cell": meta["min_cell"],
    }


def weighted_score(results: list[dict], weights: dict[str, float]) -> dict:
    """results: rows with 'intent' and numeric 'score' (any scale). Returns the usage-weighted mean and the per-intent view.

    Intents with weight but no results are reported as missing and excluded, with the covered weight stated,
    so a partial eval can never silently look complete.
    """
    per: dict[str, list[float]] = {}
    for r in results:
        if r.get("intent") in weights and r.get("score") not in (None, ""):
            per.setdefault(r["intent"], []).append(float(r["score"]))
    covered = {i: w for i, w in weights.items() if i in per}
    cover_w = sum(covered.values())
    score = sum(weights[i] * (sum(v) / len(v)) for i, v in per.items()) / cover_w if cover_w else None
    unweighted = (sum(sum(v) for v in per.values()) / sum(len(v) for v in per.values())) if per else None
    return {
        "usage_weighted_score": score, "unweighted_mean": unweighted, "covered_weight": cover_w,
        "missing_intents": sorted(set(weights) - set(per)),
        "per_intent": {i: {"weight": weights[i], "n": len(v), "mean": sum(v) / len(v)} for i, v in sorted(per.items(), key=lambda kv: -weights[kv[0]])},
    }


def read_results_csv(path: Path) -> list[dict]:
    with path.open(newline="") as f:
        return list(csv.DictReader(f))
