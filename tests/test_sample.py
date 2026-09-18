import pyarrow.parquet as pq
from loupe.stages import sample, flatten


def test_model_family():
    assert sample.model_family("gpt-4o-2024-05-13") == "gpt-4o"
    assert sample.model_family("gpt-4-0125-preview") == "gpt-4"
    assert sample.model_family("gpt-3.5-turbo-0613") == "gpt-3.5-turbo"
    assert sample.model_family("o1-mini-2024-09-12") == "o1-mini"
    assert sample.model_family("gpt-4.1-mini-2025-04-14") == "gpt-4.1-mini"
    assert sample.model_family("gpt-4o") == "gpt-4o"


def test_sample_excludes_empty_and_respects_n(tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    out = tmp_path / "s.parquet"
    n = sample.run(n=3, flat_dir=flat, out_path=out, min_per_stratum=1)
    t = pq.read_table(out).to_pylist()
    assert n == len(t) == 3
    assert all(r["conv_id"] != 3001 for r in t)          # empty input excluded
    assert all(r["conv_id"] != 2001 for r in t)          # "hi" is shorter than 5 chars
    assert set(t[0]) == {"conv_id", "model_family", "lang_bucket", "quarter", "intent_text"}
