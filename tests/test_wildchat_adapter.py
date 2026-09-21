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
