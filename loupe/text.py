"""Pure text helpers used by adapters. No I/O."""
from __future__ import annotations

import hashlib
import re

REPEAT_THRESHOLD = 0.6

_WORD = re.compile(r"\w+", re.UNICODE)

# Apostrophe pattern matching both straight (U+0027) and curly (U+2019) quotes
_AP = r"['’]?"

# Start-of-turn correction patterns. Keep anchored (^) so "Nobody" does not match "No".
_CORRECTION = re.compile(
    rf"^\s*(?!no (?:problem|worries|thanks|need))(?:"
    rf"no[,.!]|not (?:what|that)|wrong\b|that{_AP}s (?:not|wrong)|i said\b|i meant\b|incorrect\b|"
    rf"you didn{_AP}t\b|you did not\b|try again\b|"
    rf"不对|不是这|不是我(?:要|说)的|错了|"
    rf"нет[,.\s]|неправильно|не то\b|не так\b|я сказал|я просил|"
    rf"incorrecto\b|no es eso|eso no\b|mal[,.!\s]|"
    rf"non[,.!\s]|ce n{_AP}est pas|c{_AP}est faux|faux\b"
    rf")",
    re.IGNORECASE,
)

_REFUSAL = re.compile(
    rf"^\s*(?:"
    rf"i{_AP}m sorry|i am sorry|sorry,? (?:but )?i\b|i (?:cannot|can{_AP}t|can not) (?:help|assist|provide|do|comply|fulfill|fulfil|generate|create|write|continue|share|give)\b|"
    rf"i{_AP}m unable|i am unable|as an ai\b|i{_AP}m not able|i am not able|"
    rf"unfortunately,? i (?:cannot|can{_AP}t)|"
    rf"很抱歉|对不起|抱歉|"
    rf"извините|к сожалению,? я не могу"
    rf")",
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
