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
