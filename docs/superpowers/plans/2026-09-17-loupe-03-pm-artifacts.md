# Loupe PM Artifacts and Research Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the nine senior-PM artifacts under `docs/pm/`, the research kits (interview guide, outreach, synthesis, usability test) that only Shankar can run, and the two validation scripts the spec requires: friction-proxy precision against 300 hand labels and reproducibility of every number in the trends report.

**Architecture:** Documents are Markdown with a fixed header block and required sections, enforced by `scripts/check_docs.py`. Numbers in the trends report are wrapped in machine-checkable `loupe-check` comment blocks that `scripts/check_report.py` executes against the committed aggregates. Hand labels live as small CSVs with `conv_id` and booleans only (no text) under `docs/pm/research/`; `scripts/friction_precision.py` joins them to the local flat tables to compute precision. `scripts/score_usability.py` turns the usability results CSV into the five launch-check numbers from spec Section 6.3.

**Tech Stack:** Markdown, Python (DuckDB, csv, re), pytest.

**Spec:** `docs/superpowers/specs/2026-09-17-loupe-design.md` (Sections 3, 4, 6, 7, 9, 12, 13, 14). Depends on Plan 1 for `data/flat/` (friction labeling and precision), `aggregates/` (report numbers), and `data/label_run.json` (PRD decision log). Plan 2 renders these documents into the site.

## Global Constraints

- Every artifact file starts with this header block, exactly:
  ```
  # <Title>

  **What this is for:** <one line>
  **Date:** YYYY-MM-DD
  **Status:** Draft | In review | Final
  ```
- Required `##` sections per artifact are listed in Task 1's `REQUIRED` map and enforced by `scripts/check_docs.py`. A document is not done until the checker passes.
- No transcript content, participant names, emails, or employers in the repo. Participants are `P1`…`Pn`; quotes are paraphrased or used with written consent and stripped of identifying detail.
- Every number in `07-trends-report.md` is inside a `loupe-check` block (Task 8 format) and `scripts/check_report.py` passes before the report is marked Final.
- Public copy never calls a pseudo-user a "user". The population caveat appears in the first screen of the trends report and the strategy memo.
- Shankar writes or rewrites the final pass of every document. Drafts by an agent are marked `Status: Draft`; only Shankar changes a status to `Final`.
- Commit after every task. Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File Structure

```
docs/pm/
  README.md                        guided tour for a recruiter (order, time per doc)
  01-opportunity-brief.md
  02-user-research.md
  03-metrics-framework.md
  04-prd.md
  05-roadmap.md
  06-dashboard-design.md
  07-trends-report.md
  08-strategy-memo.md
  09-retro.md
  research/
    interview-guide.md
    outreach.md
    participants.csv               P-id, segment, role type, date, status (no names)
    friction-labeling-guide.md
    friction_labels.csv            conv_id, got_what_they_came_for, is_repeat, is_correction, is_refusal, notes(no text)
    usability-test-script.md
    usability_results.csv          participant, question, seconds, correct, caveat_stated
    actionability_survey.csv       respondent, finding_id, would_act
scripts/
  check_docs.py                    header + required sections
  export_friction_sample.py        local-only: 300 conversations with text for hand labeling -> samples/
  friction_precision.py            precision per proxy from friction_labels.csv joined to data/flat
  check_report.py                  run loupe-check blocks in 07 against aggregates/
  score_usability.py               launch checks from usability_results.csv + actionability_survey.csv
tests/
  test_check_docs.py
  test_friction_precision.py
  test_check_report.py
  test_score_usability.py
```

---

### Task 1: Document checker and the guided-tour README

**Files:**
- Create: `scripts/check_docs.py`, `tests/test_check_docs.py`, `docs/pm/README.md`

**Interfaces:**
- Produces: `REQUIRED: dict[str, list[str]]` mapping artifact filename to required `##` headings; `check_doc(path: Path) -> list[str]` returns problems for one file (header block present and well-formed, all required sections present, no `TBD`/`TODO`, no email addresses); `main()` checks every key in `REQUIRED` that exists on disk and exits 1 on problems; `--strict` also fails on missing files.

- [ ] **Step 1: Write the failing test**

`tests/test_check_docs.py`:
```python
from pathlib import Path

from scripts.check_docs import REQUIRED, check_doc

HEADER = "# Opportunity brief\n\n**What this is for:** Decide whether to build.\n**Date:** 2026-09-18\n**Status:** Draft\n\n"


def _doc(tmp_path, name, body):
    p = tmp_path / name
    p.write_text(body)
    return p


def test_required_map_covers_nine_artifacts():
    assert len([k for k in REQUIRED if k[:2].isdigit()]) == 9
    assert "04-prd.md" in REQUIRED and "## Decision log" in REQUIRED["04-prd.md"]


def test_passes_when_header_and_sections_present(tmp_path):
    body = HEADER + "".join(f"{h}\n\ntext\n\n" for h in REQUIRED["01-opportunity-brief.md"])
    assert check_doc(_doc(tmp_path, "01-opportunity-brief.md", body)) == []


def test_flags_missing_header_sections_placeholders_and_emails(tmp_path):
    body = "# Opportunity brief\n\n## Problem\n\nTBD contact me at a@b.com\n"
    problems = "\n".join(check_doc(_doc(tmp_path, "01-opportunity-brief.md", body)))
    assert "What this is for" in problems and "Date" in problems and "Status" in problems
    assert "missing section" in problems
    assert "placeholder" in problems and "email" in problems
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_check_docs.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.check_docs'`.

- [ ] **Step 3: Implement**

`scripts/check_docs.py`:
```python
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
```

- [ ] **Step 4: Write `docs/pm/README.md`**

