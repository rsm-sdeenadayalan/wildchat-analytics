"""Turn-level attribution: which responder is answerable for the friction a user turn shows.

Loupe reads friction from the user's side of a conversation. A repeated request or a correction is
something the person did in reaction to the reply they just received. So blame belongs to whoever
produced that reply, turn by turn, not to "the conversation". In WildChat one model answers every
turn, so turn-level and conversation-level attribution agree. In an orchestrator that hands turns
to several sub-assistants they do not, and this is the one contract such a team has to meet:

    log one field per assistant message, `responder`, naming what produced it.

When the field is missing, every assistant turn falls back to the conversation's default responder
(the model) and Loupe reports at that level. It never infers a sub-assistant from content.
"""
from __future__ import annotations

from dataclasses import dataclass

from loupe import text


@dataclass(frozen=True)
class Message:
    role: str
    content: str
    responder: str | None = None  # set by adapters whose logs name the producer per message


@dataclass(frozen=True)
class TurnFlags:
    idx: int
    role: str
    attributed_to: str | None
    repeats_prev_user: bool
    is_correction: bool
    is_refusal: bool


def attribute_turns(messages: list[Message], default_responder: str | None) -> list[TurnFlags]:
    """Flag each turn and attach it to the responder answerable for it.

    An assistant turn is attributed to its own responder (the per-message field, else the default).
    A user turn is attributed to the responder of the assistant turn it reacts to, which is the one
    immediately before it; the first user turn reacts to nothing and is attributed to no one.
    """
    out: list[TurnFlags] = []
    prev_user: str | None = None
    prev_responder: str | None = None
    for i, m in enumerate(messages, start=1):
        content = m.content or ""
        if m.role == "user":
            out.append(TurnFlags(
                idx=i, role="user", attributed_to=prev_responder,
                repeats_prev_user=text.is_repeat(prev_user, content),
                is_correction=text.is_correction(content),
                is_refusal=False,
            ))
            prev_user = content
        else:
            responder = m.responder or default_responder
            out.append(TurnFlags(
                idx=i, role=m.role, attributed_to=responder,
                repeats_prev_user=False, is_correction=False,
                is_refusal=text.is_refusal(content),
            ))
            prev_responder = responder
    return out
