"""Static checks for the Loupe site: pinned jsDelivr-only CDN, relative paths, aggregates present."""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ALLOWED_PREFIX = "https://cdn.jsdelivr.net/npm/"
ALLOWED_LINKS = ("https://huggingface.co/", "https://opendatacommons.org/", "https://github.com/", "https://arxiv.org/", "https://openreview.net/")
_URL = re.compile(r"https://[^\s\"'`)]+")
_AGG = re.compile(r"AGGREGATES\s*=\s*(\[[^\]]*\])", re.S)
_ABS = re.compile(r'(?:href|src)="/(?!/)')


def check(site_dir: Path, aggregates_dir: Path, metrics_names: list[str]) -> list[str]:
    problems: list[str] = []
    app_js = (site_dir / "app.js").read_text()
    index_html = (site_dir / "index.html").read_text()

    for fname, text in (("app.js", app_js), ("index.html", index_html)):
        for url in _URL.findall(text):
            if url.startswith(ALLOWED_LINKS):
                continue
            if not url.startswith(ALLOWED_PREFIX):
                problems.append(f"{fname}: external URL not on jsDelivr: {url}")
                continue
            pkg = url[len(ALLOWED_PREFIX):].split("/+esm")[0].split("/dist")[0]
            if "@" not in pkg.lstrip("@"):
                problems.append(f"{fname}: CDN package not pinned to a version: {url}")
        for m in _ABS.finditer(text):
            problems.append(f"{fname}: root-absolute path {m.group(0)}")

    m = _AGG.search(app_js)
    if not m:
        problems.append("app.js: AGGREGATES list not found")
        names: list[str] = []
    else:
        names = ast.literal_eval(m.group(1))
        if names != metrics_names:
            problems.append(f"app.js AGGREGATES differs from loupe.stages.metrics.METRICS: {names} vs {metrics_names}")
    for n in names:
        if not (aggregates_dir / f"{n}.parquet").exists():
            problems.append(f"missing aggregates/{n}.parquet")
    return problems


def main() -> int:
    from loupe.stages.metrics import METRICS
    problems = check(Path("site"), Path("aggregates"), METRICS)
    for p in problems:
        print(p)
    print("site check:", "OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
