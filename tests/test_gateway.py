"""Tests for the OpenAI-compatible gateway labeling backend (no network)."""
import asyncio
import json
from types import SimpleNamespace

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from loupe import gateway


class _Resp:
    def __init__(self, text, pt=70, ct=20):
        self.choices = [SimpleNamespace(message=SimpleNamespace(content=text), finish_reason="stop")]
        self.usage = SimpleNamespace(prompt_tokens=pt, completion_tokens=ct)


class _RateLimited(Exception):
    status_code = 429


class FakeClient:
    """Scripted responses per conv_id; a value may be a list consumed in order."""

    def __init__(self, script):
        self.script = {int(k): (list(v) if isinstance(v, list) else [v]) for k, v in script.items()}
        self.calls = 0
        self.max_in_flight = 0
        self._in_flight = 0
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, model, messages, max_tokens, temperature):
        self.calls += 1
        self._in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self._in_flight)
        await asyncio.sleep(0.001)
        self._in_flight -= 1
        cid = int(messages[-1]["content"].rsplit("#", 1)[-1])
        item = self.script[cid].pop(0)
        if isinstance(item, Exception):
            raise item
        return _Resp(item)


def _rows(ids):
    return [(i, f"text for #{i}") for i in ids]


def test_parse_label_accepts_json_and_embedded_json_and_rejects_bad_classes():
    assert gateway.parse_label('{"intent": "coding", "confidence": "high"}') == {"intent": "coding", "confidence": "high"}
    assert gateway.parse_label('Sure: {"intent": "translation", "confidence": "low"} done') == {"intent": "translation", "confidence": "low"}
    assert gateway.parse_label('{"intent": "poetry", "confidence": "high"}') is None
    assert gateway.parse_label('{"intent": "coding", "confidence": "sure"}') is None
    assert gateway.parse_label("not json") is None


def test_label_rows_retries_429_records_errors_and_writes_progress(tmp_path):
    client = FakeClient({
        1: '{"intent": "coding", "confidence": "high"}',
        2: [_RateLimited("429"), '{"intent": "other", "confidence": "low"}'],
        3: "garbage",
        4: [_RateLimited("429")] * 4,
    })
    progress = tmp_path / "p.jsonl"
    summary = asyncio.run(gateway.label_rows(_rows([1, 2, 3, 4]), client, "m", concurrency=2,
                                             progress_path=progress, max_attempts=3, backoff_base=0.0, min_interval_s=0.0))
    assert summary == {"labeled": 2, "parse_errors": 1, "failed": 1, "input_tokens": 210, "output_tokens": 60}  # tokens are consumed by the parse-error response too
    assert client.max_in_flight <= 2
    lines = [json.loads(l) for l in progress.read_text().splitlines()]
    assert {l["conv_id"] for l in lines if "intent" in l} == {1, 2}
    assert {l["conv_id"]: l["error"] for l in lines if "error" in l} == {3: "parse", 4: "failed"}


def test_run_resumes_from_progress_runs_canary_and_writes_outputs(tmp_path):
    sample = tmp_path / "s.parquet"
    pq.write_table(pa.Table.from_pylist([{"conv_id": i, "intent_text": f"text for #{i}"} for i in range(1, 7)]), sample)
    progress = tmp_path / "p.jsonl"
    progress.write_text(json.dumps({"conv_id": 1, "intent": "coding", "confidence": "high", "input_tokens": 1, "output_tokens": 1}) + "\n")
    client = FakeClient({i: '{"intent": "translation", "confidence": "medium"}' for i in range(2, 7)})
    out = tmp_path / "labels.parquet"
    log = gateway.run(sample_path=sample, out_path=out, progress_path=progress, run_log_path=tmp_path / "log.json",
                      client=client, model="m", concurrency=2, canary_n=2, backoff_base=0.0, min_interval_s=0.0)
    assert client.calls == 5                       # conv 1 skipped (resumed)
    rows = {r["conv_id"]: r["intent"] for r in pq.read_table(out).to_pylist()}
    assert rows == {1: "coding", **{i: "translation" for i in range(2, 7)}}
    assert log["labeled"] == 6 and log["n"] == 6 and log["backend"] == "tritonai" and log["ok"] is True
    assert log["canary_parse_rate"] is None          # resumed runs skip the canary
    assert json.loads((tmp_path / "log.json").read_text())["labeled"] == 6


def test_run_canary_aborts_before_main_batch(tmp_path):
    sample = tmp_path / "s.parquet"
    pq.write_table(pa.Table.from_pylist([{"conv_id": i, "intent_text": f"text for #{i}"} for i in range(1, 11)]), sample)
    client = FakeClient({i: "garbage" for i in range(1, 11)})
    with pytest.raises(gateway.CanaryFailed):
        gateway.run(sample_path=sample, out_path=tmp_path / "o.parquet", progress_path=tmp_path / "p.jsonl",
                    run_log_path=tmp_path / "log.json", client=client, model="m", concurrency=2, canary_n=4, backoff_base=0.0, min_interval_s=0.0)
    assert client.calls == 4
    assert json.loads((tmp_path / "log.json").read_text())["aborted"] is True


def test_load_dotenv_sets_only_missing_vars(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("TRITONAI_API_KEY=abc\n# comment\nOTHER=1\n")
    monkeypatch.delenv("TRITONAI_API_KEY", raising=False)
    monkeypatch.setenv("OTHER", "keep")
    gateway.load_dotenv(env)
    import os
    assert os.environ["TRITONAI_API_KEY"] == "abc" and os.environ["OTHER"] == "keep"


def test_pacer_spaces_request_starts(tmp_path):
    import time
    client = FakeClient({i: '{"intent": "coding", "confidence": "high"}' for i in range(1, 6)})
    t = time.monotonic()
    asyncio.run(gateway.label_rows(_rows([1, 2, 3, 4, 5]), client, "m", concurrency=5, progress_path=tmp_path / "p.jsonl",
                                   backoff_base=0.0, min_interval_s=0.05))
    assert time.monotonic() - t >= 0.2   # five starts spaced at least 0.05 s apart