```markdown
# Loupe case study

**What this is for:** Tell a reader what to read, in what order, and how long it takes.
**Date:** 2026-09-18
**Status:** Draft

Loupe is a user analytics product for teams that ship a GenAI assistant. This folder is the record of the product work behind it, in the order it was done. Every document is dated and carries a status. Numbers in the trends report are reproducible from the committed aggregates by running `uv run python scripts/check_report.py`.

## If you have ten minutes

1. [Opportunity brief](01-opportunity-brief.md), 3 minutes. The problem, who has it, and the wedge.
2. [Trends report](07-trends-report.md), 5 minutes. What 3.2 million real conversations say, and what a product owner should do about it.
3. [Retrospective](09-retro.md), 2 minutes. What shipped, what was cut, what was wrong.

## If you have thirty minutes, add

4. [Metrics framework](03-metrics-framework.md). Definitions, biases, and how the friction proxies were validated.
5. [PRD](04-prd.md). Requirements, success metrics, privacy, and the decision log.
6. [User research](02-user-research.md). Who we talked to and what changed because of it.

## The rest

7. [Roadmap](05-roadmap.md) with the cut list.
8. [Dashboard design](06-dashboard-design.md).
9. [Strategy memo](08-strategy-memo.md) for a company building an AI assistant.

## Research kits

The interview guide, outreach message, friction labeling guide, and usability test script are under [research/](research/). Participant files contain identifiers like P1, never names.

## Data and caveats

The demonstration data is WildChat-4.8M (ODC-By 1.0). It came from a free public chatbot the researchers hosted, not from ChatGPT's own product, so findings describe that population. "Pseudo-users" are a hash of network and browser headers, not accounts. Both caveats are repeated wherever numbers appear.
```

- [ ] **Step 5: Run, verify, commit**

Run: `uv run pytest tests/test_check_docs.py -q && uv run python scripts/check_docs.py`
Expected: `3 passed`; `docs check: OK` (README is not in `REQUIRED`, so nothing is checked yet, which is expected).

```bash
git add scripts/check_docs.py tests/test_check_docs.py docs/pm/README.md
git commit -m "Add PM docs checker and the case-study guided tour

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Artifact 01, opportunity brief

**Files:**
- Create: `docs/pm/01-opportunity-brief.md`

Write the brief with the header block and these sections. Content to include under each (draft it fully; do not leave outlines):

- `## Problem`: A person who owns an AI assistant feature cannot answer who uses it, how intensely, for what, or where it fails, without an engineer writing a one-off script. Restate the Priya scenario from spec Section 4 in four sentences.
- `## Who has it`: PMs and analysts owning an assistant feature; founders with a chatbot; internal-tool owners; university product leads. One sentence each on what they do today.
- `## Evidence`: the four market points from spec Section 2 with their sources as links (daily.dev 2026 benchmark, Vercel primer, Confident AI PM guide, arXiv 2604.16304); plus what incumbents assume (metrics known, code written) and what WildVis is (search and browse, not metrics).
- `## Why now`: 2026 is the year AI features moved from demos to accountability; 35% still measure nothing; evaluation tooling matured for engineers and left product owners behind.
- `## The wedge`: opinionated, PM-facing, metrics-first analytics over conversation logs. Volume, intensity, intent, friction, data quality. One paragraph on why friction as a metric family beats a full eval product for this user.
- `## What we will not do`: the non-goals from spec Section 5, one line each.
- `## Decision requested`: build v1 as specified in the PRD, demonstrated on WildChat, time-boxed to eight working days.

- [ ] **Step 1: Write the document.** - [ ] **Step 2:** `uv run python scripts/check_docs.py` → OK. - [ ] **Step 3: Commit** `git add docs/pm/01-opportunity-brief.md && git commit -m "Add opportunity brief (artifact 01)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

---

### Task 3: Research kit: interview guide, outreach, participants log, and artifact 02 skeleton

**Files:**
- Create: `docs/pm/research/interview-guide.md`, `docs/pm/research/outreach.md`, `docs/pm/research/participants.csv`, `docs/pm/02-user-research.md`

- [ ] **Step 1: Write `docs/pm/research/interview-guide.md`**

```markdown
# Interview guide: owners of AI assistant features

20 minutes. Record only with consent. Take notes as P<n>, never a name.

## Opening (2 min)
Thanks. I'm building a tool for people who own an AI assistant feature and want to understand how it's used. No right answers; I want to hear how you actually work today.

## Context (3 min)
1. What AI feature do you own or analyze, and roughly how many conversations does it handle per week?
2. Who asks you questions about it, and how often?

## Today's process (7 min)
3. Last time someone asked "how is the assistant doing," what did you do, step by step?
4. How long did that take, end to end? Who else was involved?
5. What did you look at: dashboards, SQL, reading transcripts, user complaints?
6. What question could you not answer, or answered with a guess?

## Judgment (5 min)
7. When you read transcripts, how do you decide a conversation went badly?
8. If you could see one number every Monday about the assistant, what would it be?
9. What would make you distrust a number about it?

## Wrap (3 min)
10. If a tool answered "who, how much, for what, where it fails" from your logs, what would still be missing?
11. Can I show you a prototype in a week and get 20 more minutes?

## After the call
Write three verbatim-ish lines, the pain rank (1–5), and one surprise, in `02-user-research.md` under P<n>.
```

- [ ] **Step 2: Write `docs/pm/research/outreach.md`**

```markdown
# Outreach message

Use for LinkedIn, email, Slack, Discord. Adjust the first line to how you know them.

---

Hi <name>, I'm building a small product for people who own an AI assistant feature and need to know how it's actually used and where it fails. You've shipped or analyzed one, so your 20 minutes would shape what I build. No pitch, just questions about how you work today. Any slot this week or next? Happy to share what I learn across everyone I talk to.

---

