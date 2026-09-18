import pyarrow.parquet as pq
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
