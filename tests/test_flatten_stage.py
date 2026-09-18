import pyarrow.parquet as pq
import pytest
from loupe.stages import flatten


def test_flatten_local_writes_two_tables_and_is_idempotent(tmp_path, mini_shard_path):
    out = tmp_path / "flat"
    labels = flatten.run(local_paths=[mini_shard_path], out_dir=out)
    assert labels == ["mini_wildchat"]
    convs = pq.read_table(out / "conversations" / "mini_wildchat.parquet")
    turns = pq.read_table(out / "turns" / "mini_wildchat.parquet")
    assert convs.num_rows == 6 and turns.num_rows == 18
    # second run skips
    assert flatten.run(local_paths=[mini_shard_path], out_dir=out) == []


def test_flatten_crash_mid_write_does_not_leave_partial_output(tmp_path, mini_shard_path, monkeypatch):
    out = tmp_path / "flat"
    real_write_table = flatten.pq.write_table
    calls = {"n": 0}

    def flaky_write_table(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("disk full")
        return real_write_table(*args, **kwargs)

    monkeypatch.setattr(flatten.pq, "write_table", flaky_write_table)

    with pytest.raises(RuntimeError):
        flatten.run(local_paths=[mini_shard_path], out_dir=out)

    assert (out / "conversations" / "mini_wildchat.parquet").exists()
    assert not (out / "turns" / "mini_wildchat.parquet").exists()
    assert not any(p.name.endswith(".parquet") for p in (out / "turns").iterdir())

    monkeypatch.undo()

    assert flatten.run(local_paths=[mini_shard_path], out_dir=out) == ["mini_wildchat"]
    assert (out / "conversations" / "mini_wildchat.parquet").exists()
    assert (out / "turns" / "mini_wildchat.parquet").exists()
