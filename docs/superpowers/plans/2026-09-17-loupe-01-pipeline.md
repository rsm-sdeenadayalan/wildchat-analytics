# Loupe Pipeline Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python pipeline that turns WildChat-4.8M parquet shards into the Loupe conversation and turn tables, labels a stratified sample for intent with the Anthropic API, extends labels to every conversation with a lightweight classifier, and computes every analysis metric into small committed aggregate parquet files.

**Architecture:** Five CLI stages (`flatten`, `sample`, `label`, `classify`, `metrics`) share one DuckDB-centric data model. `flatten` downloads one shard at a time, unnests it in DuckDB, computes content-derived flags in Python, and writes content-free conversation and turn tables (plus a 2000-character local-only `intent_text` per conversation). `metrics` is pure SQL: one `.sql` file per aggregate, executed against the flattened tables, written to `aggregates/`. Every metric has a unit test on a hand-built fixture.

**Tech Stack:** Python 3.12 via `uv`, DuckDB, PyArrow, `huggingface_hub` (shard download), `anthropic` SDK (Message Batches + structured outputs), scikit-learn, pytest, Make.

**Spec:** `docs/superpowers/specs/2026-09-17-loupe-design.md` (Sections 8, 9, 10.1, 10.2, 12, 13, and 6.2 guardrails). Sibling plans: `2026-09-17-loupe-02-site.md` (dashboard + static site + GitHub Pages), `2026-09-17-loupe-03-pm-artifacts.md` (documents, research, validation). Loupe is standalone; nothing here touches shankard.com.

## Global Constraints

- Source dataset: `allenai/WildChat-4.8M` on Hugging Face. 3,199,860 conversations, 86 shards at `data/train-000NN-of-00086.parquet`. License ODC-By 1.0; attribution text must appear in the repo README (already present).
- Raw shards and any content-bearing file live under `data/` or `samples/`, which are gitignored. Only `aggregates/**/*.parquet`, `aggregates/*.json`, code, tests, and docs are committed. Never commit transcript content.
- Aggregates total size under 25 MB. Any cell (country, state, language slice) with fewer than 20 conversations is suppressed (dropped) before writing.
- Pseudo-user key = first 16 hex chars of SHA-256 over `hashed_ip|user-agent|accept-language`. Never call it a "user" in public copy.
- Conversation key `conv_id` = `turn_identifier` of the first message in the conversation (BIGINT). `conversation_hash` is not unique and is not used as a key.
- Conversations with any empty user input are flagged `has_empty_user_input` and excluded from intent and friction metrics.
- Token usage fields exist only in newer shards; token metrics are computed only where present and the coverage window is reported.
- Intent taxonomy v1 (10 classes, from `loupe/taxonomy.json`): `coding`, `writing_editing`, `creative_roleplay`, `image_prompting`, `homework_study`, `information_seeking`, `translation`, `business_professional`, `personal_advice`, `other`.
- Guardrails from spec 6.2: intent classifier held-out accuracy at least 0.85; friction proxies are validated in Plan 3 against 300 hand labels (precision at least 0.70).
- Labeling model: `claude-opus-5` by default via env `LOUPE_LABEL_MODEL`; the Message Batches API (50% price) is mandatory for the labeling run. Budget cap via env `LOUPE_LABEL_BUDGET_USD`, default `60`. The stage refuses to submit if the estimate exceeds the cap.
- Python 3.12 pinned in `.python-version`. All commands run through `uv run`.
- Commit after every task with the message shown. Every commit message ends with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File Structure

```
wildchat-analytics/
  pyproject.toml                 project metadata + deps (uv)
  .python-version                3.12
  Makefile                       setup / test / flatten / sample / label / classify / metrics / all
  loupe/__init__.py
  loupe/schema.py                DDL + Arrow schemas for the conversations and turns tables
  loupe/text.py                  pure functions: tokenization, jaccard, correction/refusal regexes, pseudo_user
  loupe/taxonomy.json            intent classes with one-line definitions (v1)
  loupe/hf.py                    list shard files and download one shard to data/raw/ via huggingface_hub
  loupe/adapters/__init__.py
  loupe/adapters/wildchat.py     one shard -> (conversations Arrow table, turns Arrow table)
  loupe/stages/__init__.py
  loupe/stages/flatten.py        stage 1
  loupe/stages/sample.py         stage 2
  loupe/stages/label.py          stage 3a (Anthropic Message Batches)
  loupe/stages/classify.py       stage 3b (sklearn) -> data/flat/intent/*.parquet
  loupe/stages/metrics.py        stage 4 -> aggregates/*.parquet + aggregates/meta.json
  loupe/metrics/*.sql            one file per aggregate
  loupe/cli.py                   `loupe <stage> [options]`
  tests/conftest.py              builds tests/fixtures/mini_wildchat.parquet (WildChat-shaped) and small DuckDB tables
  tests/test_text.py
  tests/test_wildchat_adapter.py
  tests/test_sample.py
  tests/test_label_budget.py
  tests/test_classify.py
  tests/test_metrics_volume.py
  tests/test_metrics_intensity.py
  tests/test_metrics_depth_intent.py
  tests/test_metrics_friction_quality.py
  tests/test_metrics_runner.py
  aggregates/.gitkeep
  data/                          gitignored
  samples/                       gitignored
```

---

### Task 1: Project scaffold and test harness

**Files:**
- Create: `pyproject.toml`, `.python-version`, `Makefile`, `loupe/__init__.py`, `loupe/adapters/__init__.py`, `loupe/stages/__init__.py`, `aggregates/.gitkeep`, `tests/__init__.py`, `tests/test_smoke.py`
- Modify: `.gitignore` (already excludes `data/`, `samples/`, `*.parquet` except `aggregates/**`)

**Interfaces:**
- Produces: `uv run pytest` works; `uv run loupe --help` prints stage list (Task 10 fills the CLI; this task creates the entry point stub).

- [ ] **Step 1: Write the project files**

`pyproject.toml`:
```toml
[project]
name = "loupe"
version = "0.1.0"
description = "User analytics for GenAI assistants, demonstrated on WildChat-4.8M"
requires-python = ">=3.12,<3.13"
dependencies = [
  "duckdb>=1.1",
  "pyarrow>=17",
  "anthropic>=1.0",
  "scikit-learn>=1.5",
  "joblib>=1.4",
  "numpy>=1.26",
  "huggingface_hub>=0.25",
]

[project.optional-dependencies]
dev = ["pytest>=8"]

[project.scripts]
loupe = "loupe.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["loupe"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`.python-version`:
```
3.12
```

`Makefile`:
```make
.PHONY: setup test flatten sample label classify metrics all clean-raw

SHARDS ?= all
MIN_CELL ?= 20

setup:
	uv python install 3.12
	uv sync --extra dev

test:
	uv run pytest -q

flatten:
	uv run loupe flatten --shards $(SHARDS)

sample:
	uv run loupe sample --n 20000

label:
	uv run loupe label

classify:
	uv run loupe classify

metrics:
	uv run loupe metrics --min-cell $(MIN_CELL)

all: flatten sample label classify metrics

clean-raw:
	rm -rf data/raw
```

`loupe/__init__.py`:
```python
"""Loupe: user analytics for GenAI assistants."""
__version__ = "0.1.0"
```

`loupe/adapters/__init__.py` and `loupe/stages/__init__.py`: empty files.

`loupe/cli.py` (stub; Task 10 completes it):
```python
import argparse
import sys

