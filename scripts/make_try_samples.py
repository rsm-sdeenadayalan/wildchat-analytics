"""Synthetic sample files for the Try page. Clearly synthetic; never derived from WildChat text.

chat-sample.jsonl: an assistant served by two models. Engaged users (long, multi-turn work) mostly
pick "pro-model"; casual users mostly pick "fast-model". The model has NO effect on outcomes by
construction, so a naive comparison shows a large gap and the same-people comparison shows none.
A prompt change ships on 2026-07-01 (prompt_version v1 -> v2) and cuts the chance a follow-up is a
correction from 8% to 2%, so the before/after check on the same people should find an improvement.

agent-traces.otlp.json: an orchestrator with three sub-agents (planner, researcher, writer) as
OpenTelemetry GenAI spans. The writer's replies draw more corrections by construction, so per-step
attribution should single it out.

chatgpt-export-sample.json: one person's history in the ChatGPT export shape (a message tree under
`mapping`, the visible thread ending at `current_node`), with the parts a reader must skip: hidden custom
instructions, a tool call and its output, and an edited branch that was abandoned. Model names are generic.
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path("site/try/samples")
R = random.Random(11)
T0 = datetime(2026, 6, 1, tzinfo=timezone.utc)

PROMPTS = {
    "coding": ["Write a Python function that reverses a linked list.", "Why does my SQL query return duplicate rows?",
               "Fix this JavaScript bug where the submit button does nothing.", "Explain this stack trace: KeyError 'user_id' in pandas.",
               "Write a regex that matches US phone numbers.", "Convert this for loop to a list comprehension."],
    "questions": ["What is the difference between TCP and UDP?", "How does compound interest work?", "Can you explain vector databases simply?",
                  "Is it true that we only use 10% of our brain?", "Why is the sky blue?", "How do vaccines train the immune system?"],
    "writing_and_business": ["Rewrite this email to my manager about the deadline moving to Friday.", "Draft a LinkedIn post about our Q3 launch.",
                             "Summarize this report on the onboarding redesign.", "Make my cover letter for a product role shorter.",
                             "Write a polite reminder to a client about an unpaid invoice.", "Turn these meeting notes into three action items."],
    "translation": ["Translate to Spanish: the meeting moved to Friday.", "How do you say 'see you soon' in French?",
                    "Translate this paragraph into German: our Q3 launch went well."],
    "other": ["hi", "test", "hello?", "are you there", "asdf"],
}
FILL = ["the second option", "a shorter version", "Python, not JavaScript", "the formal tone", "the numbers from the report", "the Friday deadline"]
FOLLOW = ["Can you make it shorter?", "Now add error handling.", "Give me an example.", "What about edge cases?", "Thanks, one more thing: use {x}."]
CORR = ["No, that's wrong, I meant {x}.", "Not what I asked for. I wanted {x}.", "Try again, with {x}."]
REPLY_LONG = "Here is a detailed answer, step by step, with an example and a short explanation of the trade-offs involved. " * 2
REPLY_SHORT = "Sure, here you go."


CHANGE_AT = T0 + timedelta(days=30)


def conv_text(intent, engaged, p_corr=0.08):
    msgs = [{"role": "user", "content": R.choice(PROMPTS[intent])}]
    turns = 1 if intent == "other" else (R.choice([1, 2, 3, 4, 5]) if engaged else R.choice([1, 1, 1, 2]))
    for t in range(turns):
        msgs.append({"role": "assistant", "content": REPLY_LONG if (engaged or turns > 1) else REPLY_SHORT})
        if t < turns - 1:
            msgs.append({"role": "user", "content": (R.choice(CORR) if R.random() < p_corr else R.choice(FOLLOW)).format(x=R.choice(FILL))})
    return msgs


def chat_sample(n_users=900):
    out = []
    for u in range(n_users):
        engaged = R.random() < 0.35
        p_pro = 0.85 if engaged else 0.12
        k = R.choice([1, 2, 3, 6, 10]) if engaged else R.choice([1, 1, 2, 3])
        weights = {"coding": 3, "questions": 3, "writing_and_business": 2, "translation": 1, "other": 0.3 if engaged else 2.5}
        for c in range(k):
            intent = R.choices(list(weights), weights=list(weights.values()))[0]
            model = "pro-model" if R.random() < p_pro else "fast-model"
            ts = T0 + timedelta(days=R.randrange(0, 56), minutes=R.randrange(0, 1440))
            v2 = ts >= CHANGE_AT
            out.append({"conversation_id": f"c{u:04d}-{c}", "user_id": f"u{u:04d}", "timestamp": ts.isoformat(), "model": model,
                        "prompt_version": "v2" if v2 else "v1", "messages": conv_text(intent, engaged, 0.02 if v2 else 0.08)})
    out.sort(key=lambda o: o["timestamp"])
    (OUT / "chat-sample.jsonl").write_text("\n".join(json.dumps(o) for o in out) + "\n")
    return len(out)


def attr(k, v):
    return {"key": k, "value": {"intValue": v} if isinstance(v, int) else {"stringValue": v}}


def agent_traces(n=400):
    spans = []
    agents = [("planner", 0.02), ("researcher", 0.03), ("writer", 0.22)]  # probability the user corrects that agent's reply
    for i in range(n):
        trace = f"{i:032x}"
        t = int((T0 + timedelta(hours=i * 3)).timestamp() * 1e9)
        user = f"u{R.randrange(0, 160):04d}"
        last_user = R.choice(PROMPTS["writing_and_business"])
        for step in range(R.choice([2, 3, 4])):
            agent, p = agents[min(step, 2)] if step < 3 else agents[2]
            out = f"[{agent}] " + REPLY_LONG
            spans.append({"traceId": trace, "spanId": f"{i:08x}{step:08x}", "name": f"invoke_agent {agent}", "startTimeUnixNano": str(t + step * 10**9),
                          "attributes": [attr("gen_ai.operation.name", "chat"), attr("gen_ai.agent.name", agent), attr("gen_ai.request.model", "gpt-4.1-mini"),
                                         attr("user.id", user), attr("gen_ai.input.messages", json.dumps([{"role": "user", "content": last_user}])),
                                         attr("gen_ai.output.messages", json.dumps([{"role": "assistant", "content": out}]))]})
            last_user = (R.choice(CORR) if R.random() < p else R.choice(FOLLOW)).format(x=R.choice(FILL))
    doc = {"resourceSpans": [{"resource": {"attributes": [attr("service.name", "sales-email-agent")]}, "scopeSpans": [{"scope": {"name": "demo"}, "spans": spans}]}]}
    (OUT / "agent-traces.otlp.json").write_text(json.dumps(doc))
    return len(spans)


def chatgpt_export(n=320):
    out = []
    t0 = T0 - timedelta(days=150)
    weights = {"coding": 5, "questions": 3, "writing_and_business": 3, "translation": 1, "other": 0.6}
    for i in range(n):
        created = t0 + timedelta(days=R.randrange(0, 150) if R.random() < 0.8 else R.randrange(100, 150), minutes=R.randrange(0, 1440))
        intent = R.choices(list(weights), weights=list(weights.values()))[0]
        model = "reasoning-model" if intent == "coding" and R.random() < 0.6 else "fast-model"
        p_corr = 0.18 if model == "fast-model" and intent == "coding" else 0.05
        mapping, k = {}, [0]

        def node(parent, message):
            nid = f"n{i}-{k[0]}"; k[0] += 1
            mapping[nid] = {"id": nid, "message": message, "parent": parent, "children": []}
            if parent:
                mapping[parent]["children"].append(nid)
            return nid

        def msg(role, text, ts, **meta):
            return {"id": f"m{i}-{k[0]}", "author": {"role": role}, "create_time": ts, "content": {"content_type": "text", "parts": [text]},
                    "recipient": "all", "metadata": meta}

        ts = created.timestamp()
        cur = node(None, None)
        cur = node(cur, msg("system", "", ts, is_visually_hidden_from_conversation=True))
        cur = node(cur, {**msg("user", "I am a product manager. Keep answers short.", ts), "content": {"content_type": "user_editable_context", "user_profile": "PM"}})
        first = R.choice(PROMPTS[intent])
        if R.random() < 0.1:  # an edited first message: the abandoned branch must not be read
            node(cur, msg("user", first + " (draft)", ts))
        cur = node(cur, msg("user", first, ts))
        turns = 1 if intent == "other" else R.choice([1, 2, 2, 3, 4])
        for step in range(turns):
            ts += 30
            if intent == "coding" and R.random() < 0.25:  # tool call and output, both skipped
                cur = node(cur, {**msg("assistant", "", ts, model_slug=model), "recipient": "python", "content": {"content_type": "code", "text": "print(1)"}})
                cur = node(cur, {**msg("tool", "1", ts), "content": {"content_type": "execution_output", "text": "1"}})
            cur = node(cur, msg("assistant", REPLY_LONG, ts, model_slug=model))
            if step < turns - 1:
                ts += 60
                follow = (R.choice(CORR) if R.random() < p_corr else R.choice(FOLLOW)).format(x=R.choice(FILL))
                cur = node(cur, msg("user", follow, ts))
        out.append({"title": first[:40], "create_time": created.timestamp(), "update_time": ts, "mapping": mapping, "current_node": cur,
                    "conversation_id": f"conv-{i:04d}", "default_model_slug": model})
    out.sort(key=lambda o: -o["create_time"])
    (OUT / "chatgpt-export-sample.json").write_text(json.dumps(out))
    return len(out)


if __name__ == "__main__":
    print("chat conversations:", chat_sample(), "| agent spans:", agent_traces(), "| chatgpt export conversations:", chatgpt_export())
