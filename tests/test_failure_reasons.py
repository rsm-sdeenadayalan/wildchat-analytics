"""Failure reasons: the browser (engine.js) and the pipeline (scripts/failure_reasons.py) read the same rules file
and must agree, case by case, including on Chinese and Russian text and on the repeat rules."""
import json
import subprocess

from scripts.failure_reasons import RULES, compile_reasons, reason_of

CASES = [
    # (user_feedback, bad_reply, failure, prev_request, expected)
    ("That didn't work. It still crashes.", "Sure. Wrap it in try/catch.", "correction", None, "broken"),
    ("I get an error when I run it", "x", "correction", None, "broken"),
    ("Traceback (most recent call last):", "x", "repeat", "fix my script", "broken"),
    ("No, I meant error handling", "x", "correction", None, "misunderstood"),
    ("continue", "x", "repeat", "continue", "incomplete"),
    ("继续", "x", "repeat", "继续", "incomplete"),
    ("you stopped halfway, give me the full code", "x", "correction", None, "incomplete"),
    ("I told you not to use jQuery", "x", "correction", None, "ignored"),
    ("please answer in English", "x", "correction", None, "language"),
    ("too long, make it shorter", "x", "correction", None, "format"),
    ("that's not what I asked", "x", "correction", None, "misunderstood"),
    ("wrong, Paris is the capital", "x", "correction", None, "wrong"),
    ("advantages of a thermal power plant", "x", "repeat", "advantages of a thermal power plant please", "reworded"),  # "thermal" must not read as "mal" (wrong)
    ("you can do it, just try", "I'm sorry, but I can't help with that.", "correction", None, "refused"),
    ("write a poem about cats please", "x", "repeat", "write a poem about cats please", "resent"),
    ("write a short poem about my cat Tom", "x", "repeat", "write a poem about cats please now", "reworded"),
    ("no.", "x", "correction", None, "unclear"),
    ("还是报错", "x", "correction", None, "broken"),
    ("不对，北京", "x", "correction", None, "wrong"),
    ("用中文回答", "x", "correction", None, "language"),
    ("не работает", "x", "correction", None, "broken"),
    # a repeated long task that itself says "translate": the task is not a complaint
    ("Please translate this long paragraph about the history of Rome into French for me", "x", "repeat",
     "Please translate this long paragraph about the history of Rome into French", "reworded"),
]


def test_python_rules_match_expected():
    R = compile_reasons(json.loads(RULES.read_text()))
    got = [reason_of({"user_feedback": f, "bad_reply": r, "failure": k, "prev_request": p}, R)["id"] for f, r, k, p, _ in CASES]
    assert got == [c[-1] for c in CASES]


def test_browser_and_pipeline_agree():
    script = f"""
      import {{ readFileSync }} from 'node:fs';
      import {{ compileReasons, reasonOf }} from './site/try/engine.js';
      const R = compileReasons(JSON.parse(readFileSync('site/try/failure-reasons.json', 'utf8')));
      const cases = {json.dumps([[f, r, k, p] for f, r, k, p, _ in CASES])};
      console.log(JSON.stringify(cases.map(([f, r, k, p]) => reasonOf({{ user_feedback: f, bad_reply: r, failure: k, prev_request: p }}, R).id)));
    """
    js = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout)
    R = compile_reasons(json.loads(RULES.read_text()))
    py = [reason_of({"user_feedback": f, "bad_reply": r, "failure": k, "prev_request": p}, R)["id"] for f, r, k, p, _ in CASES]
    assert js == py


def test_published_aggregate_holds_no_text():
    agg = json.loads(open("aggregates/failure_reasons.json").read())
    assert set(agg) == {"sample", "method", "reasons", "by_intent"}
    for r in agg["reasons"]:
        assert set(r) == {"id", "label", "plain", "fix", "count", "share"}
    assert abs(sum(r["count"] for r in agg["reasons"]) - agg["sample"]["failures"]) == 0