Targets: 15 sent, 6+ completed. Sources: Rady classmates and alumni working on AI features, LinkedIn 2nd-degree PMs with "AI" or "assistant" in their titles, founders in Discord communities for LLM builders, UCSD staff owning student-facing chatbots.
```

- [ ] **Step 3: Write `docs/pm/research/participants.csv`**

```csv
participant,segment,role_type,contacted_on,status,interview_on
P1,,,,,
```
Segments: `pm`, `analyst`, `founder`, `internal-tool`, `university`. Status: `contacted`, `scheduled`, `done`, `declined`, `no-reply`. No names.

- [ ] **Step 4: Write `docs/pm/02-user-research.md`** with the header block and all required sections. Under `## Research questions` list: How do owners answer usage questions today? How long does it take and who is involved? How do they judge a bad conversation? What number would they watch weekly? What would make them distrust a number? Under `## Method` describe the guide, 20-minute calls, consent, P-ids, the synthesis rule (a pain point counts if 3+ participants raise it unprompted). Under `## Participants` a table with columns P-id, segment, role type, weekly conversation volume band. Under `## What we heard` one subsection per participant, filled in as interviews complete. Under `## Pain points, ranked` a table with columns rank, pain point, participants who raised it, quote. `## What changed in the PRD` and `## Gaps and next steps` start with one honest sentence each about the current interview count and the plan to reach six.

- [ ] **Step 5: Check and commit**

