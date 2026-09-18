import json

import pyarrow.parquet as pq
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
    assert meta == m
