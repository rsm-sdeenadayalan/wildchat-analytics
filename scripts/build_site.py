"""Assemble dist/: site files, aggregates, and docs/pm/*.md rendered to HTML."""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

import markdown

TEMPLATE_NAME = "doc_template.html"
_MD = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"])

_EMPTY_DOCS_MD = "# Docs\n\nCase study pages will appear here.\n"


def _title(md_text: str, fallback: str) -> str:
    m = re.search(r"^# (.+)$", md_text, re.M)
    return m.group(1).strip() if m else fallback


def _default_template_path() -> Path:
    template = Path("site") / TEMPLATE_NAME
    if template.exists():
        return template
    return Path(__file__).resolve().parent.parent / "site" / TEMPLATE_NAME


def render_doc(
    md_text: str,
    title: str,
    nav: list[tuple[str, str]],
    current: str | None = None,
    template_path: Path | None = None,
) -> str:
    tpl_path = template_path if template_path is not None else _default_template_path()
    tpl = tpl_path.read_text()
    _MD.reset()
    body = _MD.convert(md_text)
    nav_html = " · ".join(
        f'<a href="{href}"{" class=\"current\"" if href == current else ""}>{label}</a>'
        for href, label in nav
    )
    return tpl.replace("{{title}}", title).replace("{{body}}", body).replace("{{nav}}", nav_html)


def build(
    site_dir: Path = Path("site"),
    aggregates_dir: Path = Path("aggregates"),
    docs_dir: Path = Path("docs/pm"),
    out_dir: Path = Path("dist"),
) -> dict:
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    for p in site_dir.iterdir():
        if p.is_file() and p.name != TEMPLATE_NAME:
            shutil.copy2(p, out_dir / p.name)

    (out_dir / "aggregates").mkdir()
    copied = []
    for p in sorted(aggregates_dir.glob("*")):
        if p.suffix in (".parquet", ".json"):
            shutil.copy2(p, out_dir / "aggregates" / p.name)
            copied.append(p.name)

    template_path = site_dir / TEMPLATE_NAME
    (out_dir / "docs").mkdir()

    md_files = sorted(docs_dir.glob("*.md")) if docs_dir.exists() else []
    if not md_files:
        # docs_dir is missing or empty (e.g. docs/pm not merged in yet): drop a
        # minimal index so the header's docs/ link never 404s.
        html = render_doc(_EMPTY_DOCS_MD, "Docs", [], template_path=template_path)
        (out_dir / "docs" / "index.html").write_text(html)
        return {"pages": [], "aggregates": copied}

    readme = [p for p in md_files if p.name.lower() == "readme.md"]
    others = [p for p in md_files if p.name.lower() != "readme.md"]
    ordered = readme + others
    pages = [("index.html" if p.name.lower() == "readme.md" else f"{p.stem}.html") for p in ordered]
    titles = [_title(p.read_text(), p.stem) for p in ordered]
    nav = list(zip(pages, titles))

    for p, page, title in zip(ordered, pages, titles):
        html = render_doc(p.read_text(), title, nav, current=page, template_path=template_path)
        (out_dir / "docs" / page).write_text(html)

    return {"pages": pages, "aggregates": copied}


def main() -> int:
    result = build()
    print(f"dist/: {len(result['aggregates'])} aggregate files, {len(result['pages'])} doc pages", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
