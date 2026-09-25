"""Guard: credentials must never enter the repository."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_KEY_LINE = re.compile(r"^\s*(TRITONAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*=\s*\S+", re.M)


def _tracked():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [ROOT / p for p in out.splitlines()]


def test_env_file_is_not_tracked():
    assert not any(p.name == ".env" for p in _tracked())


def test_no_tracked_file_contains_an_api_key_assignment():
    offenders = []
    for p in _tracked():
        if p.suffix in {".parquet", ".png", ".jpg", ".lock"} or not p.is_file():
            continue
        try:
            text = p.read_text(errors="ignore")
        except OSError:
            continue
        if _KEY_LINE.search(text) and "your-key-here" not in text:
            offenders.append(str(p.relative_to(ROOT)))
    assert offenders == [], offenders