STAGES = ["flatten", "sample", "label", "classify", "metrics"]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="loupe", description="Loupe pipeline stages")
    p.add_subparsers(dest="stage", metavar="{" + ",".join(STAGES) + "}")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.stage is None:
        build_parser().print_help()
        return 1
    print(f"stage {args.stage} not implemented yet", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
```

`tests/__init__.py`: empty. `tests/test_smoke.py`:
```python
import loupe


def test_version():
    assert loupe.__version__ == "0.1.0"
```

- [ ] **Step 2: Install and run**

Run: `cd /Users/shankar/Documents/wildchat-analytics && make setup && make test`
Expected: `1 passed`.

Run: `uv run loupe --help`
Expected: usage text listing `{flatten,sample,label,classify,metrics}`.

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml .python-version Makefile loupe tests aggregates/.gitkeep uv.lock
git commit -m "Scaffold Loupe package, uv project, Makefile, and pytest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pure text functions (`loupe/text.py`)

**Files:**
- Create: `loupe/text.py`, `tests/test_text.py`

**Interfaces:**
- Produces:
  - `tokens(s: str) -> set[str]` lowercase word tokens (`\w+`, Unicode aware).
  - `jaccard(a: str, b: str) -> float` on token sets; returns `0.0` if either set is empty.
  - `is_repeat(prev_user: str | None, cur_user: str, threshold: float = 0.6) -> bool`
  - `is_correction(user_text: str) -> bool` start-of-turn correction pattern in en/zh/ru/es/fr.
  - `is_refusal(assistant_text: str) -> bool` start-of-turn refusal pattern in en/zh/ru.
  - `pseudo_user(hashed_ip: str | None, user_agent: str | None, accept_language: str | None) -> str` 16 hex chars.
  - `REPEAT_THRESHOLD = 0.6`

- [ ] **Step 1: Write the failing tests**

`tests/test_text.py`:
```python
from loupe import text


def test_tokens_lowercases_and_splits_unicode():
    assert text.tokens("Hello, WORLD! Привет мир") == {"hello", "world", "привет", "мир"}


def test_jaccard_identical_is_one_and_empty_is_zero():
    assert text.jaccard("a b c", "c b a") == 1.0
    assert text.jaccard("", "a b") == 0.0
    assert text.jaccard("!!!", "a b") == 0.0


def test_is_repeat_uses_threshold():
    assert text.is_repeat("write a poem about the sea", "write a poem about the sea please") is True
    assert text.is_repeat("write a poem about the sea", "fix my python code") is False
    assert text.is_repeat(None, "anything") is False


def test_is_correction_multilingual():
    assert text.is_correction("No, that's not what I asked") is True
    assert text.is_correction("Wrong. I said 2023, not 2022") is True
    assert text.is_correction("不对，我要的是中文") is True
    assert text.is_correction("Нет, неправильно") is True
    assert text.is_correction("Incorrecto, quiero otra cosa") is True
    assert text.is_correction("Non, ce n'est pas ça") is True
    assert text.is_correction("Thanks, now translate it") is False
    assert text.is_correction("Nobody knows") is False


def test_is_refusal_multilingual():
    assert text.is_refusal("I'm sorry, but I can't help with that.") is True
    assert text.is_refusal("As an AI language model, I cannot") is True
    assert text.is_refusal("很抱歉，我无法提供") is True
    assert text.is_refusal("Извините, я не могу") is True
    assert text.is_refusal("Sure! Here is the code:") is False


def test_pseudo_user_is_deterministic_16_hex_and_handles_none():
    a = text.pseudo_user("abc", "Mozilla/5.0", "en-US")
    b = text.pseudo_user("abc", "Mozilla/5.0", "en-US")
    c = text.pseudo_user("abc", "Mozilla/5.0", "fr-FR")
    assert a == b and a != c
    assert len(a) == 16 and int(a, 16) >= 0
    assert text.pseudo_user(None, None, None) == text.pseudo_user("", "", "")
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_text.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'loupe.text'`.

- [ ] **Step 3: Implement**

`loupe/text.py`:
```python
"""Pure text helpers used by adapters. No I/O."""
from __future__ import annotations

import hashlib
import re

REPEAT_THRESHOLD = 0.6

_WORD = re.compile(r"\w+", re.UNICODE)

# Start-of-turn correction patterns. Keep anchored (^) so "Nobody" does not match "No".
_CORRECTION = re.compile(
    r"^\s*(?:"
    r"no[,.!\s]|not (?:what|that)|wrong\b|that'?s (?:not|wrong)|i said\b|i meant\b|incorrect\b|"
    r"you didn'?t\b|you did not\b|try again\b|again[,.!\s]|"
    r"不对|不是|错了|不要|"
    r"нет[,.\s]|неправильно|не то\b|не так\b|я сказал|я просил|"
    r"incorrecto\b|no es eso|eso no\b|mal[,.!\s]|"
    r"non[,.!\s]|ce n'?est pas|c'?est faux|faux\b"
    r")",
    re.IGNORECASE,
)

_REFUSAL = re.compile(
    r"^\s*(?:"
    r"i'?m sorry|i am sorry|sorry,? (?:but )?i\b|i cannot\b|i can'?t\b|i can not\b|"
    r"i'?m unable|i am unable|as an ai\b|i'?m not able|i am not able|"
    r"unfortunately,? i (?:cannot|can'?t)|"
    r"很抱歉|对不起|抱歉|"
    r"извините|к сожалению,? я не могу"
    r")",
    re.IGNORECASE,
)


def tokens(s: str) -> set[str]:
    return {t.lower() for t in _WORD.findall(s or "")}


def jaccard(a: str, b: str) -> float:
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def is_repeat(prev_user: str | None, cur_user: str, threshold: float = REPEAT_THRESHOLD) -> bool:
    if prev_user is None:
        return False
    return jaccard(prev_user, cur_user) >= threshold


def is_correction(user_text: str) -> bool:
    return bool(_CORRECTION.search(user_text or ""))


def is_refusal(assistant_text: str) -> bool:
    return bool(_REFUSAL.search(assistant_text or ""))


def pseudo_user(hashed_ip: str | None, user_agent: str | None, accept_language: str | None) -> str:
    raw = f"{hashed_ip or ''}|{user_agent or ''}|{accept_language or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_text.py -q`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add loupe/text.py tests/test_text.py
git commit -m "Add pure text helpers: tokens, jaccard, correction/refusal patterns, pseudo-user hash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Schema and WildChat-shaped test fixture

**Files:**
- Create: `loupe/schema.py`, `tests/conftest.py`, `tests/test_schema.py`

**Interfaces:**
- Produces:
  - `loupe.schema.CONVERSATIONS: pyarrow.Schema` with fields (in order): `conv_id int64, model string, ts timestamp[us], date date32, week date32, country string, state string, language string, n_turns int32, pseudo_user string, redacted bool, has_empty_user_input bool, prompt_tokens int64 (nullable), completion_tokens int64 (nullable), first_user_len int32, last_assistant_len int32, repeated_request bool, correction_followup bool, assistant_refusal bool, one_and_done bool, intent_text string, shard string`
  - `loupe.schema.TURNS: pyarrow.Schema` with fields: `conv_id int64, idx int32, role string, language string, content_len int32, is_empty bool, redacted bool, repeats_prev_user bool, is_correction bool, is_refusal bool, shard string`
  - `loupe.schema.INTENT: pyarrow.Schema`: `conv_id int64, intent string, proba_max float32, shard string`
  - `tests/conftest.py` fixture `mini_shard_path` -> path to a parquet with 6 WildChat-shaped conversations (see Step 1 for exact contents). Fixture `con` -> in-memory `duckdb` connection.

- [ ] **Step 1: Write the schema test and fixture**

`tests/test_schema.py`:
```python
import pyarrow as pa
from loupe import schema


def test_conversations_schema_fields():
    names = schema.CONVERSATIONS.names
    assert names[:3] == ["conv_id", "model", "ts"]
    assert "intent_text" in names and "pseudo_user" in names
    assert schema.CONVERSATIONS.field("conv_id").type == pa.int64()
    assert schema.CONVERSATIONS.field("prompt_tokens").nullable


def test_turns_and_intent_schema_fields():
    assert schema.TURNS.names[:3] == ["conv_id", "idx", "role"]
    assert schema.INTENT.names == ["conv_id", "intent", "proba_max", "shard"]
```

`tests/conftest.py` (the fixture mirrors the real WildChat-4.8M nested layout, including a `usage` struct on assistant turns):
```python
from __future__ import annotations

import datetime as dt
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

FIXTURE_DIR = Path(__file__).parent / "fixtures"

_HEADER = pa.struct([("accept-language", pa.string()), ("user-agent", pa.string())])
_USAGE = pa.struct([("prompt_tokens", pa.int64()), ("completion_tokens", pa.int64()), ("total_tokens", pa.int64())])
_MSG = pa.struct([
    ("content", pa.string()),
    ("role", pa.string()),
    ("turn_identifier", pa.int64()),
    ("hashed_ip", pa.string()),
    ("country", pa.string()),
    ("state", pa.string()),
    ("language", pa.string()),
    ("toxic", pa.bool_()),
    ("redacted", pa.bool_()),
    ("timestamp", pa.timestamp("us")),
    ("header", _HEADER),
    ("usage", _USAGE),
])
SHARD_SCHEMA = pa.schema([
    ("conversation_hash", pa.string()),
    ("model", pa.string()),
    ("timestamp", pa.timestamp("us")),
    ("conversation", pa.list_(_MSG)),
    ("turn", pa.int64()),
    ("language", pa.string()),
    ("toxic", pa.bool_()),
    ("redacted", pa.bool_()),
    ("state", pa.string()),
    ("country", pa.string()),
    ("hashed_ip", pa.string()),
    ("header", _HEADER),
])


def _msg(content, role, tid, ip="ip1", country="United States", state="California", lang="English",
         redacted=False, ts=None, ua="Mozilla/5.0", al="en-US", usage=None):
    return {
        "content": content, "role": role, "turn_identifier": tid, "hashed_ip": ip if role == "user" else None,
        "country": country if role == "user" else None, "state": state if role == "user" else None,
        "language": lang, "toxic": False, "redacted": redacted,
        "timestamp": ts if role == "assistant" else None,
        "header": {"accept-language": al, "user-agent": ua},
        "usage": usage,
    }


def _conv(chash, model, ts, msgs, lang="English", country="United States", state="California",
          ip="ip1", ua="Mozilla/5.0", al="en-US", redacted=False):
    return {
        "conversation_hash": chash, "model": model, "timestamp": ts, "conversation": msgs,
        "turn": sum(1 for m in msgs if m["role"] == "user"), "language": lang, "toxic": False,
        "redacted": redacted, "state": state, "country": country, "hashed_ip": ip,
        "header": {"accept-language": al, "user-agent": ua},
    }


def build_mini_shard() -> list[dict]:
    t0 = dt.datetime(2024, 3, 4, 10, 0, 0)   # Monday
    t1 = dt.datetime(2024, 3, 11, 10, 0, 0)  # next Monday
    u = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
    return [
        # C1: 2 turns, coding, user repeats then corrects; assistant refuses second time. Has usage.
        _conv("h1", "gpt-4o", t0, [
            _msg("Write a python function that reverses a list", "user", 1001),
            _msg("Sure! Here is the code:\n```python\n...```", "assistant", 1002, ts=t0, usage=u),
            _msg("No, write a python function that reverses a list in place", "user", 1003),
            _msg("I'm sorry, but I can't help with that.", "assistant", 1004, ts=t0, usage=u),
        ]),
        # C2: 1 turn, short assistant reply -> one_and_done. Same pseudo-user as C1.
        _conv("h2", "gpt-4o", t0, [
            _msg("hi", "user", 2001),
            _msg("Hello! How can I help?", "assistant", 2002, ts=t0, usage=u),
        ]),
        # C3: empty user input -> has_empty_user_input. Different user (ip2).
        _conv("h3", "gpt-3.5-turbo", t0, [
            _msg("", "user", 3001, ip="ip2"),
            _msg("It seems you sent an empty message.", "assistant", 3002, ts=t0, usage=u),
        ], ip="ip2"),
        # C4: week 2, same pseudo-user as C1 (returns). Chinese, China. No usage (older shard style).
        _conv("h4", "gpt-4", t1, [
            _msg("请把这段话翻译成英文：你好世界", "user", 4001, lang="Chinese", country="China", state=None),
            _msg("Hello world", "assistant", 4002, ts=t1),
        ], lang="Chinese", country="China", state=None),
        # C5: week 2, new user ip3, 3 turns, no friction. Redacted PII.
        _conv("h5", "gpt-4o", t1, [
            _msg("Draft an email to my landlord about the heating", "user", 5001, ip="ip3", redacted=True),
            _msg("Subject: Heating issue ...", "assistant", 5002, ts=t1, usage=u),
            _msg("Make it more polite", "user", 5003, ip="ip3"),
            _msg("Subject: Kind request ...", "assistant", 5004, ts=t1, usage=u),
            _msg("Add a closing line", "user", 5005, ip="ip3"),
            _msg("Best regards, ...", "assistant", 5006, ts=t1, usage=u),
        ], ip="ip3", redacted=True),
        # C6: week 2, user ip2 returns from week 1. Long single-turn answer (not one_and_done).
        _conv("h6", "gpt-4o", t1, [
            _msg("Explain photosynthesis for a 10 year old", "user", 6001, ip="ip2"),
            _msg("x" * 500, "assistant", 6002, ts=t1, usage=u),
        ], ip="ip2"),
    ]


@pytest.fixture(scope="session")
def mini_shard_path() -> Path:
    FIXTURE_DIR.mkdir(exist_ok=True)
    path = FIXTURE_DIR / "mini_wildchat.parquet"
    table = pa.Table.from_pylist(build_mini_shard(), schema=SHARD_SCHEMA)
    pq.write_table(table, path)
    return path


@pytest.fixture
def con():
    c = duckdb.connect()
    yield c
    c.close()
```

Add to `.gitignore`: `tests/fixtures/*.parquet` (the fixture is regenerated on every run).

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_schema.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'loupe.schema'`.

- [ ] **Step 3: Implement schema**

`loupe/schema.py`:
```python
"""Arrow schemas for the Loupe tables. These are the contract between stages."""
import pyarrow as pa

CONVERSATIONS = pa.schema([
    pa.field("conv_id", pa.int64(), nullable=False),
    pa.field("model", pa.string()),
    pa.field("ts", pa.timestamp("us")),
    pa.field("date", pa.date32()),
    pa.field("week", pa.date32()),
    pa.field("country", pa.string()),
    pa.field("state", pa.string()),
    pa.field("language", pa.string()),
    pa.field("n_turns", pa.int32()),
    pa.field("pseudo_user", pa.string()),
    pa.field("redacted", pa.bool_()),
    pa.field("has_empty_user_input", pa.bool_()),
    pa.field("prompt_tokens", pa.int64(), nullable=True),
    pa.field("completion_tokens", pa.int64(), nullable=True),
    pa.field("first_user_len", pa.int32()),
    pa.field("last_assistant_len", pa.int32()),
    pa.field("repeated_request", pa.bool_()),
    pa.field("correction_followup", pa.bool_()),
    pa.field("assistant_refusal", pa.bool_()),
    pa.field("one_and_done", pa.bool_()),
    pa.field("intent_text", pa.string()),
    pa.field("shard", pa.string()),
])

TURNS = pa.schema([
    pa.field("conv_id", pa.int64(), nullable=False),
    pa.field("idx", pa.int32()),
    pa.field("role", pa.string()),
    pa.field("language", pa.string()),
    pa.field("content_len", pa.int32()),
    pa.field("is_empty", pa.bool_()),
    pa.field("redacted", pa.bool_()),
    pa.field("repeats_prev_user", pa.bool_()),
    pa.field("is_correction", pa.bool_()),
    pa.field("is_refusal", pa.bool_()),
    pa.field("shard", pa.string()),
])

INTENT = pa.schema([
    pa.field("conv_id", pa.int64(), nullable=False),
    pa.field("intent", pa.string()),
    pa.field("proba_max", pa.float32()),
    pa.field("shard", pa.string()),
])

ONE_AND_DONE_MAX_ASSISTANT_CHARS = 200
INTENT_TEXT_MAX_CHARS = 2000
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_schema.py -q`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add loupe/schema.py tests/conftest.py tests/test_schema.py .gitignore
git commit -m "Define Loupe Arrow schemas and a WildChat-shaped test fixture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: WildChat adapter (one shard to Loupe tables)

**Files:**
- Create: `loupe/adapters/wildchat.py`, `tests/test_wildchat_adapter.py`

**Interfaces:**
- Consumes: `loupe.text.*`, `loupe.schema.*`.
- Produces: `flatten_shard(path: str | Path, shard: str, con: duckdb.DuckDBPyConnection | None = None) -> tuple[pa.Table, pa.Table]` returning `(conversations, turns)` conforming to `schema.CONVERSATIONS` and `schema.TURNS`. `shard` is the label stored in the `shard` column (e.g. `train-00000-of-00086`).

- [ ] **Step 1: Write the failing tests**

`tests/test_wildchat_adapter.py`:
```python
import datetime as dt

import pyarrow as pa
from loupe import schema
from loupe.adapters.wildchat import flatten_shard


def _rows(table: pa.Table) -> dict[int, dict]:
    return {r["conv_id"]: r for r in table.to_pylist()}


def test_schemas_match(mini_shard_path):
    convs, turns = flatten_shard(mini_shard_path, "mini")
    assert convs.schema.equals(schema.CONVERSATIONS)
    assert turns.schema.equals(schema.TURNS)
    assert convs.num_rows == 6
    assert turns.num_rows == 4 + 2 + 2 + 2 + 6 + 2


def test_conv_id_is_first_turn_identifier_and_dates(mini_shard_path):
    c = _rows(flatten_shard(mini_shard_path, "mini")[0])
    assert set(c) == {1001, 2001, 3001, 4001, 5001, 6001}
    assert c[1001]["date"] == dt.date(2024, 3, 4)
    assert c[1001]["week"] == dt.date(2024, 3, 4)
    assert c[4001]["week"] == dt.date(2024, 3, 11)
    assert c[1001]["n_turns"] == 2 and c[5001]["n_turns"] == 3
    assert c[1001]["shard"] == "mini"


def test_pseudo_user_links_same_ip_and_header(mini_shard_path):
    c = _rows(flatten_shard(mini_shard_path, "mini")[0])
    assert c[1001]["pseudo_user"] == c[2001]["pseudo_user"] == c[4001]["pseudo_user"]
    assert c[3001]["pseudo_user"] == c[6001]["pseudo_user"]
    assert c[5001]["pseudo_user"] not in {c[1001]["pseudo_user"], c[3001]["pseudo_user"]}


def test_friction_flags(mini_shard_path):
    c = _rows(flatten_shard(mini_shard_path, "mini")[0])
    assert c[1001]["repeated_request"] is True
    assert c[1001]["correction_followup"] is True
    assert c[1001]["assistant_refusal"] is True
    assert c[1001]["one_and_done"] is False
    assert c[2001]["one_and_done"] is True
    assert c[6001]["one_and_done"] is False  # long answer
    assert c[5001]["repeated_request"] is False and c[5001]["correction_followup"] is False


def test_empty_input_tokens_redaction_and_intent_text(mini_shard_path):
    c = _rows(flatten_shard(mini_shard_path, "mini")[0])
    assert c[3001]["has_empty_user_input"] is True and c[1001]["has_empty_user_input"] is False
    assert c[1001]["prompt_tokens"] == 20 and c[1001]["completion_tokens"] == 40
    assert c[4001]["prompt_tokens"] is None
    assert c[5001]["redacted"] is True and c[1001]["redacted"] is False
    assert c[1001]["intent_text"].startswith("Write a python function")
    assert "in place" in c[1001]["intent_text"]
    assert c[1001]["first_user_len"] == len("Write a python function that reverses a list")
    assert c[6001]["last_assistant_len"] == 500
    assert c[4001]["country"] == "China" and c[4001]["state"] is None


def test_turn_rows(mini_shard_path):
    turns = flatten_shard(mini_shard_path, "mini")[1].to_pylist()
    c1 = sorted([t for t in turns if t["conv_id"] == 1001], key=lambda t: t["idx"])
    assert [t["role"] for t in c1] == ["user", "assistant", "user", "assistant"]
    assert c1[2]["repeats_prev_user"] is True and c1[2]["is_correction"] is True
    assert c1[3]["is_refusal"] is True and c1[1]["is_refusal"] is False
    assert c1[0]["content_len"] == len("Write a python function that reverses a list")
    c3 = [t for t in turns if t["conv_id"] == 3001 and t["role"] == "user"][0]
    assert c3["is_empty"] is True
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_wildchat_adapter.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'loupe.adapters.wildchat'`.

- [ ] **Step 3: Implement the adapter**

`loupe/adapters/wildchat.py`:
```python
"""WildChat shard -> Loupe conversations + turns tables.

Reads one parquet shard with DuckDB, unnests messages, then walks each
conversation once in Python to compute content-derived flags. Content is
never written out except the truncated, local-only `intent_text`.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import duckdb
import pyarrow as pa

from loupe import schema, text


def _q(path: str) -> str:
    """Quote a local path as a SQL string literal (DESCRIBE cannot take bound parameters)."""
    return "'" + path.replace("'", "''") + "'"


def _has_usage(con: duckdb.DuckDBPyConnection, path: str) -> bool:
    row = con.execute(
        f"DESCRIBE SELECT unnest(conversation) AS m FROM read_parquet({_q(path)}) LIMIT 1"
    ).fetchone()
    return row is not None and "usage" in str(row[1])


def _unnest_sql(path: str, has_usage: bool) -> str:
    usage_cols = (
        "struct_extract(m.usage, 'prompt_tokens') AS prompt_tokens, "
        "struct_extract(m.usage, 'completion_tokens') AS completion_tokens"
        if has_usage
        else "NULL::BIGINT AS prompt_tokens, NULL::BIGINT AS completion_tokens"
    )
    return f"""
    WITH c AS (
      SELECT row_number() OVER () AS rn, * FROM read_parquet({_q(path)})
    ), u AS (
      SELECT rn, model, timestamp AS ts, turn, language, country, state, hashed_ip, redacted,
             struct_extract(header, 'user-agent') AS ua,
             struct_extract(header, 'accept-language') AS al,
             unnest(conversation) AS m,
             unnest(generate_series(1, len(conversation))) AS idx
      FROM c
    )
    SELECT rn, model, ts, turn, language, country, state, hashed_ip, redacted, ua, al, idx,
           struct_extract(m, 'role') AS role,
           struct_extract(m, 'content') AS content,
           struct_extract(m, 'turn_identifier') AS tid,
           struct_extract(m, 'language') AS turn_language,
           struct_extract(m, 'redacted') AS turn_redacted,
           {usage_cols}
    FROM u
    ORDER BY rn, idx
    """


def _week_monday(ts: dt.datetime) -> dt.date:
    d = ts.date()
    return d - dt.timedelta(days=d.weekday())


def flatten_shard(path: str | Path, shard: str, con: duckdb.DuckDBPyConnection | None = None) -> tuple[pa.Table, pa.Table]:
    path = str(path)
    own = con is None
    con = con or duckdb.connect()
    try:
        rows = con.execute(_unnest_sql(path, _has_usage(con, path))).fetchall()
    finally:
        if own:
            con.close()

    conv_out: list[dict] = []
    turn_out: list[dict] = []

    i = 0
    n = len(rows)
    while i < n:
        rn = rows[i][0]
        j = i
        while j < n and rows[j][0] == rn:
            j += 1
        group = rows[i:j]
        i = j

        (_, model, ts, turn, language, country, state, hashed_ip, redacted, ua, al, *_rest) = group[0]
        conv_id = int(group[0][14])  # tid of first message
        prev_user: str | None = None
        user_texts: list[str] = []
        last_assistant_len = 0
        has_empty = False
        repeated = corrected = refused = False
        p_tok = c_tok = 0
        any_usage = False

        for r in group:
            idx, role, content, tid, turn_language, turn_redacted, pt, ct = r[11], r[12], r[13], r[14], r[15], r[16], r[17], r[18]
            content = content or ""
            is_empty = content.strip() == ""
            rep = corr = ref = False
            if role == "user":
                if is_empty:
                    has_empty = True
                rep = text.is_repeat(prev_user, content)
                corr = text.is_correction(content)
                repeated |= rep
                corrected |= corr
                prev_user = content
                user_texts.append(content)
            else:
                ref = text.is_refusal(content)
                refused |= ref
                last_assistant_len = len(content)
                if pt is not None or ct is not None:
                    any_usage = True
                    p_tok += int(pt or 0)
                    c_tok += int(ct or 0)
            turn_out.append({
                "conv_id": conv_id, "idx": int(idx), "role": role, "language": turn_language,
                "content_len": len(content), "is_empty": is_empty, "redacted": bool(turn_redacted),
                "repeats_prev_user": rep, "is_correction": corr, "is_refusal": ref, "shard": shard,
            })

        n_turns = int(turn)
        conv_out.append({
            "conv_id": conv_id, "model": model, "ts": ts, "date": ts.date(), "week": _week_monday(ts),
            "country": country, "state": state, "language": language, "n_turns": n_turns,
            "pseudo_user": text.pseudo_user(hashed_ip, ua, al), "redacted": bool(redacted),
            "has_empty_user_input": has_empty,
            "prompt_tokens": p_tok if any_usage else None,
            "completion_tokens": c_tok if any_usage else None,
            "first_user_len": len(user_texts[0]) if user_texts else 0,
            "last_assistant_len": last_assistant_len,
            "repeated_request": repeated, "correction_followup": corrected, "assistant_refusal": refused,
            "one_and_done": n_turns == 1 and last_assistant_len < schema.ONE_AND_DONE_MAX_ASSISTANT_CHARS,
            "intent_text": "\n".join(user_texts[:2])[: schema.INTENT_TEXT_MAX_CHARS],
            "shard": shard,
        })

    convs = pa.Table.from_pylist(conv_out, schema=schema.CONVERSATIONS)
    turns = pa.Table.from_pylist(turn_out, schema=schema.TURNS)
    return convs, turns
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_wildchat_adapter.py -q`
Expected: `6 passed`. If DuckDB reports a binder error on `struct_extract(m, 'usage')`, confirm `_has_usage` returned the right value by running `uv run python -c "import duckdb;print(duckdb.sql(\"DESCRIBE SELECT unnest(conversation) m FROM 'tests/fixtures/mini_wildchat.parquet'\"))"`.

- [ ] **Step 5: Commit**

```bash
git add loupe/adapters/wildchat.py tests/test_wildchat_adapter.py
git commit -m "Add WildChat adapter: unnest one shard into Loupe conversation and turn tables

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Hugging Face shard listing and download (`loupe/hf.py`) and stage 1 `flatten`

**Files:**
- Create: `loupe/hf.py`, `loupe/stages/flatten.py`, `tests/test_hf.py`, `tests/test_flatten_stage.py`

**Interfaces:**
- Produces:
  - `loupe.hf.DATASET = "allenai/WildChat-4.8M"`
  - `loupe.hf.list_shards() -> list[str]` shard file names sorted, e.g. `["train-00000-of-00086.parquet", ...]`.
  - `loupe.hf.download_shard(name: str, dest_dir: Path) -> Path` downloads `data/{name}` from the dataset repo with `huggingface_hub.hf_hub_download` into `dest_dir` (resumable, cached, retried by the library) and returns the local path.
  - `loupe.stages.flatten.run(shards: str = "all", raw_dir=Path("data/raw"), out_dir=Path("data/flat"), keep_raw=False, local_paths: list[Path] | None = None) -> list[str]` returns processed shard labels. Writes `out_dir/conversations/{label}.parquet` and `out_dir/turns/{label}.parquet`. Skips a shard whose two outputs already exist (idempotent, resumable). `shards` accepts `all`, `0-3`, or `0,5,7`.

- [ ] **Step 1: Write the failing tests**

`tests/test_hf.py`:
```python
from loupe import hf


def test_parse_shard_selection():
    names = [f"train-{i:05d}-of-00086.parquet" for i in range(86)]
    assert hf.select(names, "all") == names
    assert hf.select(names, "0-2") == names[:3]
    assert hf.select(names, "0,5,85") == [names[0], names[5], names[85]]


def test_shard_label():
    assert hf.label("train-00003-of-00086.parquet") == "train-00003-of-00086"
```

`tests/test_flatten_stage.py`:
```python
import pyarrow.parquet as pq
from loupe.stages import flatten


def test_flatten_local_writes_two_tables_and_is_idempotent(tmp_path, mini_shard_path):
    out = tmp_path / "flat"
    labels = flatten.run(local_paths=[mini_shard_path], out_dir=out)
    assert labels == ["mini_wildchat"]
    convs = pq.read_table(out / "conversations" / "mini_wildchat.parquet")
    turns = pq.read_table(out / "turns" / "mini_wildchat.parquet")
    assert convs.num_rows == 6 and turns.num_rows == 18
    # second run skips
    assert flatten.run(local_paths=[mini_shard_path], out_dir=out) == []
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_hf.py tests/test_flatten_stage.py -q`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`loupe/hf.py`:
```python
"""Hugging Face dataset access via huggingface_hub (listing, resumable download)."""
from __future__ import annotations

from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download

DATASET = "allenai/WildChat-4.8M"


def list_shards() -> list[str]:
    files = HfApi().list_repo_files(DATASET, repo_type="dataset")
    return sorted(f.rsplit("/", 1)[-1] for f in files if f.startswith("data/") and f.endswith(".parquet"))


def select(names: list[str], spec: str) -> list[str]:
    if spec == "all":
        return list(names)
    idx: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            idx.extend(range(int(a), int(b) + 1))
        elif part:
            idx.append(int(part))
    return [names[i] for i in idx]


def label(name: str) -> str:
    return Path(name).stem


def download_shard(name: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    # hf_hub_download preserves the repo path, so the file lands at dest_dir/data/<name>
    path = hf_hub_download(repo_id=DATASET, repo_type="dataset", filename=f"data/{name}", local_dir=str(dest_dir))
    return Path(path)
```

`loupe/stages/flatten.py`:
```python
"""Stage 1: shards -> data/flat/{conversations,turns}/<label>.parquet"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pyarrow.parquet as pq

from loupe import hf
from loupe.adapters.wildchat import flatten_shard


def _outputs(out_dir: Path, lab: str) -> tuple[Path, Path]:
    return out_dir / "conversations" / f"{lab}.parquet", out_dir / "turns" / f"{lab}.parquet"


def _process(path: Path, lab: str, out_dir: Path) -> None:
    c_path, t_path = _outputs(out_dir, lab)
    c_path.parent.mkdir(parents=True, exist_ok=True)
    t_path.parent.mkdir(parents=True, exist_ok=True)
    convs, turns = flatten_shard(path, lab)
    pq.write_table(convs, c_path, compression="zstd")
    pq.write_table(turns, t_path, compression="zstd")


def run(shards: str = "all", raw_dir: Path = Path("data/raw"), out_dir: Path = Path("data/flat"),
        keep_raw: bool = False, local_paths: list[Path] | None = None) -> list[str]:
    done: list[str] = []
    if local_paths is not None:
        for p in local_paths:
            lab = hf.label(p.name)
            if all(x.exists() for x in _outputs(out_dir, lab)):
                continue
            _process(Path(p), lab, out_dir)
            done.append(lab)
        return done

    names = hf.select(hf.list_shards(), shards)
    for k, name in enumerate(names, 1):
        lab = hf.label(name)
        if all(x.exists() for x in _outputs(out_dir, lab)):
            print(f"[{k}/{len(names)}] {lab} exists, skip", file=sys.stderr)
            continue
        t = time.time()
        path = hf.download_shard(name, raw_dir)
        _process(path, lab, out_dir)
        if not keep_raw:
            path.unlink(missing_ok=True)
        print(f"[{k}/{len(names)}] {lab} done in {time.time() - t:.0f}s", file=sys.stderr)
        done.append(lab)
    return done
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_hf.py tests/test_flatten_stage.py -q`
Expected: `3 passed`.

- [ ] **Step 5: Live check on one real shard (network)**

Run: `uv run python -c "from pathlib import Path; from loupe.stages import flatten; print(flatten.run('0', keep_raw=True))"` (first call may print a one-time huggingface_hub notice about symlinks; it is harmless)
Expected: prints `['train-00000-of-00086']` within a few minutes; `data/flat/conversations/train-00000-of-00086.parquet` exists. Then:
`uv run python -c "import duckdb; print(duckdb.sql(\"SELECT count(*), min(date), max(date), count(DISTINCT pseudo_user) FROM 'data/flat/conversations/*.parquet'\"))"`
Expected: a count around 37,000 and a date range inside 2023-04 to 2025-07. Record the wall-clock time in the commit message body; it sizes the full run.

- [ ] **Step 6: Commit**

```bash
git add loupe/hf.py loupe/stages/flatten.py tests/test_hf.py tests/test_flatten_stage.py
git commit -m "Add HF shard download and flatten stage (resumable, one shard on disk at a time)

Shard 0 flattened in <N>s on the laptop.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Stage 2 `sample` (stratified intent sample)

**Files:**
- Create: `loupe/stages/sample.py`, `tests/test_sample.py`

**Interfaces:**
- Consumes: `data/flat/conversations/*.parquet`.
- Produces: `loupe.stages.sample.run(n: int = 20000, flat_dir=Path("data/flat"), out_path=Path("samples/intent_sample.parquet"), seed: int = 7, min_per_stratum: int = 20) -> int` writes a parquet with columns `conv_id, model_family, lang_bucket, quarter, intent_text` and returns row count. Strata: `lang_bucket` = language if in top 8 languages by count else `other`; `model_family` = model with trailing version tokens collapsed by `loupe.stages.sample.model_family()`; `quarter` = `date_trunc('quarter', ts)`. Excludes `has_empty_user_input` and `length(intent_text) < 5`. Allocation is proportional to stratum size with a floor of `min_per_stratum` (capped at stratum size).
- `model_family(model: str) -> str`: `gpt-4o-2024-05-13 -> gpt-4o`, `gpt-4-0125-preview -> gpt-4`, `gpt-3.5-turbo-0613 -> gpt-3.5-turbo`, `o1-mini-2024-09-12 -> o1-mini`, `gpt-4.1-mini-2025-04-14 -> gpt-4.1-mini`.

- [ ] **Step 1: Write the failing tests**

`tests/test_sample.py`:
```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_sample.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'loupe.stages.sample'`.

- [ ] **Step 3: Implement**

`loupe/stages/sample.py`:
```python
"""Stage 2: stratified sample of conversations for intent labeling."""
from __future__ import annotations

import re
from pathlib import Path

import duckdb

_VERSION_SUFFIX = re.compile(r"-(\d{4}-\d{2}-\d{2}|\d{4}|preview|\d{4}-preview)$")


def model_family(model: str) -> str:
    m = model or ""
    prev = None
    while prev != m:
        prev, m = m, _VERSION_SUFFIX.sub("", m)
    return m


def run(n: int = 20000, flat_dir: Path = Path("data/flat"), out_path: Path = Path("samples/intent_sample.parquet"),
        seed: int = 7, min_per_stratum: int = 20) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.create_function("model_family", model_family, [str], str)
    con.execute(f"SELECT setseed({(seed % 1000) / 1000.0})")
    con.execute(f"""
      CREATE TEMP TABLE base AS
      SELECT conv_id, model_family(model) AS model_family, language, date_trunc('quarter', ts)::DATE AS quarter, intent_text
      FROM read_parquet('{flat_dir}/conversations/*.parquet')
      WHERE NOT has_empty_user_input AND length(intent_text) >= 5
    """)
    con.execute("""
      CREATE TEMP TABLE top_lang AS
      SELECT language FROM base GROUP BY language ORDER BY count(*) DESC LIMIT 8
    """)
    con.execute("""
      CREATE TEMP TABLE strat AS
      SELECT b.*, CASE WHEN t.language IS NULL THEN 'other' ELSE b.language END AS lang_bucket
      FROM base b LEFT JOIN top_lang t USING (language)
    """)
    sizes = con.execute("""
      SELECT model_family, lang_bucket, quarter, count(*) AS c FROM strat GROUP BY ALL
    """).fetchall()
    total = sum(r[3] for r in sizes) or 1
    alloc = {}
    for mf, lb, q, c in sizes:
        want = max(min_per_stratum, round(n * c / total))
        alloc[(mf, lb, q)] = min(want, c)
    # trim proportionally if floors pushed us over n
    over = sum(alloc.values()) - n
    if over > 0:
        for key in sorted(alloc, key=lambda k: -alloc[k]):
            if over <= 0:
                break
            cut = min(over, max(0, alloc[key] - min_per_stratum))
            alloc[key] -= cut
            over -= cut
    con.execute("CREATE TEMP TABLE alloc (model_family VARCHAR, lang_bucket VARCHAR, quarter DATE, k INTEGER)")
    con.executemany("INSERT INTO alloc VALUES (?, ?, ?, ?)", [(k[0], k[1], k[2], v) for k, v in alloc.items()])
    con.execute(f"""
      COPY (
        SELECT conv_id, model_family, lang_bucket, quarter, intent_text
        FROM (
          SELECT s.*, row_number() OVER (PARTITION BY s.model_family, s.lang_bucket, s.quarter ORDER BY random()) AS rn, a.k
          FROM strat s JOIN alloc a USING (model_family, lang_bucket, quarter)
        ) WHERE rn <= k
      ) TO '{out_path}' (FORMAT PARQUET)
    """)
    count = con.execute(f"SELECT count(*) FROM read_parquet('{out_path}')").fetchone()[0]
    con.close()
    return int(count)
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_sample.py -q`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add loupe/stages/sample.py tests/test_sample.py
git commit -m "Add sample stage: stratified intent sample by model family, language, quarter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Stage 3a `label` (Anthropic Message Batches with budget cap)

**Files:**
- Create: `loupe/taxonomy.json`, `loupe/stages/label.py`, `tests/test_label_budget.py`

**Interfaces:**
- Consumes: `samples/intent_sample.parquet` (from Task 6).
- Produces:
  - `loupe/taxonomy.json`: `{"version": "v1", "classes": [{"name": "coding", "definition": "..."}, ...]}` 10 classes in the order given in Global Constraints.
  - `loupe.stages.label.PRICES: dict[str, tuple[float, float]]` USD per 1M input/output tokens at standard rate: `{"claude-opus-5": (5.0, 25.0), "claude-sonnet-5": (2.0, 10.0), "claude-haiku-4-5": (1.0, 5.0)}`.
  - `estimate_cost_usd(model: str, n_requests: int, avg_input_tokens: float, avg_output_tokens: float = 30.0, batch_discount: float = 0.5) -> float`
  - `build_request(conv_id: int, intent_text: str, model: str, system_blocks: list[dict]) -> Request`
  - `run(sample_path=Path("samples/intent_sample.parquet"), out_path=Path("samples/intent_labels.parquet"), model: str | None = None, budget_usd: float | None = None, poll_seconds: int = 60, dry_run: bool = False) -> dict` returns `{"n": ..., "estimated_usd": ..., "batch_id": ..., "labeled": ...}`. Writes `samples/intent_labels.parquet` with `conv_id, intent, confidence` and `data/label_run.json` with the estimate, actual `usage` totals, model, batch id, timestamps.
- Model default: `os.environ.get("LOUPE_LABEL_MODEL", "claude-opus-5")`. Budget default: `float(os.environ.get("LOUPE_LABEL_BUDGET_USD", "60"))`.

- [ ] **Step 1: Write taxonomy and the failing tests**

`loupe/taxonomy.json`:
```json
{
  "version": "v1",
  "classes": [
    {"name": "coding", "definition": "Writing, fixing, explaining, or converting code, scripts, SQL, configs, or software errors."},
    {"name": "writing_editing", "definition": "Drafting, rewriting, summarizing, or proofreading non-fiction text: emails, essays, posts, letters, reports."},
    {"name": "creative_roleplay", "definition": "Fiction, poems, stories, character roleplay, dialogue, or interactive scenarios."},
    {"name": "image_prompting", "definition": "Generating or refining prompts for image models such as Midjourney or Stable Diffusion, or describing images to generate."},
    {"name": "homework_study", "definition": "School or exam questions, worked problems, definitions to study, or explanations of academic concepts for learning."},
    {"name": "information_seeking", "definition": "Factual questions, recommendations, comparisons, how-to or general knowledge not tied to schoolwork."},
    {"name": "translation", "definition": "Translating text between languages, or asking about grammar, vocabulary, or usage in another language."},
    {"name": "business_professional", "definition": "Marketing copy, product descriptions, business plans, analysis, resumes, job applications, or workplace tasks."},
    {"name": "personal_advice", "definition": "Advice about relationships, health, mental wellbeing, finances, or life decisions for the person asking."},
    {"name": "other", "definition": "Anything else: greetings, tests of the assistant, gibberish, or requests that fit no class above."}
  ]
}
```

`tests/test_label_budget.py`:
```python
import json
from pathlib import Path

import pytest
from loupe.stages import label


def test_taxonomy_has_ten_named_classes():
    tax = json.loads(Path("loupe/taxonomy.json").read_text())
    names = [c["name"] for c in tax["classes"]]
    assert len(names) == 10 and names[0] == "coding" and names[-1] == "other"
    assert label.class_names() == names


def test_estimate_cost_applies_batch_discount():
    # 20k requests, 800 in / 30 out tokens, opus-5 standard $5/$25 per 1M, batch 50%
    est = label.estimate_cost_usd("claude-opus-5", 20000, 800.0, 30.0)
    assert round(est, 2) == round(0.5 * (20000 * 800 * 5 / 1e6 + 20000 * 30 * 25 / 1e6), 2)


def test_estimate_unknown_model_raises():
    with pytest.raises(KeyError):
        label.estimate_cost_usd("gpt-4o", 1, 1.0)


def test_build_request_shape():
    req = label.build_request(1001, "Write a python function", "claude-opus-5", label.system_blocks())
    assert req["custom_id"] == "1001"
    params = req["params"]
    assert params["model"] == "claude-opus-5"
    assert params["max_tokens"] == 64
    schema = params["output_config"]["format"]["schema"]
    assert schema["properties"]["intent"]["enum"] == label.class_names()
    assert params["messages"][0]["content"].endswith("Write a python function")


def test_budget_guard_blocks_over_cap(monkeypatch):
    with pytest.raises(label.BudgetExceeded):
        label.check_budget(estimated_usd=61.0, budget_usd=60.0)
    label.check_budget(estimated_usd=59.0, budget_usd=60.0)
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_label_budget.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'loupe.stages.label'`.

- [ ] **Step 3: Implement**

`loupe/stages/label.py`:
```python
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
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_label_budget.py -q`
Expected: `5 passed`.

- [ ] **Step 5: Dry run against the API (network, no batch submitted)**

Precondition: `ant auth status` shows an active credential, or `ANTHROPIC_API_KEY` is exported. Sample from Task 6 exists (run `make sample` on the shards flattened so far; for a first check use `uv run loupe sample --n 200`).
Run: `uv run python -c "from loupe.stages import label; print(label.run(dry_run=True))"`
Expected: prints a JSON with `estimated_usd` and no `batch_id`. Note the `avg_input_tokens`; with the taxonomy system prompt expect roughly 500 to 900. Cost at 20,000 requests on `claude-opus-5` is then about $45 to $65 at batch rate; on `claude-haiku-4-5` about $9 to $13. Record the estimate in the PRD decision log (Plan 3) and set the cap before the real run.

- [ ] **Step 6: Commit**

```bash
git add loupe/taxonomy.json loupe/stages/label.py tests/test_label_budget.py
git commit -m "Add label stage: batch intent labeling with structured output and a budget cap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Stage 3b `classify` (extend labels to all conversations)

**Files:**
- Create: `loupe/stages/classify.py`, `tests/test_classify.py`

**Interfaces:**
- Consumes: `samples/intent_labels.parquet` (`conv_id, intent, confidence`), `data/flat/conversations/*.parquet` (`conv_id, intent_text, shard, has_empty_user_input`).
- Produces:
  - `train(texts: list[str], labels: list[str], seed: int = 7) -> tuple[Pipeline, dict]` returns a fitted sklearn `Pipeline` (`TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=2, max_features=400_000, sublinear_tf=True)` + `LogisticRegression(max_iter=2000, C=4.0)`) and a report dict `{"n_train", "n_test", "accuracy", "macro_f1", "per_class": {name: {"precision", "recall", "f1", "support"}}, "confusion": [[...]], "classes": [...]}` from a stratified 80/20 split.
  - `run(labels_path=Path("samples/intent_labels.parquet"), flat_dir=Path("data/flat"), out_dir=Path("data/flat/intent"), model_path=Path("data/models/intent.joblib"), report_path=Path("aggregates/intent_classifier_report.json"), threshold: float = 0.85, force: bool = False) -> dict`. Writes the report, saves the model, and unless accuracy < threshold (and not `force`) predicts every conversation shard into `out_dir/{shard}.parquet` with schema `schema.INTENT`. Empty-input conversations get `intent = NULL`. Returns the report with `"predicted": bool`.
  - Exit code contract for CLI: returns 2 when below threshold and not forced.

- [ ] **Step 1: Write the failing tests**

`tests/test_classify.py`:
```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_classify.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'loupe.stages.classify'`.

- [ ] **Step 3: Implement**

`loupe/stages/classify.py`:
```python
"""Stage 3b: train a char n-gram classifier on LLM labels; predict intent for every conversation."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb
import joblib
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

from loupe import schema


def _pipeline() -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=2, max_features=400_000, sublinear_tf=True)),
        ("clf", LogisticRegression(max_iter=2000, C=4.0)),
    ])


def train(texts: list[str], labels: list[str], seed: int = 7) -> tuple[Pipeline, dict]:
    x_tr, x_te, y_tr, y_te = train_test_split(texts, labels, test_size=0.2, random_state=seed, stratify=labels)
    model = _pipeline().fit(x_tr, y_tr)
    pred = model.predict(x_te)
    classes = sorted(set(labels))
    rep = classification_report(y_te, pred, labels=classes, output_dict=True, zero_division=0)
    report = {
        "n_train": len(x_tr), "n_test": len(x_te),
        "accuracy": float(accuracy_score(y_te, pred)),
        "macro_f1": float(f1_score(y_te, pred, average="macro", labels=classes, zero_division=0)),
        "classes": classes,
        "per_class": {c: {k: float(v) if k != "support" else int(v) for k, v in rep[c].items()} for c in classes},
        "confusion": confusion_matrix(y_te, pred, labels=classes).tolist(),
    }
    return model, report


def run(labels_path: Path = Path("samples/intent_labels.parquet"), flat_dir: Path = Path("data/flat"),
        out_dir: Path = Path("data/flat/intent"), model_path: Path = Path("data/models/intent.joblib"),
        report_path: Path = Path("aggregates/intent_classifier_report.json"), threshold: float = 0.85,
        force: bool = False, extra_training: tuple[list[str], list[str]] | None = None) -> dict:
    con = duckdb.connect()
    rows = con.execute(f"""
      SELECT l.conv_id, c.intent_text, l.intent
      FROM read_parquet('{labels_path}') l JOIN read_parquet('{flat_dir}/conversations/*.parquet') c USING (conv_id)
    """).fetchall()
    texts = [r[1] for r in rows]
    labels = [r[2] for r in rows]
    if extra_training:  # test hook only
        texts += extra_training[0]
        labels += extra_training[1]
    model, report = train(texts, labels)
    report["threshold"] = threshold
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2))
    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, model_path)
    print(f"held-out accuracy {report['accuracy']:.3f}, macro F1 {report['macro_f1']:.3f} (threshold {threshold})", file=sys.stderr)

    if report["accuracy"] < threshold and not force:
        report["predicted"] = False
        print("below threshold; not predicting. Use --force to override (marks coverage as sample_only).", file=sys.stderr)
        return report

    out_dir.mkdir(parents=True, exist_ok=True)
    shards = [r[0] for r in con.execute(f"SELECT DISTINCT shard FROM read_parquet('{flat_dir}/conversations/*.parquet') ORDER BY 1").fetchall()]
    for shard in shards:
        data = con.execute(f"""
          SELECT conv_id, intent_text, has_empty_user_input FROM read_parquet('{flat_dir}/conversations/{shard}.parquet')
        """).fetchall()
        ids = [d[0] for d in data]
        mask = np.array([not d[2] and len(d[1] or "") >= 5 for d in data])
        intents: list[str | None] = [None] * len(data)
        probas = np.zeros(len(data), dtype=np.float32)
        if mask.any():
            xs = [data[i][1] for i in np.flatnonzero(mask)]
            proba = model.predict_proba(xs)
            pred = model.classes_[proba.argmax(axis=1)]
            for k, i in enumerate(np.flatnonzero(mask)):
                intents[i] = str(pred[k])
                probas[i] = float(proba[k].max())
        table = pa.Table.from_pydict({"conv_id": ids, "intent": intents, "proba_max": probas.tolist(),
                                      "shard": [shard] * len(ids)}, schema=schema.INTENT)
        pq.write_table(table, out_dir / f"{shard}.parquet", compression="zstd")
    report["predicted"] = True
    report["forced"] = bool(force and report["accuracy"] < threshold)
    report_path.write_text(json.dumps(report, indent=2))
    con.close()
    return report
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_classify.py -q`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add loupe/stages/classify.py tests/test_classify.py
git commit -m "Add classify stage: char n-gram intent model with held-out report and threshold gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Metric SQL files and stage 4 `metrics`

**Files:**
- Create: `loupe/metrics/volume_daily_model.sql`, `loupe/metrics/volume_weekly_country.sql`, `loupe/metrics/volume_weekly_language.sql`, `loupe/metrics/intensity_weekly.sql`, `loupe/metrics/depth_by_model.sql`, `loupe/metrics/intent_weekly.sql`, `loupe/metrics/intent_by_model.sql`, `loupe/metrics/intent_by_language.sql`, `loupe/metrics/friction_by_intent_model.sql`, `loupe/metrics/friction_weekly.sql`, `loupe/metrics/data_quality_weekly.sql`, `loupe/stages/metrics.py`, tests listed below.

**Interfaces:**
- Consumes: DuckDB views `conversations` (schema `CONVERSATIONS`) and `intent` (schema `INTENT`). Template variable `{{min_cell}}` is substituted before execution.
- Produces: `loupe.stages.metrics.METRICS: list[str]` (file stems in the order above); `run_sql(con, name: str, min_cell: int = 20) -> pyarrow.Table`; `run(flat_dir=Path("data/flat"), out_dir=Path("aggregates"), min_cell: int = 20) -> dict` writes `out_dir/{name}.parquet` for each metric and `out_dir/meta.json`, returns meta. Also `register(con, flat_dir)` that creates the two views (and an empty `intent` view if `data/flat/intent/` has no files).

Metric definitions (each is the content of the file named):

`volume_daily_model.sql`
```sql
SELECT date, model, count(*) AS conversations, sum(n_turns) AS turns,
       sum(prompt_tokens) AS prompt_tokens, sum(completion_tokens) AS completion_tokens,
       count(prompt_tokens) AS conversations_with_tokens
FROM conversations
GROUP BY ALL ORDER BY date, model
```

`volume_weekly_country.sql`
```sql
SELECT week, country, count(*) AS conversations, count(DISTINCT pseudo_user) AS pseudo_users
FROM conversations WHERE country IS NOT NULL
GROUP BY ALL HAVING count(*) >= {{min_cell}} ORDER BY week, conversations DESC
```

`volume_weekly_language.sql`
```sql
SELECT week, language, count(*) AS conversations
FROM conversations WHERE language IS NOT NULL
GROUP BY ALL HAVING count(*) >= {{min_cell}} ORDER BY week, conversations DESC
```

`intensity_weekly.sql`
```sql
WITH per_user AS (
  SELECT week, pseudo_user, count(*) AS convs FROM conversations GROUP BY ALL
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY week ORDER BY convs DESC) AS rk,
         count(*) OVER (PARTITION BY week) AS users_in_week,
         sum(convs) OVER (PARTITION BY week) AS convs_in_week
  FROM per_user
), top10 AS (
  SELECT week, sum(convs)::DOUBLE / max(convs_in_week) AS top10_share
  FROM ranked WHERE rk <= greatest(1, ceil(users_in_week * 0.10)) GROUP BY week
), weekly AS (
  SELECT week, count(*) AS pseudo_users, sum(convs) AS conversations,
         quantile_cont(convs, 0.5) AS convs_per_user_p50, quantile_cont(convs, 0.9) AS convs_per_user_p90
  FROM per_user GROUP BY week
), returning AS (
  SELECT a.week, count(DISTINCT b.pseudo_user)::DOUBLE / count(DISTINCT a.pseudo_user) AS return_rate
  FROM per_user a LEFT JOIN per_user b ON b.pseudo_user = a.pseudo_user AND b.week = a.week + INTERVAL 7 DAY
  GROUP BY a.week
)
SELECT w.week, w.pseudo_users, w.conversations, w.convs_per_user_p50, w.convs_per_user_p90, t.top10_share, r.return_rate
FROM weekly w JOIN top10 t USING (week) JOIN returning r USING (week)
ORDER BY w.week
```

`depth_by_model.sql`
```sql
SELECT model,
       CASE WHEN n_turns = 1 THEN '1' WHEN n_turns = 2 THEN '2' WHEN n_turns <= 5 THEN '3-5'
            WHEN n_turns <= 10 THEN '6-10' ELSE '11+' END AS depth_bucket,
       count(*) AS conversations, median(n_turns) AS median_turns
FROM conversations GROUP BY ALL ORDER BY model, depth_bucket
```

`intent_weekly.sql`
```sql
SELECT c.week, i.intent, count(*) AS conversations
FROM conversations c JOIN intent i USING (conv_id) WHERE i.intent IS NOT NULL
GROUP BY ALL ORDER BY c.week, conversations DESC
```

`intent_by_model.sql`
```sql
SELECT c.model, i.intent, count(*) AS conversations
FROM conversations c JOIN intent i USING (conv_id) WHERE i.intent IS NOT NULL
GROUP BY ALL ORDER BY c.model, conversations DESC
```

`intent_by_language.sql`
```sql
WITH top_lang AS (SELECT language FROM conversations GROUP BY language ORDER BY count(*) DESC LIMIT 10)
SELECT c.language, i.intent, count(*) AS conversations
FROM conversations c JOIN intent i USING (conv_id) JOIN top_lang USING (language)
WHERE i.intent IS NOT NULL
GROUP BY ALL HAVING count(*) >= {{min_cell}} ORDER BY c.language, conversations DESC
```

`friction_by_intent_model.sql`
```sql
SELECT i.intent, c.model, count(*) AS conversations,
       avg(c.repeated_request::INT) AS repeat_rate,
       avg(c.one_and_done::INT) AS one_and_done_rate,
       avg(c.correction_followup::INT) AS correction_rate,
       avg(c.assistant_refusal::INT) AS refusal_rate
FROM conversations c JOIN intent i USING (conv_id)
WHERE NOT c.has_empty_user_input AND i.intent IS NOT NULL
GROUP BY ALL HAVING count(*) >= {{min_cell}} ORDER BY i.intent, c.model
```

`friction_weekly.sql`
```sql
SELECT week, count(*) AS conversations,
       avg(repeated_request::INT) AS repeat_rate, avg(one_and_done::INT) AS one_and_done_rate,
       avg(correction_followup::INT) AS correction_rate, avg(assistant_refusal::INT) AS refusal_rate
FROM conversations WHERE NOT has_empty_user_input
GROUP BY week ORDER BY week
```

`data_quality_weekly.sql`
```sql
SELECT week, count(*) AS conversations,
       avg(redacted::INT) AS redacted_rate,
       avg(has_empty_user_input::INT) AS empty_input_rate,
       avg((prompt_tokens IS NOT NULL)::INT) AS token_usage_coverage
FROM conversations GROUP BY week ORDER BY week
```

- [ ] **Step 1: Write the failing tests**

`tests/test_metrics_volume.py`:
```python
import datetime as dt

from loupe.stages import metrics
from loupe.stages import flatten


def _register(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    metrics.register(con, flat)


def test_volume_daily_model(con, tmp_path, mini_shard_path):
    _register(con, tmp_path, mini_shard_path)
    rows = {(r["date"], r["model"]): r for r in metrics.run_sql(con, "volume_daily_model").to_pylist()}
    r = rows[(dt.date(2024, 3, 4), "gpt-4o")]
    assert r["conversations"] == 2 and r["turns"] == 3
    assert r["prompt_tokens"] == 30 and r["completion_tokens"] == 60 and r["conversations_with_tokens"] == 2
    assert rows[(dt.date(2024, 3, 11), "gpt-4")]["prompt_tokens"] is None


def test_volume_weekly_country_suppresses_small_cells(con, tmp_path, mini_shard_path):
    _register(con, tmp_path, mini_shard_path)
    assert metrics.run_sql(con, "volume_weekly_country", min_cell=20).num_rows == 0
    rows = metrics.run_sql(con, "volume_weekly_country", min_cell=1).to_pylist()
    us_w1 = [r for r in rows if r["country"] == "United States" and r["week"] == dt.date(2024, 3, 4)][0]
    assert us_w1["conversations"] == 3 and us_w1["pseudo_users"] == 2


def test_volume_weekly_language(con, tmp_path, mini_shard_path):
    _register(con, tmp_path, mini_shard_path)
    rows = metrics.run_sql(con, "volume_weekly_language", min_cell=1).to_pylist()
    zh = [r for r in rows if r["language"] == "Chinese"][0]
    assert zh["conversations"] == 1 and zh["week"] == dt.date(2024, 3, 11)
```

`tests/test_metrics_intensity.py`:
```python
import datetime as dt

from loupe.stages import metrics, flatten


def test_intensity_weekly(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    metrics.register(con, flat)
    rows = {r["week"]: r for r in metrics.run_sql(con, "intensity_weekly").to_pylist()}
    w1, w2 = rows[dt.date(2024, 3, 4)], rows[dt.date(2024, 3, 11)]
    # week 1: users U1 (C1, C2), U2 (C3) -> 2 users, 3 convs; both return in week 2 -> return_rate 1.0
    assert w1["pseudo_users"] == 2 and w1["conversations"] == 3
    assert w1["return_rate"] == 1.0
    assert w1["convs_per_user_p50"] == 1.5 and w1["convs_per_user_p90"] == 1.9
    # top 10% of 2 users -> ceil(0.2)=1 user -> U1 with 2 of 3 convs
    assert abs(w1["top10_share"] - 2 / 3) < 1e-9
    # week 2: U1 (C4), U3 (C5), U2 (C6) -> 3 users, none return (no week 3) -> 0.0
    assert w2["pseudo_users"] == 3 and w2["conversations"] == 3 and w2["return_rate"] == 0.0
```

`tests/test_metrics_depth_intent.py`:
```python
import pyarrow as pa
from loupe import schema
from loupe.stages import metrics, flatten


def _with_intent(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    metrics.register(con, flat)
    intent = pa.Table.from_pylist([
        {"conv_id": 1001, "intent": "coding", "proba_max": 0.9, "shard": "mini"},
        {"conv_id": 2001, "intent": "other", "proba_max": 0.5, "shard": "mini"},
        {"conv_id": 3001, "intent": None, "proba_max": 0.0, "shard": "mini"},
        {"conv_id": 4001, "intent": "translation", "proba_max": 0.9, "shard": "mini"},
        {"conv_id": 5001, "intent": "writing_editing", "proba_max": 0.8, "shard": "mini"},
        {"conv_id": 6001, "intent": "homework_study", "proba_max": 0.7, "shard": "mini"},
    ], schema=schema.INTENT)
    con.register("intent_src", intent)
    con.execute("CREATE OR REPLACE VIEW intent AS SELECT * FROM intent_src")


def test_depth_by_model(con, tmp_path, mini_shard_path):
    _with_intent(con, tmp_path, mini_shard_path)
    rows = {(r["model"], r["depth_bucket"]): r["conversations"] for r in metrics.run_sql(con, "depth_by_model").to_pylist()}
    assert rows[("gpt-4o", "1")] == 2 and rows[("gpt-4o", "2")] == 1 and rows[("gpt-4o", "3-5")] == 1
    assert rows[("gpt-3.5-turbo", "1")] == 1 and rows[("gpt-4", "1")] == 1


def test_intent_weekly_and_by_model_skip_null(con, tmp_path, mini_shard_path):
    _with_intent(con, tmp_path, mini_shard_path)
    weekly = metrics.run_sql(con, "intent_weekly").to_pylist()
    assert sum(r["conversations"] for r in weekly) == 5   # 3001 has NULL intent
    by_model = {(r["model"], r["intent"]): r["conversations"] for r in metrics.run_sql(con, "intent_by_model").to_pylist()}
    assert by_model[("gpt-4o", "coding")] == 1 and by_model[("gpt-4", "translation")] == 1


def test_intent_by_language_min_cell(con, tmp_path, mini_shard_path):
    _with_intent(con, tmp_path, mini_shard_path)
    assert metrics.run_sql(con, "intent_by_language", min_cell=2).num_rows == 0
    rows = metrics.run_sql(con, "intent_by_language", min_cell=1).to_pylist()
    assert {(r["language"], r["intent"]) for r in rows} >= {("English", "coding"), ("Chinese", "translation")}
```

`tests/test_metrics_friction_quality.py`:
```python
import datetime as dt

import pyarrow as pa
from loupe import schema
from loupe.stages import metrics, flatten


def _setup(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    metrics.register(con, flat)
    intent = pa.Table.from_pylist([
        {"conv_id": 1001, "intent": "coding", "proba_max": 0.9, "shard": "mini"},
        {"conv_id": 2001, "intent": "coding", "proba_max": 0.5, "shard": "mini"},
        {"conv_id": 6001, "intent": "coding", "proba_max": 0.7, "shard": "mini"},
    ], schema=schema.INTENT)
    con.register("intent_src", intent)
    con.execute("CREATE OR REPLACE VIEW intent AS SELECT * FROM intent_src")


def test_friction_by_intent_model(con, tmp_path, mini_shard_path):
    _setup(con, tmp_path, mini_shard_path)
    rows = metrics.run_sql(con, "friction_by_intent_model", min_cell=1).to_pylist()
    r = [x for x in rows if x["intent"] == "coding" and x["model"] == "gpt-4o"][0]
    # C1 (repeat, correction, refusal), C2 (one_and_done), C6 (none)
    assert r["conversations"] == 3
    assert abs(r["repeat_rate"] - 1 / 3) < 1e-9 and abs(r["correction_rate"] - 1 / 3) < 1e-9
    assert abs(r["refusal_rate"] - 1 / 3) < 1e-9 and abs(r["one_and_done_rate"] - 1 / 3) < 1e-9


def test_friction_weekly_excludes_empty(con, tmp_path, mini_shard_path):
    _setup(con, tmp_path, mini_shard_path)
    rows = {r["week"]: r for r in metrics.run_sql(con, "friction_weekly").to_pylist()}
    assert rows[dt.date(2024, 3, 4)]["conversations"] == 2   # C3 excluded
    assert rows[dt.date(2024, 3, 11)]["repeat_rate"] == 0.0


def test_data_quality_weekly(con, tmp_path, mini_shard_path):
    _setup(con, tmp_path, mini_shard_path)
    rows = {r["week"]: r for r in metrics.run_sql(con, "data_quality_weekly").to_pylist()}
    w1, w2 = rows[dt.date(2024, 3, 4)], rows[dt.date(2024, 3, 11)]
    assert abs(w1["empty_input_rate"] - 1 / 3) < 1e-9 and w1["redacted_rate"] == 0.0
    assert abs(w2["redacted_rate"] - 1 / 3) < 1e-9
    assert w1["token_usage_coverage"] == 1.0 and abs(w2["token_usage_coverage"] - 2 / 3) < 1e-9
```

`tests/test_metrics_runner.py`:
```python
import json

import pyarrow.parquet as pq
from loupe.stages import metrics, flatten


def test_run_writes_all_aggregates_and_meta(tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    out = tmp_path / "agg"
    meta = metrics.run(flat_dir=flat, out_dir=out, min_cell=1)
    for name in metrics.METRICS:
        assert (out / f"{name}.parquet").exists(), name
    assert pq.read_table(out / "intent_weekly.parquet").num_rows == 0   # no intent files -> empty view
    m = json.loads((out / "meta.json").read_text())
    assert m["conversations"] == 6 and m["min_cell"] == 1 and m["shards"] == 1
    assert m["intent_coverage"] == "none"
    assert m["date_min"] == "2024-03-04" and m["date_max"] == "2024-03-11"
    assert meta == m
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_metrics_*.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'loupe.stages.metrics'`.

- [ ] **Step 3: Write the eleven SQL files exactly as listed in the Interfaces block above**, one per file under `loupe/metrics/`.

- [ ] **Step 4: Implement the runner**

`loupe/stages/metrics.py`:
```python
"""Stage 4: run each loupe/metrics/*.sql against the flat tables and write aggregates/."""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from loupe import hf, schema

SQL_DIR = Path(__file__).resolve().parent.parent / "metrics"
METRICS = [
    "volume_daily_model", "volume_weekly_country", "volume_weekly_language",
    "intensity_weekly", "depth_by_model",
    "intent_weekly", "intent_by_model", "intent_by_language",
    "friction_by_intent_model", "friction_weekly", "data_quality_weekly",
]


def register(con: duckdb.DuckDBPyConnection, flat_dir: Path) -> str:
    con.execute(f"CREATE OR REPLACE VIEW conversations AS SELECT * FROM read_parquet('{flat_dir}/conversations/*.parquet')")
    intent_dir = flat_dir / "intent"
    if intent_dir.exists() and any(intent_dir.glob("*.parquet")):
        con.execute(f"CREATE OR REPLACE VIEW intent AS SELECT * FROM read_parquet('{intent_dir}/*.parquet')")
        return "full"
    con.execute("CREATE OR REPLACE VIEW intent AS SELECT NULL::BIGINT AS conv_id, NULL::VARCHAR AS intent, "
                "NULL::FLOAT AS proba_max, NULL::VARCHAR AS shard WHERE false")
    return "none"


def run_sql(con: duckdb.DuckDBPyConnection, name: str, min_cell: int = 20) -> pa.Table:
    sql = (SQL_DIR / f"{name}.sql").read_text().replace("{{min_cell}}", str(int(min_cell)))
    return con.execute(sql).arrow()


def run(flat_dir: Path = Path("data/flat"), out_dir: Path = Path("aggregates"), min_cell: int = 20) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    coverage = register(con, flat_dir)
    total_bytes = 0
    for name in METRICS:
        table = run_sql(con, name, min_cell)
        path = out_dir / f"{name}.parquet"
        pq.write_table(table, path, compression="zstd")
        total_bytes += path.stat().st_size
        print(f"{name}: {table.num_rows} rows", file=sys.stderr)
    n, dmin, dmax, shards = con.execute(
        "SELECT count(*), min(date), max(date), count(DISTINCT shard) FROM conversations").fetchone()
    report_path = out_dir / "intent_classifier_report.json"
    if coverage == "full" and report_path.exists():
        rep = json.loads(report_path.read_text())
        if rep.get("forced"):
            coverage = "forced_below_threshold"
    meta = {
        "product": "Loupe", "dataset": hf.DATASET, "license": "ODC-By 1.0",
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "conversations": int(n), "shards": int(shards),
        "date_min": dmin.isoformat(), "date_max": dmax.isoformat(),
        "min_cell": int(min_cell), "intent_coverage": coverage,
        "taxonomy_version": json.loads((SQL_DIR.parent / "taxonomy.json").read_text())["version"],
        "aggregate_bytes": total_bytes,
        "population_caveat": "Conversations come from a free public chatbot hosted by the WildChat researchers, not from ChatGPT's own product. Findings describe this population only.",
        "pseudo_user_caveat": "Pseudo-users are a hash of IP, user agent, and accept-language. They merge people behind shared networks and split one person across devices.",
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    con.close()
    if total_bytes > 25 * 1024 * 1024:
        print(f"WARNING aggregates total {total_bytes/1e6:.1f} MB exceeds the 25 MB budget", file=sys.stderr)
    return meta
```

- [ ] **Step 5: Run to verify pass**

Run: `uv run pytest tests/test_metrics_*.py -q`
Expected: `11 passed`. If `quantile_cont` values differ, check the fixture: week 1 per-user counts are `[2, 1]`, so p50 = 1.5 and p90 = 1.9.

- [ ] **Step 6: Commit**

```bash
git add loupe/metrics loupe/stages/metrics.py tests/test_metrics_*.py
git commit -m "Add metric SQL definitions and metrics stage writing aggregates and meta.json

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: CLI wiring and CI

**Files:**
- Modify: `loupe/cli.py`
- Create: `tests/test_cli.py`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `loupe flatten [--shards SPEC] [--keep-raw] [--local PATH ...]`, `loupe sample [--n N]`, `loupe label [--dry-run] [--model M] [--budget USD]`, `loupe classify [--threshold F] [--force]`, `loupe metrics [--min-cell N]`. Exit codes: 0 ok, 2 classify below threshold, 3 label budget exceeded.

- [ ] **Step 1: Write the failing test**

`tests/test_cli.py`:
```python
import pyarrow.parquet as pq
from loupe import cli


def test_cli_flatten_local_then_metrics(tmp_path, mini_shard_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert cli.main(["flatten", "--local", str(mini_shard_path)]) == 0
    assert (tmp_path / "data/flat/conversations/mini_wildchat.parquet").exists()
    assert cli.main(["metrics", "--min-cell", "1"]) == 0
    assert pq.read_table(tmp_path / "aggregates/intensity_weekly.parquet").num_rows == 2


def test_cli_no_stage_returns_1():
    assert cli.main([]) == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_cli.py -q`
Expected: FAIL (`flatten` prints "not implemented" and returns 2).

- [ ] **Step 3: Implement the CLI**

Replace `loupe/cli.py`:
```python
import argparse
from pathlib import Path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="loupe", description="Loupe pipeline stages")
    sub = p.add_subparsers(dest="stage")

    f = sub.add_parser("flatten", help="shards -> data/flat")
    f.add_argument("--shards", default="all", help="all | 0-3 | 0,5,7")
    f.add_argument("--keep-raw", action="store_true")
    f.add_argument("--local", nargs="*", type=Path, help="local shard parquet paths (skips download)")

    s = sub.add_parser("sample", help="stratified intent sample")
    s.add_argument("--n", type=int, default=20000)

    l = sub.add_parser("label", help="label sample via Anthropic Message Batches")
    l.add_argument("--dry-run", action="store_true")
    l.add_argument("--model", default=None)
    l.add_argument("--budget", type=float, default=None)

    c = sub.add_parser("classify", help="train classifier and predict all conversations")
    c.add_argument("--threshold", type=float, default=0.85)
    c.add_argument("--force", action="store_true")

    m = sub.add_parser("metrics", help="write aggregates/")
    m.add_argument("--min-cell", type=int, default=20)
    return p


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.stage is None:
        parser.print_help()
        return 1
    if args.stage == "flatten":
        from loupe.stages import flatten
        flatten.run(shards=args.shards, keep_raw=args.keep_raw, local_paths=args.local)
        return 0
    if args.stage == "sample":
        from loupe.stages import sample
        print(sample.run(n=args.n))
        return 0
    if args.stage == "label":
        from loupe.stages import label
        try:
            label.run(model=args.model, budget_usd=args.budget, dry_run=args.dry_run)
        except label.BudgetExceeded as e:
            print(e)
            return 3
        return 0
    if args.stage == "classify":
        from loupe.stages import classify
        rep = classify.run(threshold=args.threshold, force=args.force)
        return 0 if rep.get("predicted") else 2
    if args.stage == "metrics":
        from loupe.stages import metrics
        metrics.run(min_cell=args.min_cell)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
```

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: uv python install 3.12
      - run: uv sync --extra dev
      - run: uv run pytest -q
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest -q`
Expected: all tests pass (around 35).

- [ ] **Step 5: Commit and push; confirm CI is green**

```bash
git add loupe/cli.py tests/test_cli.py .github/workflows/ci.yml
git commit -m "Wire the loupe CLI for all five stages and add GitHub Actions test workflow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
gh run watch --exit-status
```
Expected: the run finishes with status `completed success`.

---

### Task 11: Full data run (manual, network, hours)

**Files:**
- Modify: `aggregates/*.parquet`, `aggregates/meta.json`, `aggregates/intent_classifier_report.json` (all committed), `README.md` (add a "Reproduce" section).

This task has no new code. It is the production run, done in this order, each step recorded.

- [ ] **Step 1: Flatten the 1M-scale subset first for fast iteration**

Run: `make flatten SHARDS=0-21` (about a quarter of the shards, roughly 800k conversations). Expect 1 to 3 minutes per shard on a home connection; run it in the background and continue with Plan 2 in the meantime.

- [ ] **Step 2: Sample and dry-run the label estimate**

Run: `make sample` then `uv run loupe label --dry-run`
Expected: estimate printed. Decide the model and cap with Shankar (default `claude-opus-5`, cap $60; alternative `claude-haiku-4-5` if the estimate exceeds the cap). Write the decision into the PRD decision log (Plan 3, artifact 04).

- [ ] **Step 3: Label**

Run: `LOUPE_LABEL_MODEL=claude-opus-5 LOUPE_LABEL_BUDGET_USD=60 make label`
Expected: batch submitted; poll output every 60 s; finishes within the hour typically. `data/label_run.json` exists with `actual_usd`. Commit nothing yet (labels are content-free but live in `samples/`, gitignored on purpose because they include `conv_id` only; the run log is copied into the PRD).

- [ ] **Step 4: Classify**

Run: `make classify`
Expected: `held-out accuracy 0.xx`. If below 0.85, stop. Inspect `aggregates/intent_classifier_report.json` confusion matrix. Options in order: merge the two most-confused classes in `taxonomy.json` only if the merge is defensible in the metrics framework doc; otherwise run with `--force` and let `meta.json` mark coverage `forced_below_threshold`, which the dashboard must display (Plan 2). Never silently lower the threshold.

- [ ] **Step 5: Metrics on the subset, then finish the full flatten**

Run: `make metrics` and check `aggregates/meta.json` (`aggregate_bytes` under 25 MB). Then `make flatten SHARDS=all` (the 22 done shards are skipped), then `make classify` (re-predicts every shard with the saved model) and `make metrics` again.

- [ ] **Step 6: Commit aggregates and the reproduce section**

Add to `README.md`:
````markdown
## Reproduce

```bash
make setup            # uv, Python 3.12, dependencies
make test             # unit tests on a hand-built fixture
make flatten          # streams all 86 shards from Hugging Face, one at a time
make sample           # 20k stratified conversations for intent labeling
make label            # Anthropic Message Batches; refuses to run above LOUPE_LABEL_BUDGET_USD
make classify         # char n-gram classifier; stops if held-out accuracy < 0.85
make metrics          # writes aggregates/*.parquet and aggregates/meta.json
```

Only `aggregates/` is committed. Raw shards and any text live under `data/` and `samples/`, which are gitignored.
````

```bash
git add aggregates README.md
git commit -m "Add aggregates from the full WildChat-4.8M run

<paste the conversations, shards, date range, intent coverage, classifier accuracy, and label cost from meta.json and data/label_run.json>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

---

## Self-review notes

- Spec 10.1 says the flatten stage writes turn tables "without content." This plan keeps that and adds a 2000-character `intent_text` column on the conversation table so `classify` can run in one pass without re-streaming 15 GB. It is local-only and gitignored. This is recorded as a decision in the PRD decision log (Plan 3).
- Spec 6.2 guardrails covered: min-cell suppression (Task 9 SQL `HAVING`), classifier threshold (Task 8), cost cap (Task 7), no row-level content in aggregates (Task 9 writes only aggregates). Friction precision validation is in Plan 3 because it needs hand labels.
- Spec 13 test list covered: unit test per metric (Task 9), one-shard CI run replaced by fixture-based CI (Task 10) because CI has no network budget for a 170 MB shard; the full run is manual (Task 11).
- Type consistency check: `flatten_shard` returns `(convs, turns)` and `flatten.run` writes them; `metrics.register` reads the same paths; `classify.run` writes `schema.INTENT` and `metrics.register` reads it. `hf.label()` strips `.parquet`; both `flatten` and `classify` use the resulting label as the shard name.
