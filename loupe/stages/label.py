"""Stage 3a: label the intent sample with Claude via the Message Batches API.

Cost control: estimate with count_tokens on a probe of 50 requests, refuse to
submit above LOUPE_LABEL_BUDGET_USD, spend a small canary batch before the rest,
and record actual usage afterwards.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import random
import statistics
import sys
import time
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

TAXONOMY_PATH = Path(__file__).resolve().parent.parent / "taxonomy.json"

# USD per 1M tokens, standard (non-batch) rate: (input, output)
PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}
DEFAULT_MODEL = "claude-haiku-4-5"  # Shankar chose the cheapest model on 2026-09-20; override with LOUPE_LABEL_MODEL
PROBE_N = 50
PROBE_SEED = 11
MAX_TOKENS = 256
# Models whose default is adaptive thinking: thinking tokens would eat max_tokens
# and truncate the JSON, so the money path disables thinking explicitly.
THINKING_CAPABLE = {"claude-opus-5", "claude-sonnet-5"}
# Spend a small batch first and only continue if it parses.
CANARY_N = 50
CANARY_MIN_PARSE_RATE = 0.9
MIN_LABELED_SHARE = 0.9

LABEL_SCHEMA = pa.schema([("conv_id", pa.int64()), ("intent", pa.string()), ("confidence", pa.string())])


class BudgetExceeded(RuntimeError):
    pass


class CanaryFailed(RuntimeError):
    pass


def taxonomy() -> dict:
    return json.loads(TAXONOMY_PATH.read_text())


def class_names() -> list[str]:
    return [c["name"] for c in taxonomy()["classes"]]


def system_blocks() -> list[dict]:
    tax = taxonomy()
    lines = "\n".join(f"- {c['name']}: {c['definition']}" for c in tax["classes"])
    text = (
        "You label the intent of a conversation between a person and an AI assistant. "
        "You see only the person's first one or two messages. Choose exactly one class from this list:\n"
        f"{lines}\n\n"
        "Rules: judge what the person is trying to accomplish, not the topic words. If the message asks for code, "
        "choose coding even if the domain is business or school. If it asks to write a prompt for an image model, "
        "choose image_prompting. If it is a greeting, a test, or unreadable, choose other. "
        "Also report your confidence as low, medium, or high."
    )
    # cache_control on the shared prefix is harmless here and may engage only if the
    # prefix is longer than the model's minimum cacheable length; we do not rely on it.
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def _schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "intent": {"type": "string", "enum": class_names()},
            "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        },
        "required": ["intent", "confidence"],
        "additionalProperties": False,
    }


def build_request(conv_id: int, intent_text: str, model: str, system: list[dict]) -> dict:
    params = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": [{"role": "user", "content": "Person's message(s):\n\n" + intent_text}],
        "output_config": {"format": {"type": "json_schema", "schema": _schema()}},
    }
    if model in THINKING_CAPABLE:
        # Without this, adaptive thinking is on and its tokens count against max_tokens.
        params["thinking"] = {"type": "disabled"}
    return {"custom_id": str(conv_id), "params": params}


def estimate_cost_usd(model: str, n_requests: int, avg_input_tokens: float, avg_output_tokens: float = 40.0,
                      batch_discount: float = 0.5) -> float:
    p_in, p_out = PRICES[model]  # KeyError for unknown models is intentional
    return batch_discount * (n_requests * avg_input_tokens * p_in / 1e6 + n_requests * avg_output_tokens * p_out / 1e6)


def check_budget(estimated_usd: float, budget_usd: float) -> None:
    if estimated_usd > budget_usd:
        raise BudgetExceeded(f"estimated ${estimated_usd:.2f} exceeds cap ${budget_usd:.2f}; "
                             f"raise LOUPE_LABEL_BUDGET_USD or reduce --n in the sample stage")


def _probe_avg_input_tokens(client, model: str, requests: list[dict]) -> float:
    sample = random.Random(PROBE_SEED).sample(requests, min(PROBE_N, len(requests)))
    counts = []
    for r in sample:
        p = r["params"]
        resp = client.messages.count_tokens(model=model, system=p["system"], messages=p["messages"])
        counts.append(resp.input_tokens)
    return statistics.fmean(counts) if counts else 0.0


def _write_log(run_log: dict, run_log_path: Path) -> None:
    run_log_path.parent.mkdir(parents=True, exist_ok=True)
    run_log_path.write_text(json.dumps(run_log, indent=2))


def _write_labels(out_rows: list[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(out_rows, schema=LABEL_SCHEMA), out_path)


def _poll(client, batch_id: str, poll_seconds: int) -> None:
    while True:
        batch = client.messages.batches.retrieve(batch_id)
        if batch.processing_status == "ended":
            return
        print(f"  {batch.processing_status}: {batch.request_counts.processing} processing, "
              f"{batch.request_counts.succeeded} done", file=sys.stderr)
        time.sleep(poll_seconds)


class _Usage:
    """Running token totals, including the cache buckets that are also billed."""

    def __init__(self) -> None:
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_creation_input_tokens = 0
        self.cache_read_input_tokens = 0

    def add(self, usage) -> None:
        self.input_tokens += getattr(usage, "input_tokens", 0) or 0
        self.output_tokens += getattr(usage, "output_tokens", 0) or 0
        self.cache_creation_input_tokens += getattr(usage, "cache_creation_input_tokens", 0) or 0
        self.cache_read_input_tokens += getattr(usage, "cache_read_input_tokens", 0) or 0

    @property
    def billed_input_tokens(self) -> int:
        return self.input_tokens + self.cache_creation_input_tokens + self.cache_read_input_tokens


def _collect(client, batch_id: str, usage: _Usage) -> tuple[list[dict], int, int]:
    """Return (rows, errors, seen). One bad result never costs us the rest of a paid batch."""
    rows: list[dict] = []
    errors = 0
    seen = 0
    for res in client.messages.batches.results(batch_id):
        seen += 1
        try:
            if res.result.type != "succeeded":
                errors += 1
                continue
            msg = res.result.message
            usage.add(msg.usage)
            text = next((b.text for b in msg.content if b.type == "text"), "")
            data = json.loads(text)
            rows.append({"conv_id": int(res.custom_id), "intent": data["intent"],
                         "confidence": data["confidence"]})
        except Exception:
            errors += 1
            continue
    return rows, errors, seen


def run(sample_path: Path = Path("samples/intent_sample.parquet"), out_path: Path = Path("samples/intent_labels.parquet"),
        model: str | None = None, budget_usd: float | None = None, poll_seconds: int = 60, dry_run: bool = False,
        client=None, run_log_path: Path = Path("data/label_run.json"), resume_batch_id: str | None = None,
        canary_n: int = CANARY_N) -> dict:
    model = model or os.environ.get("LOUPE_LABEL_MODEL", DEFAULT_MODEL)
    budget_usd = budget_usd if budget_usd is not None else float(os.environ.get("LOUPE_LABEL_BUDGET_USD", "15"))
    rows = duckdb.sql(f"SELECT conv_id, intent_text FROM read_parquet('{sample_path}')").fetchall()
    system = system_blocks()
    requests = [build_request(cid, txt, model, system) for cid, txt in rows]

    if client is None:
        import anthropic
        client = anthropic.Anthropic()

    run_log = {"model": model, "n": len(requests), "started_at": dt.datetime.now(dt.UTC).isoformat()}
    usage = _Usage()
    out_rows: list[dict] = []
    errors = 0

    if resume_batch_id:
        # A batch is already paid for; do not probe, estimate, canary or create again.
        run_log.update({"resumed": True, "batch_id": resume_batch_id, "budget_usd": budget_usd})
        _write_log(run_log, run_log_path)
        print(f"resuming batch {resume_batch_id}", file=sys.stderr)
        main_id = resume_batch_id
    else:
        avg_in = _probe_avg_input_tokens(client, model, requests)
        est = estimate_cost_usd(model, len(requests), avg_in)
        print(f"{len(requests)} requests, avg input {avg_in:.0f} tokens, estimated ${est:.2f} "
              f"(cap ${budget_usd:.2f})", file=sys.stderr)
        check_budget(est, budget_usd)
        run_log.update({"avg_input_tokens": avg_in, "estimated_usd": est, "budget_usd": budget_usd})
        if dry_run:
            return run_log

        # Canary: pay for a few requests first and check that the answers parse.
        n_canary = min(max(int(canary_n), 0), len(requests))
        canary_reqs = random.Random(PROBE_SEED).sample(requests, n_canary) if n_canary else []
        canary_ids = {id(r) for r in canary_reqs}
        rest = [r for r in requests if id(r) not in canary_ids]

        if canary_reqs:
            canary_batch = client.messages.batches.create(requests=canary_reqs)
            run_log["canary_batch_id"] = canary_batch.id
            run_log["canary_n"] = len(canary_reqs)
            _write_log(run_log, run_log_path)  # persist the id before we can lose it to a Ctrl-C
            print(f"canary batch {canary_batch.id} submitted ({len(canary_reqs)} requests)", file=sys.stderr)
            _poll(client, canary_batch.id, poll_seconds)
            out_rows, errors, _ = _collect(client, canary_batch.id, usage)
            parse_rate = len(out_rows) / len(canary_reqs)
            run_log["canary_parse_rate"] = parse_rate
            _write_log(run_log, run_log_path)
            print(f"canary parse rate {parse_rate:.2f}", file=sys.stderr)
            if parse_rate < CANARY_MIN_PARSE_RATE:
                run_log["aborted"] = True
                run_log["ok"] = False
                run_log["finished_at"] = dt.datetime.now(dt.UTC).isoformat()
                _write_log(run_log, run_log_path)
                raise CanaryFailed(
                    f"canary parse rate {parse_rate:.2f} below {CANARY_MIN_PARSE_RATE}; "
                    f"not submitting the remaining {len(rest)} requests")

        if rest:
            batch = client.messages.batches.create(requests=rest)
            main_id = batch.id
            run_log["batch_id"] = main_id
            _write_log(run_log, run_log_path)  # persist the id before polling (batches run up to 24 h)
            print(f"batch {main_id} submitted ({len(rest)} requests)", file=sys.stderr)
        else:
            main_id = None
            run_log["batch_id"] = None

    try:
        if main_id is not None:
            _poll(client, main_id, poll_seconds)
            main_rows, main_errors, _ = _collect(client, main_id, usage)
            out_rows.extend(main_rows)
            errors += main_errors
    finally:
        _write_labels(out_rows, out_path)

    labeled_share = len(out_rows) / len(requests) if requests else 0.0
    ok = labeled_share >= MIN_LABELED_SHARE
    if not ok:
        print(f"WARNING only {labeled_share:.2%} of the sample was labeled "
              f"({len(out_rows)} of {len(requests)})", file=sys.stderr)
    run_log.update({"labeled": len(out_rows), "errors": errors, "labeled_share": labeled_share, "ok": ok,
                    "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens,
                    "cache_creation_input_tokens": usage.cache_creation_input_tokens,
                    "cache_read_input_tokens": usage.cache_read_input_tokens,
                    "actual_usd": estimate_cost_usd(model, 1, usage.billed_input_tokens, usage.output_tokens),
                    "finished_at": dt.datetime.now(dt.UTC).isoformat()})
    _write_log(run_log, run_log_path)
    print(json.dumps(run_log, indent=2), file=sys.stderr)
    return run_log
