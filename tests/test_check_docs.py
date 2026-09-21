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
