import pyarrow.parquet as pq
from loupe import cli


def test_cli_flatten_local_then_metrics(tmp_path, mini_shard_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert cli.main(["flatten", "--local", str(mini_shard_path)]) == 0
    assert (tmp_path / "data/flat/conversations/mini_wildchat.parquet").exists()
    assert cli.main(["metrics", "--min-cell", "1"]) == 0
    assert pq.read_table(tmp_path / "aggregates/intensity_weekly.parquet").num_rows == 2


def test_cli_no_stage_returns_1():
    assert cli.main([]) == 1
