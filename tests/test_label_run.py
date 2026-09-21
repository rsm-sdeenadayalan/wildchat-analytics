import json
from pathlib import Path
from types import SimpleNamespace

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from loupe.stages import label


class FakeBatches:
    """Fake Message Batches API. create() may be called twice (canary, then the rest)."""

    def __init__(self, results_by_batch, ids=("b-canary", "b1")):
        self._results = dict(results_by_batch)
        self._ids = list(ids)
        self.creates = []

    @property
    def created(self):
        return self.creates[-1] if self.creates else None

    def create(self, requests):
        self.creates.append(list(requests))
        return SimpleNamespace(id=self._ids[len(self.creates) - 1], processing_status="in_progress")

    def retrieve(self, bid):
        n = len(self._results.get(bid, []))
        return SimpleNamespace(id=bid, processing_status="ended",
                               request_counts=SimpleNamespace(processing=0, succeeded=n))

    def results(self, bid):
        return iter(self._results.get(bid, []))


class FakeMessages:
    def __init__(self, results_by_batch, ids=("b-canary", "b1")):
        self.batches = FakeBatches(results_by_batch, ids)

    def count_tokens(self, model, system, messages):
        return SimpleNamespace(input_tokens=500)


def _client(results_by_batch, ids=("b-canary", "b1")):
    return SimpleNamespace(messages=FakeMessages(results_by_batch, ids))


def _ok(cid, text, in_tok=500, out_tok=20, **usage_extra):
    msg = SimpleNamespace(usage=SimpleNamespace(input_tokens=in_tok, output_tokens=out_tok, **usage_extra),
                          content=[SimpleNamespace(type="text", text=text)])
    return SimpleNamespace(custom_id=str(cid), result=SimpleNamespace(type="succeeded", message=msg))


def _err(cid):
    return SimpleNamespace(custom_id=str(cid), result=SimpleNamespace(type="errored", error=SimpleNamespace(type="server_error")))


def _sample(tmp_path, ids=(1001, 2002, 3003, 4004)):
    sample = tmp_path / "s.parquet"
    pq.write_table(pa.Table.from_pylist([{"conv_id": i, "intent_text": f"text {i}"} for i in ids]), sample)
    return sample


def test_run_keys_by_custom_id_counts_errors_and_writes_outputs(tmp_path):
    sample = _sample(tmp_path)
    # canary parses cleanly; the main batch has one errored, one non-JSON and one missing a key
    results = {
        "b-canary": [
            _ok(2002, json.dumps({"intent": "translation", "confidence": "high"})),
            _ok(1001, json.dumps({"intent": "coding", "confidence": "medium"})),
        ],
        "b1": [
            _err(3003),
            _ok(4004, "not json"),
            _ok(5005, json.dumps({"confidence": "low"})),  # missing intent -> counted as error
        ],
    }
    client = _client(results)
    out = tmp_path / "labels.parquet"
    log_path = tmp_path / "run.json"
    run_log = label.run(sample_path=sample, out_path=out, model="claude-opus-5", budget_usd=60,
                        poll_seconds=0, client=client, run_log_path=log_path, canary_n=2)
    rows = {r["conv_id"]: r for r in pq.read_table(out).to_pylist()}
    assert set(rows) == {1001, 2002}
    assert rows[1001]["intent"] == "coding" and rows[2002]["confidence"] == "high"
    assert run_log["labeled"] == 2 and run_log["errors"] == 3
    assert run_log["input_tokens"] == 2000 and run_log["output_tokens"] == 80
    assert run_log["batch_id"] == "b1" and run_log["n"] == 4
    assert run_log["canary_batch_id"] == "b-canary" and run_log["canary_parse_rate"] == 1.0
    assert abs(run_log["actual_usd"] - label.estimate_cost_usd("claude-opus-5", 1, 2000, 80)) < 1e-12
    assert json.loads(log_path.read_text())["labeled"] == 2
    # two batches: the canary and the remaining requests, together the whole sample, each request once
    creates = client.messages.batches.creates
    assert len(creates) == 2 and [len(c) for c in creates] == [2, 2]
    assert sorted(r["custom_id"] for c in creates for r in c) == ["1001", "2002", "3003", "4004"]
    # only 2 of 4 labeled -> the run is flagged not ok
    assert run_log["labeled_share"] == 0.5 and run_log["ok"] is False


def test_run_dry_run_submits_nothing_and_budget_blocks(tmp_path):
    sample = tmp_path / "s.parquet"
    pq.write_table(pa.Table.from_pylist([{"conv_id": 1, "intent_text": "x"}]), sample)
    client = _client({})
    log = label.run(sample_path=sample, out_path=tmp_path / "o.parquet", model="claude-opus-5",
                    budget_usd=60, client=client, dry_run=True, run_log_path=tmp_path / "r.json")
    assert "batch_id" not in log and client.messages.batches.created is None
    with pytest.raises(label.BudgetExceeded):
        label.run(sample_path=sample, out_path=tmp_path / "o.parquet", model="claude-opus-5",
                  budget_usd=0.0000001, client=client, run_log_path=tmp_path / "r.json")
    assert client.messages.batches.created is None


