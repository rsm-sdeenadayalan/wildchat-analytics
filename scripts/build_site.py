"""Assemble dist/: site files, aggregates, and docs/pm/*.md rendered to HTML."""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

import markdown

TEMPLATE_NAME = "doc_template.html"
# Where the markdown sources live on GitHub, for links to files the site does not render (the research kit).
REPO_BLOB = "https://github.com/rsm-sdeenadayalan/wildchat-analytics/blob/main/docs/pm/"
REPO_TREE = "https://github.com/rsm-sdeenadayalan/wildchat-analytics/tree/main/docs/pm/"
_HREF = re.compile(r'href="([^"]*)"')
_EXTERNAL = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|#|//)", re.I)
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


def rewrite_links(body_html: str) -> str:
    """Point the markdown's repo-relative links at what the site actually serves.

    `X.md` becomes `X.html` (README.md becomes index.html, fragments kept); anything under
    `research/` is not rendered, so it links to the file or folder on GitHub instead.
    """

    def fix(m: re.Match) -> str:
        href = m.group(1)
        if _EXTERNAL.match(href):
            return m.group(0)
        path, frag = (href.split("#", 1) + [""])[:2]
        frag = f"#{frag}" if frag else ""
        if path.startswith("research/"):
            return f'href="{(REPO_TREE if path.endswith("/") else REPO_BLOB)}{path}{frag}"'
        if path.lower().endswith(".md"):
            stem = path[:-3]
            path = "index.html" if stem.lower() == "readme" else f"{stem}.html"
        return f'href="{path}{frag}"'

    return _HREF.sub(fix, body_html)


def check_links(out_dir: Path) -> list[str]:
    """Return every relative href in dist/docs/*.html whose target file does not exist."""
    problems: list[str] = []
    docs = out_dir / "docs"
    for page in sorted(docs.glob("*.html")):
        for href in _HREF.findall(page.read_text()):
            if _EXTERNAL.match(href):
                continue
            path = href.split("#", 1)[0]
            if not path:
                continue
            target = (page.parent / path).resolve()
            if path.endswith("/"):
                target = target / "index.html"
            if not target.exists():
                problems.append(f"{page.name}: {href}")
    return problems


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
    body = rewrite_links(_MD.convert(md_text))
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

    dangling = check_links(out_dir)
    if dangling:
        raise RuntimeError("dangling links in rendered docs: " + "; ".join(dangling))

    return {"pages": pages, "aggregates": copied}


def main() -> int:
    result = build()
    print(f"dist/: {len(result['aggregates'])} aggregate files, {len(result['pages'])} doc pages", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
