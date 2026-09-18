import pyarrow as pa
import pyarrow.parquet as pq
from loupe import schema
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


def test_allocate_proportional_with_floor():
    result = sample.allocate({"A": 300, "B": 100, "C": 5}, n=100, min_per_stratum=10)
    assert result == {"A": 70, "B": 25, "C": 5}
    assert sum(result.values()) == 100


def test_allocate_when_floors_exceed_n():
    sizes = {i: 100 for i in range(50)}
    result = sample.allocate(sizes, n=200, min_per_stratum=20)
    assert sum(result.values()) == 200
    assert all(v == 4 for v in result.values())


def test_allocate_never_exceeds_stratum_size_or_n():
    result = sample.allocate({"A": 3, "B": 3}, n=100, min_per_stratum=20)
    assert result == {"A": 3, "B": 3}


def test_run_is_reproducible_and_buckets_other_language(tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    conv_files = list((flat / "conversations").glob("*.parquet"))
    rows = pq.read_table(conv_files[0]).to_pylist()
    base_row = next(r for r in rows if r["conv_id"] == 5001)

    new_rows = []
    for i in range(1, 10):
        r = dict(base_row)
        r["conv_id"] = 90000 + i
        r["language"] = f"L{i}"
        new_rows.append(r)

    lang_flat = tmp_path / "flat_lang"
    (lang_flat / "conversations").mkdir(parents=True)
    pq.write_table(
        pa.Table.from_pylist(new_rows, schema=schema.CONVERSATIONS),
        lang_flat / "conversations" / "langtest.parquet",
    )

    out1 = tmp_path / "s1.parquet"
    out2 = tmp_path / "s2.parquet"
    n1 = sample.run(n=9, flat_dir=lang_flat, out_path=out1, min_per_stratum=1)
    n2 = sample.run(n=9, flat_dir=lang_flat, out_path=out2, min_per_stratum=1)
    t1 = pq.read_table(out1).to_pylist()
    t2 = pq.read_table(out2).to_pylist()

    assert n1 == n2 == 9
    assert [r["conv_id"] for r in t1] == [r["conv_id"] for r in t2]

    lang_buckets = [r["lang_bucket"] for r in t1]
    assert "other" in lang_buckets
    assert len(set(lang_buckets)) == 9