Run: `uv run python scripts/check_docs.py` → OK.
```bash
git add docs/pm/research docs/pm/02-user-research.md
git commit -m "Add interview guide, outreach message, participant log, and research doc skeleton (artifact 02)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Owner action (Shankar, today):** send the outreach to at least 15 people and log them in `participants.csv`.

---

### Task 4: Artifact 03, metrics framework, plus friction labeling kit and precision script

**Files:**
- Create: `docs/pm/03-metrics-framework.md`, `docs/pm/research/friction-labeling-guide.md`, `docs/pm/research/friction_labels.csv`, `scripts/export_friction_sample.py`, `scripts/friction_precision.py`, `tests/test_friction_precision.py`

**Interfaces:**
- `scripts/export_friction_sample.py`: `export(raw_shard: Path, out_csv: Path, n: int = 300, seed: int = 11) -> int`. Reads one raw WildChat shard with DuckDB, picks `n` random conversations with no empty user input and 1 to 6 turns, writes a local-only CSV under `samples/` with columns `conv_id, n_turns, user_turns, assistant_turns` (turns joined with ` ||| `, assistant turns truncated to 400 chars each) followed by blank label columns `got_what_they_came_for, is_repeat, is_correction, is_refusal, notes`. Returns row count. Requires a raw shard kept with `loupe flatten --shards 0 --keep-raw`.
- `docs/pm/research/friction_labels.csv`: the labeled rows with text columns removed: `conv_id, got_what_they_came_for, is_repeat, is_correction, is_refusal, notes`. Values `1`/`0`; `notes` must not contain quotes from the conversation.
- `scripts/friction_precision.py`: `precision(labels: list[dict], flags: dict[int, dict]) -> dict` where `labels` rows come from the CSV and `flags[conv_id] = {"repeated_request": bool, "correction_followup": bool, "assistant_refusal": bool, "one_and_done": bool}` from the flat table. Returns, per proxy, `{"predicted": n, "true_positives": n, "precision": float | None}` plus `"friction_vs_outcome"`: among conversations where any proxy fired, the share where `got_what_they_came_for == 0`. `main()` loads the CSV, queries `data/flat/conversations/*.parquet` for the listed `conv_id`s, prints a Markdown table, and writes `docs/pm/research/friction_precision.json`.

- [ ] **Step 1: Write the failing test**

`tests/test_friction_precision.py`:
```python
from scripts.friction_precision import precision


def test_precision_per_proxy_and_outcome_link():
    labels = [
        {"conv_id": "1", "got_what_they_came_for": "0", "is_repeat": "1", "is_correction": "1", "is_refusal": "1"},
        {"conv_id": "2", "got_what_they_came_for": "1", "is_repeat": "0", "is_correction": "0", "is_refusal": "0"},
        {"conv_id": "3", "got_what_they_came_for": "1", "is_repeat": "0", "is_correction": "0", "is_refusal": "0"},
        {"conv_id": "4", "got_what_they_came_for": "0", "is_repeat": "1", "is_correction": "0", "is_refusal": "0"},
    ]
    flags = {
        1: {"repeated_request": True, "correction_followup": True, "assistant_refusal": True, "one_and_done": False},
        2: {"repeated_request": True, "correction_followup": False, "assistant_refusal": False, "one_and_done": True},
        3: {"repeated_request": False, "correction_followup": False, "assistant_refusal": False, "one_and_done": False},
        4: {"repeated_request": True, "correction_followup": False, "assistant_refusal": False, "one_and_done": False},
    }
    r = precision(labels, flags)
    assert r["repeated_request"] == {"predicted": 3, "true_positives": 2, "precision": 2 / 3}
    assert r["correction_followup"] == {"predicted": 1, "true_positives": 1, "precision": 1.0}
    assert r["assistant_refusal"]["precision"] == 1.0
    # one_and_done has no direct human label; it is judged against the outcome column
    assert r["one_and_done"] == {"predicted": 1, "true_positives": 0, "precision": 0.0}
    # any proxy fired on 1, 2, 4; outcome bad on 1 and 4 -> 2/3
    assert abs(r["friction_vs_outcome"] - 2 / 3) < 1e-9
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_friction_precision.py -q` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement the two scripts**

`scripts/export_friction_sample.py`:
```python
"""Local-only: export 300 conversations with text for hand labeling. Output stays under samples/ (gitignored)."""
from __future__ import annotations

import csv
import sys
from pathlib import Path

import duckdb

LABEL_COLS = ["got_what_they_came_for", "is_repeat", "is_correction", "is_refusal", "notes"]


def export(raw_shard: Path, out_csv: Path, n: int = 300, seed: int = 11) -> int:
    con = duckdb.connect()
    con.execute(f"SELECT setseed({(seed % 1000) / 1000.0})")
    rows = con.execute(f"""
      WITH c AS (
        SELECT conversation, turn FROM read_parquet('{raw_shard}')
        WHERE turn BETWEEN 1 AND 6
          AND NOT list_has_any(list_transform(conversation, m -> struct_extract(m,'role') = 'user' AND trim(coalesce(struct_extract(m,'content'),'')) = ''), [true])
        ORDER BY random() LIMIT {int(n)}
      )
      SELECT struct_extract(conversation[1], 'turn_identifier') AS conv_id, turn,
             list_aggregate(list_transform(list_filter(conversation, m -> struct_extract(m,'role')='user'), m -> struct_extract(m,'content')), 'string_agg', ' ||| ') AS user_turns,
             list_aggregate(list_transform(list_filter(conversation, m -> struct_extract(m,'role')='assistant'), m -> left(struct_extract(m,'content'), 400)), 'string_agg', ' ||| ') AS assistant_turns
      FROM c
    """).fetchall()
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with open(out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["conv_id", "n_turns", "user_turns", "assistant_turns", *LABEL_COLS])
        for r in rows:
            w.writerow([*r, *([""] * len(LABEL_COLS))])
    return len(rows)


if __name__ == "__main__":
    shard = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/raw/data/train-00000-of-00086.parquet")
    print(export(shard, Path("samples/friction_sample.csv")))
```

`scripts/friction_precision.py`:
```python
"""Precision of each friction proxy against hand labels in docs/pm/research/friction_labels.csv."""
from __future__ import annotations

import csv
import json
from pathlib import Path

import duckdb

LABELS = Path("docs/pm/research/friction_labels.csv")
OUT = Path("docs/pm/research/friction_precision.json")
PROXY_TO_LABEL = {"repeated_request": "is_repeat", "correction_followup": "is_correction", "assistant_refusal": "is_refusal"}


def _b(v) -> bool:
    return str(v).strip() in ("1", "true", "True", "yes")


def precision(labels: list[dict], flags: dict[int, dict]) -> dict:
    out: dict = {}
    for proxy, col in PROXY_TO_LABEL.items():
        pred = [row for row in labels if flags.get(int(row["conv_id"]), {}).get(proxy)]
        tp = sum(1 for row in pred if _b(row[col]))
        out[proxy] = {"predicted": len(pred), "true_positives": tp, "precision": (tp / len(pred)) if pred else None}
    pred = [row for row in labels if flags.get(int(row["conv_id"]), {}).get("one_and_done")]
    tp = sum(1 for row in pred if not _b(row["got_what_they_came_for"]))
    out["one_and_done"] = {"predicted": len(pred), "true_positives": tp, "precision": (tp / len(pred)) if pred else None}
    fired = [row for row in labels if any(flags.get(int(row["conv_id"]), {}).values())]
    bad = sum(1 for row in fired if not _b(row["got_what_they_came_for"]))
    out["friction_vs_outcome"] = (bad / len(fired)) if fired else None
    out["n_labels"] = len(labels)
    return out


def main() -> int:
    labels = list(csv.DictReader(open(LABELS, newline="")))
    ids = ",".join(str(int(r["conv_id"])) for r in labels)
    rows = duckdb.sql(f"""SELECT conv_id, repeated_request, correction_followup, assistant_refusal, one_and_done
                          FROM 'data/flat/conversations/*.parquet' WHERE conv_id IN ({ids})""").fetchall()
    flags = {r[0]: {"repeated_request": r[1], "correction_followup": r[2], "assistant_refusal": r[3], "one_and_done": r[4]} for r in rows}
    result = precision(labels, flags)
    OUT.write_text(json.dumps(result, indent=2))
    print("| proxy | predicted | true positives | precision |\n|---|---|---|---|")
    for k in ("repeated_request", "correction_followup", "assistant_refusal", "one_and_done"):
        v = result[k]
        p = "n/a" if v["precision"] is None else f"{v['precision']:.2f}"
        print(f"| {k} | {v['predicted']} | {v['true_positives']} | {p} |")
    print(f"\nShare of friction-flagged conversations where the person did not get what they came for: {result['friction_vs_outcome']:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest tests/test_friction_precision.py -q` → `1 passed`.

- [ ] **Step 5: Write `docs/pm/research/friction-labeling-guide.md`**

```markdown
# Friction labeling guide (300 conversations)

Export: `uv run python scripts/export_friction_sample.py` after `uv run loupe flatten --shards 0 --keep-raw`. Open `samples/friction_sample.csv` in a spreadsheet. Never commit that file.

Label each row. Read all user turns, then the assistant turns.

- `got_what_they_came_for`: 1 if the final assistant turn plausibly satisfies what the person was asking for by the end; 0 if not, or if they gave up. Judge outcome, not politeness.
- `is_repeat`: 1 if any user turn asks for essentially the same thing as the previous user turn.
- `is_correction`: 1 if any user turn tells the assistant it was wrong or off-target.
- `is_refusal`: 1 if any assistant turn declines or deflects the request.
- `notes`: your own words only. No quotes from the conversation.

When done, copy the columns `conv_id, got_what_they_came_for, is_repeat, is_correction, is_refusal, notes` into `docs/pm/research/friction_labels.csv` and run `uv run python scripts/friction_precision.py`. Paste the table into `03-metrics-framework.md` under "Friction proxy validation". A proxy under 0.70 precision is dropped from the dashboard, not softened.
```

Create `docs/pm/research/friction_labels.csv` with the header row only.

- [ ] **Step 6: Write `docs/pm/03-metrics-framework.md`** with the header block and required sections. Content:
  - `## Purpose`: what the analysis metrics are for and that they are distinct from Loupe's own success metrics (link to `04-prd.md`).
  - `## North star`: weekly returning pseudo-users, with the justification and the bias caveat from spec Section 9.
  - `## Metric families`: volume, intensity, intent, friction, data quality, one paragraph each.
  - `## Definitions`: a table with columns metric, grain, definition, SQL file (`loupe/metrics/<name>.sql`), suppression rule. One row per column in each aggregate.
  - `## Known biases`: a table with columns metric, bias source, direction (over/under), what we do about it. Rows at minimum: pseudo-user merging (shared networks) under-counts users and over-states intensity; pseudo-user splitting (devices) over-counts users and under-states return; population skew (free chatbot) affects intent mix; token coverage window; language detection errors; classifier error propagates to intent shares.
  - `## Intent taxonomy`: the ten classes with definitions from `loupe/taxonomy.json`; the procedure used to finalize (hand-read 200 sampled conversations, note ambiguous cases); classifier accuracy and macro-F1 from `aggregates/intent_classifier_report.json` with the 0.85 gate.
  - `## Friction proxy validation`: the four proxies with exact rules (Jaccard 0.6 on word tokens; anchored correction patterns in en, zh, ru, es, fr; anchored refusal patterns in en, zh, ru; one-and-done as one turn with under 200 assistant characters), the labeling procedure, and the precision table pasted from the script.
  - `## Queries`: how to run any definition against the committed aggregates in the dashboard's Query view or with DuckDB locally, with one worked example.

- [ ] **Step 7: Check and commit**

Run: `uv run python scripts/check_docs.py` → OK.
```bash
git add docs/pm/03-metrics-framework.md docs/pm/research scripts/export_friction_sample.py scripts/friction_precision.py tests/test_friction_precision.py
git commit -m "Add metrics framework (artifact 03), friction labeling kit, and precision script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Owner action (Shankar):** label the 300 conversations (about 2 hours), commit `friction_labels.csv`, run the precision script, paste the table.

---

### Task 5: Artifact 04, PRD (v0.1 now, v1.0 after research)

**Files:**
- Create: `docs/pm/04-prd.md`

Write the PRD with the header block (`**Status:** Draft`, and a line `**Version:** 0.1` directly under Status) and the required sections:

- `## Problem`: two paragraphs, from the brief.
- `## Goals` and `## Non-goals`: copy spec Sections 5 verbatim, then add G7: pass all five launch checks.
- `## Personas`: Priya (PM, mid-size SaaS), Dev the analyst (owns SQL, wants to stop being the bottleneck), Sam the founder (no analyst, reads transcripts on weekends). Three lines each: context, job, what "good" looks like.
- `## User stories`: eight stories in "As a … I want … so that …" form, one per job in spec Section 3 plus three for trust and reproducibility.
- `## Requirements`: a table with columns ID, requirement, priority (P0/P1/P2), acceptance check. P0: the five dashboard views, min-cell suppression, caveats on every view, reproducible aggregates from one command, no row-level content served. P1: Query view, coverage banner, dark mode, phone width. P2: MotherDuck-hosted table, safety metrics on the gated dataset, log connectors.
- `## Success metrics`: spec Section 6.1 table and 6.2 guardrails, verbatim.
- `## Launch criteria`: spec Section 6.3 table, verbatim, plus "docs check and report check pass".
- `## Privacy and sensitive data`: spec Section 12 expanded: what the dataset authors did, what Loupe adds (aggregates only, suppression, no content in repo, sample sent to the labeling API is not committed), how a removal request is honored, and why hashed IP is treated as pseudonymous personal data anyway.
- `## Open questions`: charting library (resolved in 06), taxonomy finalization, MotherDuck, whether intent classification should be sample-only if the gate fails.
- `## Decision log`: a table with columns date, decision, alternatives, reason. Seed rows: 2026-09-17 approach 1 over evals product and strategy memo; 2026-09-17 WildChat-4.8M over LMSYS (ungated, newer, token usage); 2026-09-17 stream shards and cache content-free flat tables locally, not `datasets` (15 GB + 42 GB Arrow cache); 2026-09-17 standalone site on GitHub Pages, no shankard.com changes in scope; 2026-09-17 keep a 2000-character `intent_text` locally so classification is one pass; 2026-09-18 labeling model and cost cap (fill from `data/label_run.json`); safety metrics deferred because the public build removed toxic conversations.

After interviews complete, bump to `**Version:** 1.0`, add a row per PRD change under the decision log with the participant ids that motivated it, and mirror those in `02-user-research.md` "What changed in the PRD".

- [ ] **Step 1: Write the document.** - [ ] **Step 2:** `uv run python scripts/check_docs.py` → OK. - [ ] **Step 3: Commit** `git add docs/pm/04-prd.md && git commit -m "Add PRD v0.1 (artifact 04) with success metrics, launch criteria, and decision log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

---

### Task 6: Artifacts 05 and 06, roadmap and dashboard design

**Files:**
- Create: `docs/pm/05-roadmap.md`, `docs/pm/06-dashboard-design.md`

- [ ] **Step 1: Write the roadmap.** `## Now` (v1, this build): everything P0 and P1. `## Next` (30 days): usability test round 2 with in-market users, instrumentation for the in-market metrics in spec 6.1 (export events, caveat retention), a second adapter for a common log format (OpenAI-compatible chat completion logs as JSONL) to prove the schema is not WildChat-specific. `## Later`: MotherDuck-hosted conversation table for shareable SQL, safety metrics on the gated full dataset, LLM-judged quality on a sample, alerts. `## Cut list`: a table with columns item, why cut, what would bring it back. Rows: metric authoring UI, live log ingestion, LLM-as-judge on every response, toxicity rates, per-state maps, user-level drill-down (privacy), a Postgres backend. `## Sequencing rationale`: three paragraphs tied to risk (data first, trust second, reach third).

- [ ] **Step 2: Write the dashboard design.** Invoke the `dataviz` skill before writing. `## Who reads it and when`: Priya on Monday morning, 5 minutes, one question at a time. `## Information hierarchy`: tiles answer "how much" in 3 seconds; one chart per question; caveats always visible; Query for everything else. `## Views`: one paragraph per view stating the question it answers, the charts, and the interaction. `## Wireframes`: ASCII boxes for the Overview and Friction views at desktop and 400 px. `## Interaction rules`: tooltips on every mark, legend always shown, no animation, colors from the palette tokens, percent axes for rates, suppression noted in the chart subtitle. `## Deliberately absent`: maps, per-user tables, raw transcripts, real-time, filters that would create small cells.

- [ ] **Step 3: Check and commit**

Run: `uv run python scripts/check_docs.py` → OK.
```bash
git add docs/pm/05-roadmap.md docs/pm/06-dashboard-design.md
git commit -m "Add roadmap with cut list (artifact 05) and dashboard design (artifact 06)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Report checker (`scripts/check_report.py`)

**Files:**
- Create: `scripts/check_report.py`, `tests/test_check_report.py`

**Interfaces:**
- A `loupe-check` block in Markdown:
  ```
  <!-- loupe-check id=F1-return
  sql: SELECT round(avg(return_rate), 3) FROM 'aggregates/intensity_weekly.parquet' WHERE week < (SELECT max(week) FROM 'aggregates/intensity_weekly.parquet')
  expect: 0.312
  tolerance: 0.0005
  -->
  ```
  `sql` is one line; `expect` is a number or a quoted string; `tolerance` optional (default 0 for strings, 1e-9 for numbers).
- `parse_checks(md_text: str) -> list[dict]` with keys `id, sql, expect, tolerance`.
- `run_checks(checks: list[dict], con: duckdb.DuckDBPyConnection) -> list[dict]` each with `id, expect, actual, ok`.
- `main()` runs on `docs/pm/07-trends-report.md` from the repo root and exits 1 if any check fails or the report contains no checks.

- [ ] **Step 1: Write the failing test**

`tests/test_check_report.py`:
```python
import duckdb

from scripts.check_report import parse_checks, run_checks

MD = """
Return rate averaged 0.5.
<!-- loupe-check id=F1
sql: SELECT avg(x) FROM t
expect: 0.5
-->
Top model is "gpt-4o".
<!-- loupe-check id=F2
sql: SELECT m FROM t ORDER BY x DESC LIMIT 1
expect: "gpt-4o"
-->
<!-- loupe-check id=F3
sql: SELECT sum(x) FROM t
expect: 1.6
tolerance: 0.05
-->
"""


def test_parse_and_run():
    checks = parse_checks(MD)
    assert [c["id"] for c in checks] == ["F1", "F2", "F3"]
    con = duckdb.connect()
    con.execute("CREATE TABLE t AS SELECT * FROM (VALUES (0.25, 'gpt-4'), (0.75, 'gpt-4o'), (0.5, 'gpt-4')) v(x, m)")
    results = run_checks(checks, con)
    assert [r["ok"] for r in results] == [True, True, True]
    assert results[1]["actual"] == "gpt-4o"


def test_failure_is_reported_not_raised():
    con = duckdb.connect()
    con.execute("CREATE TABLE t AS SELECT 1 AS x")
    res = run_checks([{"id": "Z", "sql": "SELECT x FROM t", "expect": 2, "tolerance": 0}], con)
    assert res[0]["ok"] is False and res[0]["actual"] == 1
```

- [ ] **Step 2: Run to verify failure** → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`scripts/check_report.py`:
```python
"""Execute loupe-check blocks in the trends report against committed aggregates."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import duckdb

REPORT = Path("docs/pm/07-trends-report.md")
_BLOCK = re.compile(r"<!--\s*loupe-check\s+id=(?P<id>[\w.-]+)\s*\n(?P<body>.*?)-->", re.S)


def parse_checks(md_text: str) -> list[dict]:
    checks = []
    for m in _BLOCK.finditer(md_text):
        fields = {}
        for line in m.group("body").strip().splitlines():
            k, _, v = line.partition(":")
            fields[k.strip()] = v.strip()
        expect_raw = fields["expect"]
        expect = json.loads(expect_raw) if expect_raw.startswith('"') else float(expect_raw)
        tol = float(fields["tolerance"]) if "tolerance" in fields else (0.0 if isinstance(expect, str) else 1e-9)
        checks.append({"id": m.group("id"), "sql": fields["sql"], "expect": expect, "tolerance": tol})
    return checks


def _ok(expect, actual, tol) -> bool:
    if isinstance(expect, str):
        return str(actual) == expect
    try:
        return abs(float(actual) - float(expect)) <= tol
    except (TypeError, ValueError):
        return False


def run_checks(checks: list[dict], con: duckdb.DuckDBPyConnection) -> list[dict]:
    out = []
    for c in checks:
        try:
            row = con.execute(c["sql"]).fetchone()
            actual = row[0] if row else None
            err = None
        except Exception as e:  # report, never raise: a broken query is a failed check
            actual, err = None, str(e)
        out.append({"id": c["id"], "expect": c["expect"], "actual": actual, "ok": err is None and _ok(c["expect"], actual, c["tolerance"]), "error": err})
    return out


def main() -> int:
    checks = parse_checks(REPORT.read_text())
    if not checks:
        print("report check: no loupe-check blocks found")
        return 1
    results = run_checks(checks, duckdb.connect())
    for r in results:
        flag = "OK " if r["ok"] else "FAIL"
        print(f"{flag} {r['id']}: expected {r['expect']!r}, got {r['actual']!r}" + (f" ({r['error']})" if r["error"] else ""))
    bad = [r for r in results if not r["ok"]]
    print(f"report check: {len(results) - len(bad)}/{len(results)} passed")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests** → `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/check_report.py tests/test_check_report.py
git commit -m "Add report checker that re-runs every cited number against the aggregates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Artifact 07, trends report

**Files:**
- Create: `docs/pm/07-trends-report.md`

Precondition: full aggregates committed (Plan 1 Task 11). Work in the dashboard's Query view or a local DuckDB session over `aggregates/*.parquet` to find the findings, then write.

- [ ] **Step 1: Explore and pick at least five findings.** Candidates to test, in order of expected interest: (a) week-over-week return trend across the model transitions (gpt-3.5 to gpt-4o to gpt-4.1-mini); (b) intent mix shift 2023 to 2025, especially image prompting and coding; (c) friction by intent: which intents fail most, and whether one-and-done differs by model; (d) concentration: top-10% share over time; (e) language and country mix shift; (f) session depth change with reasoning models (o1). Each finding must be about this population, must survive the biases table in artifact 03, and must be something a product owner would act on.

- [ ] **Step 2: Write the report** with the header block and sections. `## Read this first`: the population caveat, the pseudo-user caveat, and what the WildChat paper already reported (language mix, turn counts, toxicity) so the reader knows these findings go beyond it. `## Findings`: one `### F<n>: <plain-English headline>` per finding, each with: the chart (link to the dashboard view and a static PNG exported from the dashboard, saved under `docs/pm/figures/`), two or three sentences of what the data shows, the number(s) inside `loupe-check` blocks, one sentence of implication for a product owner, one sentence of what would falsify it. `## Method`: pipeline summary, taxonomy version, classifier accuracy, suppression rule, link to `03-metrics-framework.md`. `## Limitations`: the biases table rows that matter for these findings. `## What a product owner should do`: five actions, each tied to a finding id.

- [ ] **Step 3: Verify every number**

Run: `uv run python scripts/check_report.py` → `report check: N/N passed`. Run: `uv run python scripts/check_docs.py` → OK.

- [ ] **Step 4: Commit**

```bash
git add docs/pm/07-trends-report.md docs/pm/figures
git commit -m "Add trends report (artifact 07) with machine-checked numbers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Usability test kit and scoring script

**Files:**
- Create: `docs/pm/research/usability-test-script.md`, `docs/pm/research/usability_results.csv`, `docs/pm/research/actionability_survey.csv`, `scripts/score_usability.py`, `tests/test_score_usability.py`

**Interfaces:**
- `usability_results.csv` columns: `participant, question, seconds, correct, caveat_stated_after_test`. One row per participant × question (5 × 5 = 25 rows); `caveat_stated_after_test` is `1`/`0`, repeated on each of the participant's rows.
- `actionability_survey.csv` columns: `respondent, finding_id, would_act` (`1`/`0`).
- `score(results: list[dict], survey: list[dict]) -> dict` returns `{"time_to_answer_median_s", "time_under_120_share", "task_success", "caveat_retention", "actionable_findings": [ids], "actionability_pass": bool, "pass": {check: bool}}` using spec 6.3 targets: median seconds under 120 per question (evaluated as share of questions answered under 120 s at least 0.8), task success at least 0.8, caveat retention at least 0.8, actionability at least 3 findings with majority `would_act`.

- [ ] **Step 1: Write the failing test**

`tests/test_score_usability.py`:
```python
from scripts.score_usability import score


def test_score_targets():
    results = []
    for p in range(1, 6):
        for qn in range(1, 6):
            results.append({"participant": f"P{p}", "question": str(qn), "seconds": "90" if (p, qn) != (5, 5) else "200",
                            "correct": "1" if not (p == 5 and qn in (4, 5)) else "0", "caveat_stated_after_test": "1" if p != 5 else "0"})
    survey = [{"respondent": f"R{r}", "finding_id": f"F{f}", "would_act": "1" if f <= 3 or r == 1 else "0"} for r in range(1, 6) for f in range(1, 6)]
    s = score(results, survey)
    assert s["time_under_120_share"] == 24 / 25 and s["task_success"] == 23 / 25 and s["caveat_retention"] == 4 / 5
    assert s["actionable_findings"] == ["F1", "F2", "F3"] and s["actionability_pass"] is True
    assert all(s["pass"].values())
```

- [ ] **Step 2: Run to verify failure** → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`scripts/score_usability.py`:
```python
"""Score the v1 launch checks (spec 6.3) from the usability and actionability CSVs."""
from __future__ import annotations

import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path

RESULTS = Path("docs/pm/research/usability_results.csv")
SURVEY = Path("docs/pm/research/actionability_survey.csv")
OUT = Path("docs/pm/research/launch_checks.json")


def _b(v) -> bool:
    return str(v).strip() in ("1", "true", "True", "yes")


def score(results: list[dict], survey: list[dict]) -> dict:
    secs = [float(r["seconds"]) for r in results]
    under = sum(1 for s in secs if s < 120) / len(secs)
    success = sum(1 for r in results if _b(r["correct"])) / len(results)
    by_p = {r["participant"]: _b(r["caveat_stated_after_test"]) for r in results}
    caveat = sum(by_p.values()) / len(by_p)
    votes = defaultdict(list)
    for s in survey:
        votes[s["finding_id"]].append(_b(s["would_act"]))
    actionable = sorted(f for f, v in votes.items() if sum(v) > len(v) / 2)
    out = {
        "time_to_answer_median_s": statistics.median(secs),
        "time_under_120_share": under,
        "task_success": success,
        "caveat_retention": caveat,
        "actionable_findings": actionable,
        "actionability_pass": len(actionable) >= 3,
    }
    out["pass"] = {
        "time_to_answer": under >= 0.8,
        "task_success": success >= 0.8,
        "caveat_retention": caveat >= 0.8,
        "actionability": out["actionability_pass"],
    }
    return out


def main() -> int:
    results = list(csv.DictReader(open(RESULTS, newline="")))
    survey = list(csv.DictReader(open(SURVEY, newline="")))
    s = score(results, survey)
    OUT.write_text(json.dumps(s, indent=2))
    for k, v in s["pass"].items():
        print(f"{'PASS' if v else 'FAIL'} {k}")
    print(json.dumps({k: v for k, v in s.items() if k != "pass"}, indent=2))
    return 0 if all(s["pass"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Write `docs/pm/research/usability-test-script.md`**

```markdown
# Usability test script (v1 launch checks)

Five participants from the interview pool. 25 minutes each. Moderated over a video call with screen share, or asynchronous as the fallback in the spec's risk table.

## Setup (3 min)
Open the live dashboard. "I'll ask five questions a product owner might ask about this assistant. Answer each using the dashboard; think aloud; I'll time you but speed is not the point. There are no trick questions."

## Questions (one per job; start the timer when you finish reading; stop when they state an answer)
1. Who: "Which three countries produced the most conversations overall?" (Data quality view)
2. How much: "In the most recent complete week, what share of pseudo-users came back the following week?" (Intensity view; the answer is the second-to-last week's return rate)
3. For what: "Which intent grew the most between 2023 and 2025?" (Intent view)
4. Where it fails: "Which intent has the highest one-and-done rate across all models?" (Friction view table)
5. Defensible: "How many conversations are behind the intent chart, and what is the minimum cell size?" (Data quality tiles)

Record `seconds` and `correct` (1/0) per question in `usability_results.csv`. The correct answers are computed once from the aggregates before the sessions and kept in a private note, not in the repo.

## After the test (4 min)
"Explain the return-rate result to me as if I were your VP." Record `caveat_stated_after_test` = 1 if they mention, unprompted, either that these are pseudo-users (hashes, not accounts) or that the population came from a free public chatbot. Then: "What would you change?" Note verbatim.

## Actionability survey (separate, by message)
Send the five findings from the trends report. For each: "Would you act on this if it were about your assistant? yes/no." Record in `actionability_survey.csv`.
```

Create both CSVs with header rows only.

- [ ] **Step 5: Run tests, commit**

Run: `uv run pytest tests/test_score_usability.py -q` → `1 passed`.
```bash
git add docs/pm/research/usability-test-script.md docs/pm/research/usability_results.csv docs/pm/research/actionability_survey.csv scripts/score_usability.py tests/test_score_usability.py
git commit -m "Add usability test kit and launch-check scoring script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Owner action (Shankar):** run five sessions, fill both CSVs, run `uv run python scripts/score_usability.py`, paste results into `09-retro.md`.

---

### Task 10: Artifacts 08 and 09, strategy memo and retrospective

**Files:**
- Create: `docs/pm/08-strategy-memo.md`, `docs/pm/09-retro.md`

- [ ] **Step 1: Write the strategy memo** for the leadership of a company building a general-purpose AI assistant. Two pages. `## Situation`: what the market and this dataset show about where usage concentrates. `## What the data says`: five bullets citing findings by id from artifact 07. `## Implications`: segments (coding and image prompting behave differently from writing and advice), model mix (where cheaper models hold and where they leak return), where quality investment pays (the intents with the worst friction and the largest volume). `## Recommendations`: three, each with an owner type, a metric, and a 90-day target. `## Risks`: population skew, pseudo-user weakness, classifier error, and what would change the recommendation. `## What I would measure next`: the in-market metrics from the PRD, and the two experiments you would run first.

- [ ] **Step 2: Write the retrospective.** `## What shipped`: list with links and dates. `## What was cut`: from the roadmap cut list, with the reason at the time and whether it was right. `## Launch checks`: the table from `scripts/score_usability.py`, the report check result, the docs check result, the Plan 2 Task 8 checklist results, all with dates. `## What the numbers said`: three sentences on the most surprising finding and the one that did not replicate. `## What was wrong in the PRD`: at least three honest items (for example, a requirement that turned out unnecessary, a metric that could not be measured, an estimate that was off, the five-day plan). `## If I did it again`: the first three things you would do differently.

- [ ] **Step 3: Final checks and commit**

Run: `uv run python scripts/check_docs.py --strict && uv run python scripts/check_report.py && uv run pytest -q`
Expected: all OK.
```bash
git add docs/pm/08-strategy-memo.md docs/pm/09-retro.md
git commit -m "Add strategy memo (artifact 08) and retrospective (artifact 09)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

---

### Task 11: Status pass

- [ ] Shankar reads every document, edits in his own voice, and changes `**Status:**` to `Final` on each. Update `docs/pm/README.md` status to Final last.
- [ ] Run `uv run python scripts/check_docs.py --strict` and `make site`; confirm the live site shows all pages. Push.

---

## Self-review notes

- Spec Section 7 artifact table: Tasks 2, 3, 4, 5, 6, 8, 10 produce artifacts 01 to 09; Task 1 produces the README guided tour. Done-criteria are enforced by `check_docs.py` (structure) and `check_report.py` (numbers).
- Spec Section 6.3 launch checks: measured by `score_usability.py` (Task 9) and the report checker (Task 7). Spec 6.2 friction precision guardrail: Task 4 script and labeling kit.
- Spec Section 13: the 300-label validation and the usability test are here; the reproducibility check is Task 7.
- Privacy: no CSV in the repo carries names or text; labels carry `conv_id` and booleans; the export with text stays in `samples/` (gitignored); the usability answer key is kept out of the repo.
- Type consistency: `friction_precision.precision` expects flag keys matching Plan 1's `CONVERSATIONS` columns (`repeated_request`, `correction_followup`, `assistant_refusal`, `one_and_done`). `check_report` reads aggregates by the file names Plan 1 writes. `score_usability` targets match spec 6.3 values (120 s, 0.8, 0.8, 3 findings).
