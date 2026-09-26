"""Intent labeling through an OpenAI-compatible gateway (UCSD TritonAI).

Request-by-request with bounded concurrency, retry with backoff on rate limits,
incremental progress to a JSONL file so a run can be stopped and resumed, a
canary gate before the main run, and a run log. The API key is read from the
environment (or a local .env file that is never committed).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import random
import re
import sys
import time
from pathlib import Path

import duckdb

from loupe.stages.label import (LABEL_SCHEMA, CANARY_MIN_PARSE_RATE, CANARY_N, MIN_LABELED_SHARE, CanaryFailed,
                                _write_labels, _write_log, class_names, system_blocks)

BASE_URL = "https://tritonai-api.ucsd.edu/v1"
DEFAULT_MODEL = "claude-sonnet-5"
DEFAULT_CONCURRENCY = 6  # the gateway allows at most 7 parallel requests per key
MIN_INTERVAL_S = 0.7  # ~85 requests/min, under the gateway's 100/min cap
MAX_TOKENS = 64
CONFIDENCES = {"low", "medium", "high"}
_JSON = re.compile(r"\{.*?\}", re.S)


def load_dotenv(path: Path = Path(".env")) -> None:
    """Set variables from a KEY=VALUE file without overriding existing ones. Values are never logged."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def parse_label(text: str | None) -> dict | None:
    for candidate in ([text] if text else []) + _JSON.findall(text or ""):
        try:
            data = json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(data, dict) and data.get("intent") in class_names() and data.get("confidence") in CONFIDENCES:
            return {"intent": data["intent"], "confidence": data["confidence"]}
    return None


def build_messages(intent_text: str) -> list[dict]:
    system = system_blocks()[0]["text"] + ' Respond with a JSON object only: {"intent": "<class>", "confidence": "low|medium|high"}.'
    return [{"role": "system", "content": system}, {"role": "user", "content": "Person's message(s):\n\n" + intent_text}]


def _is_retryable(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None)
    return status in (408, 409, 429) or (isinstance(status, int) and status >= 500) or status is None and "timeout" in type(exc).__name__.lower()


class _Pacer:
    """Spaces request starts at least `interval` seconds apart across all workers."""

    def __init__(self, interval: float):
        self.interval = interval
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self):
        async with self._lock:
            now = time.monotonic()
            start = max(now, self._next)
            self._next = start + self.interval
        if start > now:
            await asyncio.sleep(start - now)


async def _label_one(row, client, model, sem, progress, max_attempts, backoff_base, pacer):
    conv_id, text = row
    async with sem:
        for attempt in range(max_attempts):
            try:
                await pacer.wait()
                resp = await client.chat.completions.create(model=model, messages=build_messages(text),
                                                            max_tokens=MAX_TOKENS, temperature=0)
            except Exception as exc:  # noqa: BLE001 - any transport/API error is handled uniformly
                if attempt + 1 < max_attempts and _is_retryable(exc):
                    await asyncio.sleep(backoff_base * (2 ** attempt) + random.uniform(0, backoff_base))
                    continue
                progress.write(json.dumps({"conv_id": conv_id, "error": "failed", "detail": type(exc).__name__}) + "\n")
                progress.flush()
                return "failed", 0, 0
            usage = getattr(resp, "usage", None)
            pt = int(getattr(usage, "prompt_tokens", 0) or 0)
            ct = int(getattr(usage, "completion_tokens", 0) or 0)
            choices = getattr(resp, "choices", None) or []
            label = parse_label(choices[0].message.content) if choices else None
            if label is None:
                progress.write(json.dumps({"conv_id": conv_id, "error": "parse"}) + "\n")
                progress.flush()
                return "parse", pt, ct
            progress.write(json.dumps({"conv_id": conv_id, **label, "input_tokens": pt, "output_tokens": ct}) + "\n")
            progress.flush()
            return "labeled", pt, ct
    return "failed", 0, 0


