import pyarrow as pa
from loupe import schema
from loupe.stages import metrics, flatten


def _with_intent(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    metrics.register(con, flat)
    intent = pa.Table.from_pylist([
        {"conv_id": 1001, "intent": "coding", "proba_max": 0.9, "shard": "mini"},
        {"conv_id": 2001, "intent": "other", "proba_max": 0.5, "shard": "mini"},
        {"conv_id": 3001, "intent": None, "proba_max": 0.0, "shard": "mini"},
        {"conv_id": 4001, "intent": "translation", "proba_max": 0.9, "shard": "mini"},
        {"conv_id": 5001, "intent": "writing_editing", "proba_max": 0.8, "shard": "mini"},
        {"conv_id": 6001, "intent": "homework_study", "proba_max": 0.7, "shard": "mini"},
    ], schema=schema.INTENT)
    con.register("intent_src", intent)
    con.execute("CREATE OR REPLACE VIEW intent AS SELECT * FROM intent_src")


def test_depth_by_model(con, tmp_path, mini_shard_path):
    _with_intent(con, tmp_path, mini_shard_path)
    rows = {(r["model"], r["depth_bucket"]): r["conversations"] for r in metrics.run_sql(con, "depth_by_model").to_pylist()}
    assert rows[("gpt-4o", "1")] == 2 and rows[("gpt-4o", "2")] == 1 and rows[("gpt-4o", "3-5")] == 1
    assert rows[("gpt-3.5-turbo", "1")] == 1 and rows[("gpt-4", "1")] == 1


def test_intent_weekly_and_by_model_skip_null(con, tmp_path, mini_shard_path):
    _with_intent(con, tmp_path, mini_shard_path)
    weekly = metrics.run_sql(con, "intent_weekly").to_pylist()
    assert sum(r["conversations"] for r in weekly) == 5   # 3001 has NULL intent
    by_model = {(r["model"], r["intent"]): r["conversations"] for r in metrics.run_sql(con, "intent_by_model").to_pylist()}
    assert by_model[("gpt-4o", "coding")] == 1 and by_model[("gpt-4", "translation")] == 1


def test_intent_by_language_min_cell(con, tmp_path, mini_shard_path):
    _with_intent(con, tmp_path, mini_shard_path)
    assert metrics.run_sql(con, "intent_by_language", min_cell=2).num_rows == 0
    rows = metrics.run_sql(con, "intent_by_language", min_cell=1).to_pylist()
    assert {(r["language"], r["intent"]) for r in rows} >= {("English", "coding"), ("Chinese", "translation")}
