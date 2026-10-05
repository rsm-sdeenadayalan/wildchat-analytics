"""Routing counterfactual: what friction and cost would an intent-aware routing policy have produced?

Observational, within a window where several models served the same population at once. It sizes the
prize for a routing experiment; it is not the experiment (users chose their model, so cells carry
selection bias, and friction proxies are unvalidated). The cost side rests on list prices and an
assumed conversation profile in loupe/model_prices.json; both are labeled as assumptions in the output.
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb

PRICES_PATH = Path(__file__).resolve().parent / "model_prices.json"
MIN_CELL_FOR_CHOICE = 1000  # a model is eligible for an intent only with this many conversations on it
NEAR_BEST_PTS = 0.05        # cost-aware policy: cheapest model within 5 points of the best one-and-done rate


def cost_per_conversation(prices: dict, model: str) -> float | None:
    p = prices["prices_per_million"].get(model)
    if not p:
        return None
    t = prices["assumed_tokens_per_conversation"]
    return (t["prompt"] * p["prompt"] + t["completion"] * p["completion"]) / 1e6


def load_cells(agg_dir: Path, era: str) -> list[dict]:
    con = duckdb.connect()
    rows = con.execute(f"SELECT * FROM '{agg_dir / 'friction_by_intent_model_era.parquet'}' WHERE era = ? ORDER BY intent, model", [era]).fetchall()
    cols = [d[0] for d in con.description]
    return [dict(zip(cols, r)) for r in rows]


def policies_for(cells: list[dict], prices: dict) -> dict:
    """Baseline (actual mix) and three routing policies, each with expected volume-weighted friction and cost."""
    intents = sorted({c["intent"] for c in cells} - {"other"})  # 'other' is probe traffic; routing cannot rescue it
    by_intent = {i: [c for c in cells if c["intent"] == i] for i in intents}
    for c in cells:
        c["cost"] = cost_per_conversation(prices, c["model"])

    def summarize(choice: dict[str, str] | None) -> dict:
        tot = oad = ref = cost = corr = rep = 0.0
        for i in intents:
            group = by_intent[i]
            n_i = sum(c["conversations"] for c in group)
            if choice is None:  # baseline: actual mix
                for c in group:
                    tot += c["conversations"]; oad += c["conversations"] * c["one_and_done_rate"]; ref += c["conversations"] * c["refusal_rate"]
                    corr += c["conversations"] * c["correction_rate"]; rep += c["conversations"] * c["repeat_rate"]
                    cost += c["conversations"] * (c["cost"] or 0)
            else:
                m = choice[i]
                cell = next(c for c in group if c["model"] == m)
                tot += n_i; oad += n_i * cell["one_and_done_rate"]; ref += n_i * cell["refusal_rate"]; cost += n_i * (cell["cost"] or 0)
                corr += n_i * cell["correction_rate"]; rep += n_i * cell["repeat_rate"]
        return {"conversations": int(tot), "one_and_done_rate": oad / tot, "refusal_rate": ref / tot, "correction_rate": corr / tot, "repeat_rate": rep / tot,
                "cost_per_1k": 1000 * cost / tot, "routes": choice}

    eligible = {i: [c for c in by_intent[i] if c["conversations"] >= MIN_CELL_FOR_CHOICE and c["cost"] is not None] or by_intent[i] for i in intents}
    best = {i: min(eligible[i], key=lambda c: c["one_and_done_rate"])["model"] for i in intents}
    cheapest = {i: min(eligible[i], key=lambda c: c["cost"] or 0)["model"] for i in intents}
    cost_aware = {}
    for i in intents:
        floor = min(c["one_and_done_rate"] for c in eligible[i])
        near = [c for c in eligible[i] if c["one_and_done_rate"] <= floor + NEAR_BEST_PTS]
        cost_aware[i] = min(near, key=lambda c: c["cost"] or 0)["model"]
    out = {
        "baseline_actual_mix": summarize(None),
        "best_friction": summarize(best),
        "cost_aware": summarize(cost_aware),
        "cheapest_only": summarize(cheapest),
    }
    base = out["baseline_actual_mix"]
    for k, v in out.items():
        v["one_and_done_change_pts"] = v["one_and_done_rate"] - base["one_and_done_rate"]
        v["cost_change_pct"] = (v["cost_per_1k"] / base["cost_per_1k"] - 1) if base["cost_per_1k"] else None
    return out


def run(agg_dir: Path = Path("aggregates"), prices_path: Path = PRICES_PATH, out_path: Path | None = None) -> dict:
    prices = json.loads(prices_path.read_text())
    con = duckdb.connect()
    eras = con.execute(f"SELECT era, min(era_start), max(era_end), sum(conversations) FROM '{agg_dir / 'friction_by_intent_model_era.parquet'}' GROUP BY era ORDER BY era").fetchall()
    result = {
        "metric_note": "Policies are chosen on one_and_done_rate (share of conversations that end after one short turn). The 2026-10-04 validation found that signal is engagement depth, not failure: 60% of flagged real requests got what they came for. Read the gains as 'more conversations continue', and use correction_rate and repeat_rate, the two validated proxies, as the friction check.",
        "method": "Within each window where several models served traffic at once, take the observed one-and-done and refusal rates per intent and model, then compute the volume-weighted rates and list-price cost each routing policy would have produced on the same intent volumes. Observational: users chose their model, so cells carry selection bias; proxies are unvalidated. Sizes the prize for a routing experiment.",
        "min_cell_for_choice": MIN_CELL_FOR_CHOICE, "near_best_pts": NEAR_BEST_PTS,
        "price_assumptions": {"as_of": prices["as_of"], "assumed_tokens_per_conversation": prices["assumed_tokens_per_conversation"], "prices_per_million": prices["prices_per_million"]},
        "eras": {},
    }
    for era, d0, d1, n in eras:
        cells = load_cells(agg_dir, era)
        result["eras"][era] = {
            "start": str(d0), "end": str(d1), "conversations_in_cells": int(n),
            "models": sorted({c["model"] for c in cells}),
            "cells": [{k: (float(v) if isinstance(v, float) else v) for k, v in c.items() if k not in ("era", "era_start", "era_end")} for c in cells],
            "policies": policies_for(cells, prices),
        }
    if out_path:
        out_path.write_text(json.dumps(result, indent=2, default=str))
    return result
