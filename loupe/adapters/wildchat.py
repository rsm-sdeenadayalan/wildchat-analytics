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
