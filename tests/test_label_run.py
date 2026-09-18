import json
from pathlib import Path
from types import SimpleNamespace

import pyarrow as pa
import pyarrow.parquet as pq
from loupe.stages import label


class FakeBatches:
    def __init__(self, results):
        self._results = results
        self.created = None
    def create(self, requests):
        self.created = requests
        return SimpleNamespace(id="b1", processing_status="in_progress")
    def retrieve(self, bid):
        return SimpleNamespace(id=bid, processing_status="ended",
                               request_counts=SimpleNamespace(processing=0, succeeded=len(self._results)))
    def results(self, bid):
        return iter(self._results)


class FakeMessages:
    def __init__(self, results):
        self.batches = FakeBatches(results)
    def count_tokens(self, model, system, messages):
        return SimpleNamespace(input_tokens=500)


def _ok(cid, text, in_tok=500, out_tok=20):
    msg = SimpleNamespace(usage=SimpleNamespace(input_tokens=in_tok, output_tokens=out_tok),
                          content=[SimpleNamespace(type="text", text=text)])
    return SimpleNamespace(custom_id=str(cid), result=SimpleNamespace(type="succeeded", message=msg))


def _err(cid):
    return SimpleNamespace(custom_id=str(cid), result=SimpleNamespace(type="errored", error=SimpleNamespace(type="server_error")))


def test_run_keys_by_custom_id_counts_errors_and_writes_outputs(tmp_path):
    sample = tmp_path / "s.parquet"
    pq.write_table(pa.Table.from_pylist([
        {"conv_id": 1001, "intent_text": "write python"},
        {"conv_id": 2002, "intent_text": "translate this"},
        {"conv_id": 3003, "intent_text": "hi"},
        {"conv_id": 4004, "intent_text": "poem"},
    ]), sample)
    # results arrive out of order, one errored, one non-JSON, one missing a key
    results = [
        _ok(2002, json.dumps({"intent": "translation", "confidence": "high"})),
        _err(3003),
        _ok(1001, json.dumps({"intent": "coding", "confidence": "medium"})),
        _ok(4004, "not json"),
        _ok(5005, json.dumps({"confidence": "low"})),  # missing intent -> counted as error
    ]
    client = SimpleNamespace(messages=FakeMessages(results))
    out = tmp_path / "labels.parquet"
    log_path = tmp_path / "run.json"
    run_log = label.run(sample_path=sample, out_path=out, model="claude-opus-5", budget_usd=60,
                        poll_seconds=0, client=client, run_log_path=log_path)
    rows = {r["conv_id"]: r for r in pq.read_table(out).to_pylist()}
    assert set(rows) == {1001, 2002}
    assert rows[1001]["intent"] == "coding" and rows[2002]["confidence"] == "high"
    assert run_log["labeled"] == 2 and run_log["errors"] == 3
    assert run_log["input_tokens"] == 2000 and run_log["output_tokens"] == 80
    assert run_log["batch_id"] == "b1" and run_log["n"] == 4
    assert abs(run_log["actual_usd"] - label.estimate_cost_usd("claude-opus-5", 1, 2000, 80)) < 1e-12
    assert json.loads(log_path.read_text())["labeled"] == 2
    assert len(client.messages.batches.created) == 4
    assert client.messages.batches.created[0]["custom_id"] == "1001"


def test_run_dry_run_submits_nothing_and_budget_blocks(tmp_path):
    sample = tmp_path / "s.parquet"
    pq.write_table(pa.Table.from_pylist([{"conv_id": 1, "intent_text": "x"}]), sample)
    client = SimpleNamespace(messages=FakeMessages([]))
    log = label.run(sample_path=sample, out_path=tmp_path / "o.parquet", model="claude-opus-5",
                    budget_usd=60, client=client, dry_run=True, run_log_path=tmp_path / "r.json")
    assert "batch_id" not in log and client.messages.batches.created is None
    import pytest
    with pytest.raises(label.BudgetExceeded):
        label.run(sample_path=sample, out_path=tmp_path / "o.parquet", model="claude-opus-5",
                  budget_usd=0.0000001, client=client, run_log_path=tmp_path / "r.json")
    assert client.messages.batches.created is None
