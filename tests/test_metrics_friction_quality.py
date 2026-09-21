import datetime as dt

import pyarrow as pa
from loupe import schema
from loupe.stages import metrics, flatten


def _setup(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    metrics.register(con, flat)
    intent = pa.Table.from_pylist([
        {"conv_id": 1001, "intent": "coding", "proba_max": 0.9, "shard": "mini"},
        {"conv_id": 2001, "intent": "coding", "proba_max": 0.5, "shard": "mini"},
        {"conv_id": 6001, "intent": "coding", "proba_max": 0.7, "shard": "mini"},
    ], schema=schema.INTENT)
    con.register("intent_src", intent)
    con.execute("CREATE OR REPLACE VIEW intent AS SELECT * FROM intent_src")


def test_friction_by_intent_model(con, tmp_path, mini_shard_path):
    _setup(con, tmp_path, mini_shard_path)
    rows = metrics.run_sql(con, "friction_by_intent_model", min_cell=1).to_pylist()
    r = [x for x in rows if x["intent"] == "coding" and x["model"] == "gpt-4o"][0]
    # C1 (repeat, correction, refusal), C2 (one_and_done), C6 (none)
    assert r["conversations"] == 3
    assert abs(r["repeat_rate"] - 1 / 3) < 1e-9 and abs(r["correction_rate"] - 1 / 3) < 1e-9
    assert abs(r["refusal_rate"] - 1 / 3) < 1e-9 and abs(r["one_and_done_rate"] - 1 / 3) < 1e-9


def test_friction_weekly_excludes_empty(con, tmp_path, mini_shard_path):
    _setup(con, tmp_path, mini_shard_path)
    rows = {r["week"]: r for r in metrics.run_sql(con, "friction_weekly").to_pylist()}
    assert rows[dt.date(2024, 3, 4)]["conversations"] == 2   # C3 excluded
    assert rows[dt.date(2024, 3, 11)]["repeat_rate"] == 0.0


def test_data_quality_weekly(con, tmp_path, mini_shard_path):
    _setup(con, tmp_path, mini_shard_path)
    rows = {r["week"]: r for r in metrics.run_sql(con, "data_quality_weekly").to_pylist()}
    w1, w2 = rows[dt.date(2024, 3, 4)], rows[dt.date(2024, 3, 11)]
    # rates are rounded to 6 decimals (to keep an all-zero week from printing as -0.0)
    assert abs(w1["empty_input_rate"] - 1 / 3) < 1e-6 and w1["redacted_rate"] == 0.0
    assert abs(w2["redacted_rate"] - 1 / 3) < 1e-6
    assert w1["token_usage_coverage"] == 1.0 and abs(w2["token_usage_coverage"] - 2 / 3) < 1e-6
