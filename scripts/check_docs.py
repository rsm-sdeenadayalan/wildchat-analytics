"""Check docs/pm artifacts for the header block, required sections, placeholders, and PII."""
from __future__ import annotations

import re
import sys
from pathlib import Path

DOCS = Path("docs/pm")

REQUIRED: dict[str, list[str]] = {
    "01-opportunity-brief.md": ["## Problem", "## Who has it", "## Evidence", "## Why now", "## The wedge", "## What we will not do", "## Decision requested"],
    "02-user-research.md": ["## Research questions", "## Method", "## Participants", "## What we heard", "## Pain points, ranked", "## What changed in the PRD", "## Gaps and next steps"],
    "03-metrics-framework.md": ["## Purpose", "## North star", "## Metric families", "## Definitions", "## Known biases", "## Intent taxonomy", "## Friction proxy validation", "## Queries"],
    "04-prd.md": ["## Problem", "## Goals", "## Non-goals", "## Personas", "## User stories", "## Requirements", "## Success metrics", "## Launch criteria", "## Privacy and sensitive data", "## Open questions", "## Decision log"],
    "05-roadmap.md": ["## Now", "## Next", "## Later", "## Cut list", "## Sequencing rationale"],
    "06-dashboard-design.md": ["## Who reads it and when", "## Information hierarchy", "## Views", "## Wireframes", "## Interaction rules", "## Deliberately absent"],
    "07-trends-report.md": ["## Read this first", "## Findings", "## Method", "## Limitations", "## What a product owner should do"],
    "08-strategy-memo.md": ["## Situation", "## What the data says", "## Implications", "## Recommendations", "## Risks", "## What I would measure next"],
    "09-retro.md": ["## What shipped", "## What was cut", "## Launch checks", "## What the numbers said", "## What was wrong in the PRD", "## If I did it again"],
}

_HEADER = [
    ("What this is for", re.compile(r"^\*\*What this is for:\*\* .+$", re.M)),
    ("Date", re.compile(r"^\*\*Date:\*\* \d{4}-\d{2}-\d{2}$", re.M)),
    ("Status", re.compile(r"^\*\*Status:\*\* (Draft|In review|Final)$", re.M)),
]
_PLACEHOLDER = re.compile(r"\b(TBD|TODO|XXX|lorem ipsum)\b", re.I)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def check_doc(path: Path) -> list[str]:
    text = path.read_text()
    problems: list[str] = []
    if not re.search(r"^# .+$", text, re.M):
        problems.append(f"{path.name}: missing H1 title")
    for label, rx in _HEADER:
        if not rx.search(text):
            problems.append(f"{path.name}: header line missing or malformed: {label}")
    headings = set(re.findall(r"^## .+$", text, re.M))
    for h in REQUIRED.get(path.name, []):
        if h not in headings:
            problems.append(f"{path.name}: missing section {h}")
    for m in _PLACEHOLDER.finditer(text):
        problems.append(f"{path.name}: placeholder '{m.group(0)}'")
    for m in _EMAIL.finditer(text):
        problems.append(f"{path.name}: email address present: {m.group(0)}")
    return problems


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    strict = "--strict" in argv
    problems: list[str] = []
    for name in REQUIRED:
        p = DOCS / name
        if not p.exists():
            if strict:
                problems.append(f"{name}: file missing")
            continue
        problems += check_doc(p)
    for p in problems:
        print(p)
    print("docs check:", "OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
