"""The browser engine's friction rules must agree with loupe/text.py."""
import json
import shutil
import subprocess

import pytest

from loupe import text

CASES = [
    "No, that's wrong", "no problem, thanks", "Nobody asked", "not what I wanted", "wrong answer", "wrongly placed",
    "I said Python", "you didn't read it", "try again please", "不对，重新写", "错了", "нет, не так", "не то совсем",
    "неправильно", "incorrecto", "eso no es", "mal, otra vez", "non, refais", "c'est faux", "That’s not it", "thanks!",
    "  no. stop", "I meant the other one", "Ok great", "",
]
PAIRS = [("write a python function to sort a list", "write a python function to sort a list please"),
         ("hello", "goodbye"), ("Привет мир как дела", "привет мир как дела сегодня"), ("", "x"), ("a b c", "a b c")]


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_correction_and_repeat_rules_match_python():
    script = f"""
      import {{ isCorrection, jaccard }} from './site/try/engine.js';
      const C = {json.dumps(CASES)}, P = {json.dumps(PAIRS)};
      console.log(JSON.stringify({{ corr: C.map(isCorrection), jac: P.map(([a, b]) => jaccard(a, b)) }}));
    """
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout)
    assert out["corr"] == [text.is_correction(c) for c in CASES], list(zip(CASES, out["corr"], [text.is_correction(c) for c in CASES]))
    for (a, b), j in zip(PAIRS, out["jac"]):
        assert abs(j - text.jaccard(a, b)) < 1e-12, (a, b, j, text.jaccard(a, b))


CLAUDE_EXPORT = [{
    "uuid": "c1", "name": "t", "created_at": "2026-05-01T10:00:00Z", "account": {"uuid": "a"},
    "chat_messages": [
        {"uuid": "1", "sender": "human", "created_at": "2026-05-01T10:00:00Z", "text": "Write a SQL query", "content": [{"type": "text", "text": "Write a SQL query"}]},
        {"uuid": "2", "sender": "assistant", "created_at": "2026-05-01T10:00:05Z", "text": "SELECT 1", "content": [{"type": "thinking", "thinking": "hm"}, {"type": "text", "text": "SELECT 1"}]},
        {"uuid": "3", "sender": "human", "created_at": "2026-05-01T10:01:00Z", "text": "No, that's wrong", "content": [{"type": "text", "text": "No, that's wrong"}]},
    ],
}]


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_personal_exports_follow_the_visible_thread():
    script = f"""
      import {{ readFileSync }} from 'node:fs';
      import {{ normalize }} from './site/try/engine.js';
      const g = normalize(readFileSync('site/try/samples/chatgpt-export-sample.json', 'utf8'), 'conversations.json');
      const c = normalize(JSON.stringify({json.dumps(CLAUDE_EXPORT)}), 'conversations.json');
      const texts = g.conversations.flatMap((x) => x.messages.map((m) => m.content));
      console.log(JSON.stringify({{
        g: {{ format: g.format, personal: g.personal, n: g.conversations.length, users: [...new Set(g.conversations.map((x) => x.user))],
             models: [...new Set(g.conversations.map((x) => x.model))].sort(), roles: [...new Set(g.conversations.flatMap((x) => x.messages.map((m) => m.role)))].sort(),
             leaked: texts.filter((t) => t.includes('(draft)') || t.includes('Keep answers short') || t === 'print(1)' || t === '1').length,
             firstIsUser: g.conversations.every((x) => x.messages[0].role === 'user') }},
        c: {{ format: c.format, personal: c.personal, msgs: c.conversations[0].messages.map((m) => [m.role, m.content.trim()]) }},
      }}));
    """
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout)
    g, c = out["g"], out["c"]
    assert (g["format"], g["personal"], g["n"], g["users"]) == ("ChatGPT export", True, 320, ["you"])
    assert g["models"] == ["fast-model", "reasoning-model"] and g["roles"] == ["assistant", "user"]
    assert g["leaked"] == 0 and g["firstIsUser"]
    assert (c["format"], c["personal"]) == ("Claude export", True)
    assert c["msgs"] == [["user", "Write a SQL query"], ["assistant", "SELECT 1"], ["user", "No, that's wrong"]]


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_change_check_finds_the_planted_fix_and_failures_export():
    script = """
      import { readFileSync } from 'node:fs';
      import * as E from './site/try/engine.js';
      const n = E.normalize(readFileSync('site/try/samples/chat-sample.jsonl', 'utf8'), 'x.jsonl');
      const a = E.analyze(n, null);
      const ch = E.versionChanges(a.rows);
      const fix = E.beforeAfter(a.rows, ch[0].at, 'correction');
      const rep = E.beforeAfter(a.rows, ch[0].at, 'repeat');
      const cases = E.failureCases(n, a);
      console.log(JSON.stringify({ ch: ch.map((c) => c.version), fix: fix.verdict.key, gap: fix.matchedGap, rep: rep.verdict.key,
        cases: cases.length, flagged: a.rows.filter((r) => r.repeat || r.correction).length,
        shape: cases.every((c) => c.context.length && c.context[c.context.length - 1].role === 'user' && c.bad_reply && c.user_feedback) }));
    """
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout)
    assert out["ch"] == ["v2"]
    assert out["fix"] == "real" and out["gap"] < -0.03  # corrections fell for the same people
    assert out["rep"] == "none"  # repeats were not changed by construction
    assert out["cases"] == out["flagged"] and out["shape"]


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_story_how_it_works_numbers_match_the_sample():
    """Step 4 of the story's "how it works" sequence quotes the try page's outputs for its sample chat log."""
    script = """
      import { readFileSync } from 'node:fs';
      import * as E from './site/try/engine.js';
      import { loadIntentModel } from './site/try/intent.js';
      const clf = loadIntentModel(JSON.parse(readFileSync('site/try/intent-model.json', 'utf8')));
      const n = E.normalize(readFileSync('site/try/samples/chat-sample.jsonl', 'utf8'), 'x.jsonl');
      const a = E.analyze(n, clf);
      const ch = E.beforeAfter(a.rows, E.versionChanges(a.rows)[0].at, 'correction');
      const cases = E.failureCases(n, a);
      const top = E.backlog(cases, a, false).find((x) => x.intent === 'coding');  // the row the card shows
      console.log(JSON.stringify({ gap: ch.matchedGap, users: ch.matchedUsers, cases: cases.length, intent: top.intent, failures: top.failures, share: top.share }));
    """
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout)
    html = open("site/index.html", encoding="utf-8").read()
    expected = [f"−{abs(out['gap']) * 100:.1f} pts", f"the same {out['users']} people", f"<b>{out['cases']}</b>",
                f"<b>{out['intent']}</b>", f"{out['failures']} failures · {out['share'] * 100:.1f}% of {out['intent']} conversations"]
    for s in expected:
        assert s in html, f"story step 4 is out of date with the sample: missing {s!r}"