def test_run_canary_aborts_when_parse_rate_low(tmp_path):
    sample = _sample(tmp_path)
    results = {"b-canary": [_ok(1001, "sorry, I cannot"), _ok(2002, "<thinking> ...")],
               "b1": [_ok(3003, json.dumps({"intent": "coding", "confidence": "high"}))]}
    client = _client(results)
    log_path = tmp_path / "run.json"
    with pytest.raises(label.CanaryFailed):
        label.run(sample_path=sample, out_path=tmp_path / "labels.parquet", model="claude-opus-5",
                  budget_usd=60, poll_seconds=0, client=client, run_log_path=log_path, canary_n=2)
    assert len(client.messages.batches.creates) == 1  # the remaining requests were never submitted
    log = json.loads(log_path.read_text())
    assert log["aborted"] is True and log["canary_parse_rate"] == 0.0
    assert log["canary_batch_id"] == "b-canary" and "batch_id" not in log


def test_run_resume_polls_an_existing_batch_without_creating(tmp_path):
    sample = _sample(tmp_path)
    results = {"b1": [_ok(cid, json.dumps({"intent": "coding", "confidence": "high"}))
                      for cid in (1001, 2002, 3003, 4004)]}
    client = _client(results)
    out = tmp_path / "labels.parquet"
    log_path = tmp_path / "run.json"
    run_log = label.run(sample_path=sample, out_path=out, model="claude-opus-5", budget_usd=60,
                        poll_seconds=0, client=client, run_log_path=log_path, resume_batch_id="b1")
    assert client.messages.batches.creates == []
    assert run_log["batch_id"] == "b1" and run_log["resumed"] is True
    assert run_log["labeled"] == 4 and run_log["ok"] is True
    assert {r["conv_id"] for r in pq.read_table(out).to_pylist()} == {1001, 2002, 3003, 4004}


def test_run_batch_id_is_persisted_before_polling(tmp_path):
    """The run log must carry the batch id even if the process dies during the poll."""
    sample = _sample(tmp_path)
    log_path = tmp_path / "run.json"
    seen = {}

    class Dying(FakeBatches):
        def retrieve(self, bid):
            seen["log"] = json.loads(log_path.read_text())
            raise KeyboardInterrupt

    client = _client({})
    client.messages.batches = Dying({}, ("b-canary", "b1"))
    with pytest.raises(KeyboardInterrupt):
        label.run(sample_path=sample, out_path=tmp_path / "labels.parquet", model="claude-opus-5",
                  budget_usd=60, poll_seconds=0, client=client, run_log_path=log_path, canary_n=2)
    assert seen["log"]["canary_batch_id"] == "b-canary"


def test_run_bad_custom_id_is_an_error_not_a_crash(tmp_path):
    sample = _sample(tmp_path, ids=(1001, 2002))
    good = json.dumps({"intent": "coding", "confidence": "high"})
    results = {"b-canary": [_ok(1001, good)],
               "b1": [SimpleNamespace(custom_id="not-an-int",
                                      result=SimpleNamespace(type="succeeded", message=SimpleNamespace(
                                          usage=SimpleNamespace(input_tokens=10, output_tokens=5),
                                          content=[SimpleNamespace(type="text", text=good)])))]}
    client = _client(results)
    out = tmp_path / "labels.parquet"
    run_log = label.run(sample_path=sample, out_path=out, model="claude-opus-5", budget_usd=60,
                        poll_seconds=0, client=client, run_log_path=tmp_path / "run.json", canary_n=1)
    assert run_log["errors"] == 1 and run_log["labeled"] == 1
    assert run_log["ok"] is False and run_log["labeled_share"] == 0.5
    assert [r["conv_id"] for r in pq.read_table(out).to_pylist()] == [1001]


def test_actual_cost_includes_cache_tokens(tmp_path):
    sample = _sample(tmp_path, ids=(1001, 2002))
    good = json.dumps({"intent": "coding", "confidence": "high"})
    results = {"b-canary": [_ok(1001, good, cache_creation_input_tokens=100, cache_read_input_tokens=None)],
               "b1": [_ok(2002, good, cache_creation_input_tokens=0, cache_read_input_tokens=300)]}
    run_log = label.run(sample_path=sample, out_path=tmp_path / "labels.parquet", model="claude-opus-5",
                        budget_usd=60, poll_seconds=0, client=_client(results),
                        run_log_path=tmp_path / "run.json", canary_n=1)
    assert run_log["cache_creation_input_tokens"] == 100 and run_log["cache_read_input_tokens"] == 300
    # 1000 plain input + 400 cache tokens are all billed
    assert abs(run_log["actual_usd"] - label.estimate_cost_usd("claude-opus-5", 1, 1400, 40)) < 1e-12
