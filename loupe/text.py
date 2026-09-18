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
