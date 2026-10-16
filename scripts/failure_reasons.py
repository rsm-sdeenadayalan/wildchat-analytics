"""Why conversations fail: the failure-reason rules (site/try/failure-reasons.json) applied to WildChat.

Reads one raw shard (the full corpus is not kept locally), finds each conversation's first repeat or correction the
same way the try page does, gives it a reason, and writes only counts to aggregates/failure_reasons.json: no
conversation text leaves this script. Needs data/raw (local); the JSON is committed so the site build does not.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import duckdb
import pyarrow.parquet as pq

from loupe.text import is_correction, is_repeat, jaccard

RULES = Path("site/try/failure-reasons.json")


def compile_reasons(spec: dict) -> dict:
    sub = lambda p: re.compile(p.replace("{B}", r"\b").replace("{AP}", "['’]?"), re.IGNORECASE)  # noqa: E731
    return {
        "reasons": [{**r, "fb": [sub(p) for p in r.get("feedback", [])], "rp": [sub(p) for p in r.get("reply", [])]} for r in spec["reasons"]],
        "fallback": spec["fallback"],
    }


def reason_of(case: dict, R: dict) -> dict:
    for r in R["reasons"]:
        if any(x.search(case["bad_reply"] or "") for x in r["rp"]):
            return r
        # in a repeat, only words that are new count: the original task is not a complaint
        # (a short message like "continue" is the pushback itself, so this applies only to longer requests)
        rep = case["failure"] == "repeat" and case.get("prev_request") and len((case["user_feedback"] or "").strip()) > 40
        if any(x.search(case["user_feedback"] or "") and not (rep and x.search(case["prev_request"])) for x in r["fb"]):
            return r
    sim = jaccard(case["prev_request"], case["user_feedback"]) if case["failure"] == "repeat" and case.get("prev_request") is not None else 0
    return next((f for f in R["fallback"] if f["when"] == case["failure"] and sim >= f.get("min_similarity", 0)), R["fallback"][-1])


def first_failure(messages: list[dict]) -> dict | None:
    """The first repeat or correction, with the reply the person was reacting to (mirrors failureCases in engine.js)."""
    prev_user, last_reply = None, None
    for m in messages:
        role, content = m.get("role"), m.get("content") or ""
        if role == "assistant":
            last_reply = content
            continue
        if role != "user":
            continue
        rep, cor = is_repeat(prev_user, content), is_correction(content)
        if (rep or cor) and last_reply is not None:
            return {"failure": "correction" if cor else "repeat", "bad_reply": last_reply, "user_feedback": content, "prev_request": prev_user}
        prev_user = content
    return None


def main(shard: Path = Path("data/raw/data/train-00000-of-00086.parquet"), flat: Path = Path("data/flat"),
         out: Path = Path("aggregates/failure_reasons.json")) -> dict:
    R = compile_reasons(json.loads(RULES.read_text()))
    tbl = pq.read_table(shard, columns=["conversation"]).to_pylist()
    intents = dict(duckdb.connect().execute(f"SELECT conv_id, intent FROM read_parquet('{flat}/intent/*.parquet')").fetchall())
    total, by_reason, by_intent, intent_totals = 0, Counter(), defaultdict(Counter), Counter()
    for row in tbl:
        msgs = row["conversation"] or []
        if not msgs:
            continue
        total += 1
        case = first_failure(msgs)
        if not case:
            continue
        rid = reason_of(case, R)["id"]
        intent = intents.get(int(msgs[0]["turn_identifier"]), "unlabelled")
        by_reason[rid] += 1
        by_intent[intent][rid] += 1
        intent_totals[intent] += 1
    failures = sum(by_reason.values())
    meta = {r["id"]: r for r in [*json.loads(RULES.read_text())["reasons"], *json.loads(RULES.read_text())["fallback"]]}
    res = {
        "sample": {"shard": shard.name, "conversations": total, "failures": failures},
        "method": "Each conversation's first repeated request or correction gets one reason from what the person said when they pushed back (and, for refusals, the reply they reacted to), using the rules in site/try/failure-reasons.json. Rule-based and transparent: no conversation text is published.",
        "reasons": [{"id": k, "label": meta[k]["label"], "plain": meta[k]["plain"], "fix": meta[k]["fix"], "count": v, "share": v / failures}
                    for k, v in by_reason.most_common()],
        "by_intent": {i: {"failures": n, "top": [{"id": k, "label": meta[k]["label"], "share": v / n} for k, v in by_intent[i].most_common(3)]}
                      for i, n in intent_totals.most_common() if n >= 30},
    }
    out.write_text(json.dumps(res, indent=2))
    print(f"{total:,} conversations, {failures:,} failures")
    for r in res["reasons"]:
        print(f"  {r['share']:6.1%}  {r['count']:5d}  {r['label']}")
    return res


if __name__ == "__main__":
    main()
