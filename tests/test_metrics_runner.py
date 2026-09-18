import datetime as dt
import json

import pyarrow as pa
import pyarrow.parquet as pq
from loupe import schema
from loupe.stages import metrics, flatten


def test_run_writes_all_aggregates_and_meta(tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    out = tmp_path / "agg"
    meta = metrics.run(flat_dir=flat, out_dir=out, min_cell=1)
    for name in metrics.METRICS:
        assert (out / f"{name}.parquet").exists(), name
    assert pq.read_table(out / "intent_weekly.parquet").num_rows == 0   # no intent files -> empty view
    m = json.loads((out / "meta.json").read_text())
    assert m["conversations"] == 6 and m["min_cell"] == 1 and m["shards"] == 1
    assert m["intent_coverage"] == "none"
    assert m["date_min"] == "2024-03-04" and m["date_max"] == "2024-03-11"
    # date_min is a Monday and a full week fits; date_max's own week does not
    assert m["complete_weeks_from"] == "2024-03-04" and m["complete_weeks_through"] == "2024-03-04"
    assert m["token_coverage_first_week"] == "2024-03-04"
    assert m["token_coverage_note"].startswith("Token usage fields are present")
    assert m["intent_labeled_conversations"] == 0 and m["intent_share"] == 0.0
    assert m["population_caveat"] in m["caveats"] and m["pseudo_user_caveat"] in m["caveats"]
    assert len(m["caveats"]) == 4
    assert any("return_rate is NULL" in c for c in m["caveats"])
    assert any("2024-10" in c for c in m["caveats"])
    assert meta == m


def test_complete_weeks_boundaries():
    assert metrics.complete_weeks(dt.date(2024, 3, 4), dt.date(2024, 3, 11)) == (dt.date(2024, 3, 4), dt.date(2024, 3, 4))
    # date_min mid-week: the first complete week starts on the following Monday
    assert metrics.complete_weeks(dt.date(2024, 3, 6), dt.date(2024, 3, 24)) == (dt.date(2024, 3, 11), dt.date(2024, 3, 18))
    # no week fits
    assert metrics.complete_weeks(dt.date(2024, 3, 6), dt.date(2024, 3, 9)) == (None, None)


def test_intent_coverage_is_partial_when_shards_do_not_match(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    (flat / "intent").mkdir()
    pq.write_table(pa.Table.from_pylist(
        [{"conv_id": 1, "intent": "coding", "proba_max": 0.9, "shard": "some_other_shard"}],
        schema=schema.INTENT), flat / "intent" / "some_other_shard.parquet")
    assert metrics.register(con, flat) == "partial"


def test_intent_coverage_is_full_when_every_shard_is_predicted(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    (flat / "intent").mkdir()
    pq.write_table(pa.Table.from_pylist(
        [{"conv_id": 1, "intent": "coding", "proba_max": 0.9, "shard": "mini_wildchat"}],
        schema=schema.INTENT), flat / "intent" / "mini_wildchat.parquet")
    assert metrics.register(con, flat) == "full"


def test_model_family_column_strips_the_version_suffix(con, tmp_path):
    flat = tmp_path / "flat"
    (flat / "conversations").mkdir(parents=True)
    row = {f.name: None for f in schema.CONVERSATIONS}
    row.update({"conv_id": 1, "model": "gpt-4o-2024-05-13", "date": dt.date(2024, 3, 4),
                "week": dt.date(2024, 3, 4), "n_turns": 1, "shard": "s0"})
    pq.write_table(pa.Table.from_pylist([row], schema=schema.CONVERSATIONS), flat / "conversations" / "s0.parquet")
    metrics.register(con, flat)
    assert con.execute("SELECT model_family FROM conversations").fetchone()[0] == "gpt-4o"


def test_no_aggregate_has_a_decimal_column(con, tmp_path, mini_shard_path):
    """Arrow JS cannot treat DECIMAL(38,0) as a number, and DuckDB sums BIGINT into one."""
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    metrics.register(con, flat)
    for name in metrics.METRICS:
        table = metrics.run_sql(con, name, min_cell=1)
        assert not any(pa.types.is_decimal(f.type) for f in table.schema), name


def test_data_quality_weekly_has_no_negative_zero(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    metrics.register(con, flat)
    for r in metrics.run_sql(con, "data_quality_weekly").to_pylist():
        for k in ("redacted_rate", "empty_input_rate", "token_usage_coverage"):
            assert str(r[k]) != "-0.0", (r["week"], k)
