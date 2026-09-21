import json
import random

import pyarrow as pa
import pyarrow.parquet as pq
from loupe import schema
from loupe.stages import classify, flatten


def _synthetic(n=400):
    random.seed(1)
    coding = ["write a python function", "fix this javascript error", "sql query to join tables", "explain this c++ code"]
    trans = ["translate this to french", "how do you say hello in spanish", "translate the paragraph into german", "翻译成英文"]
    texts, labels = [], []
    for _ in range(n // 2):
        texts.append(random.choice(coding) + " " + str(random.randint(0, 99))); labels.append("coding")
        texts.append(random.choice(trans) + " " + str(random.randint(0, 99))); labels.append("translation")
    return texts, labels


def test_train_reports_high_accuracy_on_separable_data():
    texts, labels = _synthetic()
    model, report = classify.train(texts, labels)
    assert report["accuracy"] >= 0.95 and report["macro_f1"] >= 0.95
    assert set(report["classes"]) == {"coding", "translation"}
    assert report["n_train"] + report["n_test"] == len(texts)
    assert model.predict(["please translate into italian"])[0] == "translation"


def test_run_writes_intent_per_shard_and_nulls_empty(tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    texts, labels = _synthetic()
    # labels file must reference conv_ids; use fixture ids with synthetic-like text via a labels table
    rows = [{"conv_id": 1001, "intent": "coding", "confidence": "high"},
            {"conv_id": 4001, "intent": "translation", "confidence": "high"}]
    labels_path = tmp_path / "labels.parquet"
    pq.write_table(pa.Table.from_pylist(rows), labels_path)
    # augment: train() needs more rows than two, so run() falls back to synthetic training only in tests via training_texts
    report = classify.run(labels_path=labels_path, flat_dir=flat, out_dir=tmp_path / "intent",
                          model_path=tmp_path / "m.joblib", report_path=tmp_path / "r.json",
                          threshold=0.0, extra_training=(texts, labels))
    assert report["predicted"] is True
    out = pq.read_table(tmp_path / "intent" / "mini_wildchat.parquet")
    assert out.schema.equals(schema.INTENT)
    by_id = {r["conv_id"]: r for r in out.to_pylist()}
    assert by_id[3001]["intent"] is None                # empty user input
    assert by_id[1001]["intent"] == "coding"
    assert by_id[4001]["intent"] == "translation"


def test_train_per_class_uses_f1_key():
    texts, labels = _synthetic()
    _, report = classify.train(texts, labels)
    assert set(report["per_class"]["coding"]) == {"precision", "recall", "f1", "support"}


def test_run_refuses_below_threshold_and_writes_complete_report(tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    texts, labels = _synthetic()
    rows = [{"conv_id": 1001, "intent": "coding", "confidence": "high"},
            {"conv_id": 4001, "intent": "translation", "confidence": "high"}]
    labels_path = tmp_path / "labels.parquet"
    pq.write_table(pa.Table.from_pylist(rows), labels_path)
    report = classify.run(labels_path=labels_path, flat_dir=flat, out_dir=tmp_path / "intent",
                          model_path=tmp_path / "m.joblib", report_path=tmp_path / "r.json",
                          threshold=1.01, extra_training=(texts, labels))
    assert report["predicted"] is False
    assert report["forced"] is False
    on_disk = json.loads((tmp_path / "r.json").read_text())
    assert on_disk["predicted"] is False
    assert on_disk["forced"] is False
    assert on_disk["threshold"] == 1.01
    intent_dir = tmp_path / "intent"
    assert not intent_dir.exists() or not list(intent_dir.glob("*.parquet"))
    assert (tmp_path / "m.joblib").exists()


def test_run_force_marks_forced(tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    texts, labels = _synthetic()
    rows = [{"conv_id": 1001, "intent": "coding", "confidence": "high"},
            {"conv_id": 4001, "intent": "translation", "confidence": "high"}]
    labels_path = tmp_path / "labels.parquet"
    pq.write_table(pa.Table.from_pylist(rows), labels_path)
    report = classify.run(labels_path=labels_path, flat_dir=flat, out_dir=tmp_path / "intent",
                          model_path=tmp_path / "m.joblib", report_path=tmp_path / "r.json",
                          threshold=1.01, force=True, extra_training=(texts, labels))
    assert report["predicted"] is True
    assert report["forced"] is True
    on_disk = json.loads((tmp_path / "r.json").read_text())
    assert on_disk["predicted"] is True
    assert on_disk["forced"] is True
    assert (tmp_path / "intent" / "mini_wildchat.parquet").exists()