async def label_rows(rows: list[tuple[int, str]], client, model: str, concurrency: int, progress_path: Path,
                     max_attempts: int = 6, backoff_base: float = 2.0, min_interval_s: float = MIN_INTERVAL_S) -> dict:
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(concurrency)
    pacer = _Pacer(min_interval_s)
    summary = {"labeled": 0, "parse_errors": 0, "failed": 0, "input_tokens": 0, "output_tokens": 0}
    with open(progress_path, "a") as progress:
        results = await asyncio.gather(*[_label_one(r, client, model, sem, progress, max_attempts, backoff_base, pacer) for r in rows])
    for status, pt, ct in results:
        summary["input_tokens"] += pt
        summary["output_tokens"] += ct
        summary[{"labeled": "labeled", "parse": "parse_errors", "failed": "failed"}[status]] += 1
    return summary


def _read_progress(progress_path: Path) -> tuple[list[dict], set[int]]:
    labeled, done = [], set()
    if not progress_path.exists():
        return labeled, done
    for line in progress_path.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if "intent" in rec:
            labeled.append(rec)
            done.add(int(rec["conv_id"]))
    return labeled, done


def run(sample_path: Path = Path("samples/intent_sample.parquet"), out_path: Path = Path("samples/intent_labels.parquet"),
        progress_path: Path = Path("samples/intent_labels_progress.jsonl"), run_log_path: Path = Path("data/label_run.json"),
        client=None, model: str | None = None, concurrency: int = DEFAULT_CONCURRENCY, canary_n: int = CANARY_N,
        limit: int | None = None, backoff_base: float = 2.0, min_interval_s: float = MIN_INTERVAL_S) -> dict:
    model = model or os.environ.get("LOUPE_LABEL_MODEL", DEFAULT_MODEL)
    if client is None:
        load_dotenv()
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=os.environ["TRITONAI_API_KEY"], base_url=BASE_URL, max_retries=0, timeout=120)

    rows = duckdb.sql(f"SELECT conv_id, intent_text FROM read_parquet('{sample_path}') ORDER BY conv_id").fetchall()
    if limit:
        rows = rows[:limit]
    prior, done = _read_progress(progress_path)
    todo = [(int(c), t) for c, t in rows if int(c) not in done]
    started = time.time()
    log = {"backend": "tritonai", "model": model, "n": len(rows), "resumed_labeled": len(prior),
           "concurrency": concurrency, "started_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds")}
    print(f"{len(rows)} rows, {len(prior)} already labeled, {len(todo)} to do, concurrency {concurrency}", file=sys.stderr)

    totals = {"labeled": len(prior), "parse_errors": 0, "failed": 0, "input_tokens": 0, "output_tokens": 0}
    if todo and not prior:
        canary = todo[:canary_n]
        s = asyncio.run(label_rows(canary, client, model, concurrency, progress_path, backoff_base=backoff_base, min_interval_s=min_interval_s))
        rate = s["labeled"] / max(1, len(canary))
        log["canary_parse_rate"] = rate
        for k in totals:
            totals[k] += s[k]
        if rate < CANARY_MIN_PARSE_RATE:
            log.update({"aborted": True, **totals})
            _write_log(log, run_log_path)
            raise CanaryFailed(f"canary parse rate {rate:.2f} below {CANARY_MIN_PARSE_RATE}; nothing more submitted")
        todo = todo[canary_n:]
    else:
        log["canary_parse_rate"] = None if prior else 1.0

    if todo:
        s = asyncio.run(label_rows(todo, client, model, concurrency, progress_path, backoff_base=backoff_base, min_interval_s=min_interval_s))
        for k in totals:
            totals[k] += s[k]

    wanted = {int(c) for c, _ in rows}
    labeled_rows = [r for r in _read_progress(progress_path)[0] if int(r["conv_id"]) in wanted]
    _write_labels([{"conv_id": int(r["conv_id"]), "intent": r["intent"], "confidence": r["confidence"]} for r in labeled_rows], out_path)
    totals["labeled"] = len(labeled_rows)
    log.update(totals)
    log["labeled_share"] = len(labeled_rows) / max(1, len(rows))
    log["ok"] = log["labeled_share"] >= MIN_LABELED_SHARE
    log["elapsed_s"] = round(time.time() - started, 1)
    log["finished_at"] = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
    _write_log(log, run_log_path)
    print(json.dumps({k: v for k, v in log.items() if k != "model"}), file=sys.stderr)
    return log
