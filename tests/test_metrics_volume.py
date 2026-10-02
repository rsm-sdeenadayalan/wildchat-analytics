import datetime as dt

from loupe.stages import metrics
from loupe.stages import flatten


def _register(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    metrics.register(con, flat)


def test_volume_daily_model(con, tmp_path, mini_shard_path):
    _register(con, tmp_path, mini_shard_path)
    rows = {(r["date"], r["model"]): r for r in metrics.run_sql(con, "volume_daily_model").to_pylist()}
    r = rows[(dt.date(2024, 3, 4), "gpt-4o")]
    assert r["conversations"] == 2 and r["turns"] == 3
    assert r["prompt_tokens"] == 30 and r["completion_tokens"] == 60 and r["conversations_with_tokens"] == 2
    assert rows[(dt.date(2024, 3, 11), "gpt-4")]["prompt_tokens"] is None


def test_volume_weekly_country_suppresses_small_cells(con, tmp_path, mini_shard_path):
    _register(con, tmp_path, mini_shard_path)
    # everything is below the floor: nothing is dropped silently, the residual is one 'small cells' row per week
    sup = metrics.run_sql(con, "volume_weekly_country", min_cell=20).to_pylist()
    assert [r["country"] for r in sup] == ["small cells"] * 2
    assert [r["conversations"] for r in sup] == [3, 3]
    assert all(r["pseudo_users"] is None for r in sup)
    assert [r["week"] for r in sup] == [dt.date(2024, 3, 4), dt.date(2024, 3, 11)]
    # the mini shard has a country on every conversation, so no 'not recorded' row appears
    assert not [r for r in sup if r["country"] == "not recorded"]
    rows = metrics.run_sql(con, "volume_weekly_country", min_cell=1).to_pylist()
    us_w1 = [r for r in rows if r["country"] == "United States" and r["week"] == dt.date(2024, 3, 4)][0]
    assert us_w1["conversations"] == 3 and us_w1["pseudo_users"] == 2
    # nothing was suppressed at min_cell=1, so no residual rows at all
    assert not [r for r in rows if r["country"] in ("small cells", "not recorded")]
    # rows always sum to the shard's conversations, whatever the floor
    assert sum(r["conversations"] for r in rows) == sum(r["conversations"] for r in sup) == 6


def test_volume_weekly_language(con, tmp_path, mini_shard_path):
    _register(con, tmp_path, mini_shard_path)
    rows = metrics.run_sql(con, "volume_weekly_language", min_cell=1).to_pylist()
    zh = [r for r in rows if r["language"] == "Chinese"][0]
    assert zh["conversations"] == 1 and zh["week"] == dt.date(2024, 3, 11)
    assert not [r for r in rows if r["language"] in ("small cells", "not recorded")]
    sup = metrics.run_sql(con, "volume_weekly_language", min_cell=20).to_pylist()
    assert [(r["language"], r["conversations"]) for r in sup] == [("small cells", 3)] * 2
