from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from loupe import routing


def _write_cells(tmp_path: Path):
    rows = [
        # era B: coding is far better on o1-mini; image prompting equal and cheapest on mini; translation best on gpt-4o
        ("B", "2024-09-12", "2025-01-05", "coding", "gpt-4o", 10000, 0.0, 0.20, 0.0, 0.01),
        ("B", "2024-09-12", "2025-01-05", "coding", "gpt-4o-mini", 5000, 0.0, 0.40, 0.0, 0.01),
        ("B", "2024-09-12", "2025-01-05", "coding", "o1-mini", 2000, 0.0, 0.03, 0.0, 0.01),
        ("B", "2024-09-12", "2025-01-05", "image_prompting", "gpt-4o", 2000, 0.0, 0.02, 0.0, 0.03),
        ("B", "2024-09-12", "2025-01-05", "image_prompting", "gpt-4o-mini", 8000, 0.0, 0.02, 0.0, 0.02),
        ("B", "2024-09-12", "2025-01-05", "other", "gpt-4o", 9000, 0.0, 0.80, 0.0, 0.01),
        ("B", "2024-09-12", "2025-01-05", "coding", "o1", 500, 0.0, 0.01, 0.0, 0.02),  # under the eligibility floor
    ]
    t = pa.table({
        "era": [r[0] for r in rows], "era_start": pa.array([r[1] for r in rows]).cast(pa.string()), "era_end": [r[2] for r in rows],
        "intent": [r[3] for r in rows], "model": [r[4] for r in rows], "conversations": [r[5] for r in rows],
        "repeat_rate": [r[6] for r in rows], "one_and_done_rate": [r[7] for r in rows], "correction_rate": [r[8] for r in rows], "refusal_rate": [r[9] for r in rows],
    })
    pq.write_table(t, tmp_path / "friction_by_intent_model_era.parquet")


def test_policies_pick_expected_models_and_change_signs(tmp_path):
    _write_cells(tmp_path)
    res = routing.run(agg_dir=tmp_path, out_path=tmp_path / "out.json")
    pol = res["eras"]["B"]["policies"]
    assert "other" not in pol["best_friction"]["routes"]          # probe traffic is not routable
    assert pol["best_friction"]["routes"]["coding"] == "o1-mini"  # o1 has too few conversations to be chosen
    assert pol["cost_aware"]["routes"]["image_prompting"] == "gpt-4o-mini"
    assert pol["cheapest_only"]["routes"]["coding"] == "gpt-4o-mini"
    base = pol["baseline_actual_mix"]
    assert pol["best_friction"]["one_and_done_rate"] < base["one_and_done_rate"]
    assert pol["cheapest_only"]["cost_per_1k"] < base["cost_per_1k"]
    assert pol["cheapest_only"]["one_and_done_rate"] > base["one_and_done_rate"]
    assert abs(base["one_and_done_change_pts"]) < 1e-12 and (tmp_path / "out.json").exists()


def test_cost_uses_assumed_profile_and_list_prices():
    prices = {"assumed_tokens_per_conversation": {"prompt": 1000, "completion": 1000}, "prices_per_million": {"m": {"prompt": 1.0, "completion": 3.0}}}
    assert abs(routing.cost_per_conversation(prices, "m") - 0.004) < 1e-12
    assert routing.cost_per_conversation(prices, "unknown") is None
