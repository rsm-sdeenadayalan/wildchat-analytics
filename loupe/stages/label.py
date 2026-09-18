"""Stage 3a: label the intent sample with Claude via the Message Batches API.

Cost control: estimate with count_tokens on a probe of 50 requests, refuse to
submit above LOUPE_LABEL_BUDGET_USD, and record actual usage afterwards.
"""
from __future__ import annotations

import datetime as dt
import json
import os
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
DEFAULT_MODEL = "claude-opus-5"
PROBE_N = 50
MAX_TOKENS = 64


class BudgetExceeded(RuntimeError):
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
    # cache_control makes the shared prefix cacheable across the batch
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
    return {
        "custom_id": str(conv_id),
        "params": {
            "model": model,
            "max_tokens": MAX_TOKENS,
            "system": system,
            "messages": [{"role": "user", "content": "Person's message(s):\n\n" + intent_text}],
            "output_config": {"format": {"type": "json_schema", "schema": _schema()}},
        },
    }


def estimate_cost_usd(model: str, n_requests: int, avg_input_tokens: float, avg_output_tokens: float = 30.0,
                      batch_discount: float = 0.5) -> float:
    p_in, p_out = PRICES[model]  # KeyError for unknown models is intentional
    return batch_discount * (n_requests * avg_input_tokens * p_in / 1e6 + n_requests * avg_output_tokens * p_out / 1e6)


def check_budget(estimated_usd: float, budget_usd: float) -> None:
    if estimated_usd > budget_usd:
        raise BudgetExceeded(f"estimated ${estimated_usd:.2f} exceeds cap ${budget_usd:.2f}; "
                             f"raise LOUPE_LABEL_BUDGET_USD or reduce --n in the sample stage")


def _probe_avg_input_tokens(client, model: str, requests: list[dict]) -> float:
    counts = []
    for r in requests[:PROBE_N]:
        p = r["params"]
        resp = client.messages.count_tokens(model=model, system=p["system"], messages=p["messages"])
        counts.append(resp.input_tokens)
    return statistics.fmean(counts) if counts else 0.0


def run(sample_path: Path = Path("samples/intent_sample.parquet"), out_path: Path = Path("samples/intent_labels.parquet"),
        model: str | None = None, budget_usd: float | None = None, poll_seconds: int = 60, dry_run: bool = False) -> dict:
    import anthropic

    model = model or os.environ.get("LOUPE_LABEL_MODEL", DEFAULT_MODEL)
    budget_usd = budget_usd if budget_usd is not None else float(os.environ.get("LOUPE_LABEL_BUDGET_USD", "60"))
    rows = duckdb.sql(f"SELECT conv_id, intent_text FROM read_parquet('{sample_path}')").fetchall()
    system = system_blocks()
    requests = [build_request(cid, txt, model, system) for cid, txt in rows]

    client = anthropic.Anthropic()
    avg_in = _probe_avg_input_tokens(client, model, requests)
    est = estimate_cost_usd(model, len(requests), avg_in)
    print(f"{len(requests)} requests, avg input {avg_in:.0f} tokens, estimated ${est:.2f} (cap ${budget_usd:.2f})", file=sys.stderr)
    check_budget(est, budget_usd)
    run_log = {"model": model, "n": len(requests), "avg_input_tokens": avg_in, "estimated_usd": est,
               "budget_usd": budget_usd, "started_at": dt.datetime.now(dt.UTC).isoformat()}
    if dry_run:
        return run_log

    batch = client.messages.batches.create(requests=requests)
    run_log["batch_id"] = batch.id
    print(f"batch {batch.id} submitted", file=sys.stderr)
    while True:
        batch = client.messages.batches.retrieve(batch.id)
        if batch.processing_status == "ended":
            break
        print(f"  {batch.processing_status}: {batch.request_counts.processing} processing, "
              f"{batch.request_counts.succeeded} done", file=sys.stderr)
        time.sleep(poll_seconds)

    out_rows, in_tok, out_tok, errors = [], 0, 0, 0
    for res in client.messages.batches.results(batch.id):
        if res.result.type != "succeeded":
            errors += 1
            continue
        msg = res.result.message
        in_tok += msg.usage.input_tokens
        out_tok += msg.usage.output_tokens
        text = next((b.text for b in msg.content if b.type == "text"), "")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            errors += 1
            continue
        out_rows.append({"conv_id": int(res.custom_id), "intent": data["intent"], "confidence": data["confidence"]})

    out_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(out_rows, schema=pa.schema([
        ("conv_id", pa.int64()), ("intent", pa.string()), ("confidence", pa.string())])), out_path)
    p_in, p_out = PRICES[model]
    run_log.update({"labeled": len(out_rows), "errors": errors, "input_tokens": in_tok, "output_tokens": out_tok,
                    "actual_usd": 0.5 * (in_tok * p_in / 1e6 + out_tok * p_out / 1e6),
                    "finished_at": dt.datetime.now(dt.UTC).isoformat()})
    Path("data").mkdir(exist_ok=True)
    Path("data/label_run.json").write_text(json.dumps(run_log, indent=2))
    print(json.dumps(run_log, indent=2), file=sys.stderr)
    return run_log
