from loupe import hf


def test_parse_shard_selection():
    names = [f"train-{i:05d}-of-00086.parquet" for i in range(86)]
    assert hf.select(names, "all") == names
    assert hf.select(names, "0-2") == names[:3]
    assert hf.select(names, "0,5,85") == [names[0], names[5], names[85]]


def test_shard_label():
    assert hf.label("train-00003-of-00086.parquet") == "train-00003-of-00086"
