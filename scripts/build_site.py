"""Assemble dist/: site files, aggregates, and docs/pm/*.md rendered to HTML."""
from __future__ import annotations

import json
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


def story_numbers(aggregates_dir: Path) -> dict | None:
    """The handful of numbers the story page tells, computed from the published aggregates at build time.

    The story page must paint instantly, so it does not load DuckDB; it reads this file instead. Every
    value here is derived from the same parquet files the dashboard queries, so the two cannot disagree.
    """
    import duckdb

    meta_path = aggregates_dir / "meta.json"
    if not meta_path.exists() or not (aggregates_dir / "intensity_weekly.parquet").exists():
        return None
    meta = json.loads(meta_path.read_text())
    con = duckdb.connect()
    t = lambda name: f"'{aggregates_dir / name}.parquet'"  # noqa: E731
    through = meta["complete_weeks_through"]
    total, d0, d1 = con.execute(f"SELECT sum(conversations), min(date), max(date) FROM {t('volume_daily_model')}").fetchone()
    peak = con.execute(f"SELECT max(pseudo_users) FROM {t('intensity_weekly')}").fetchone()[0]
    ret = con.execute(f"SELECT week, return_rate FROM {t('intensity_weekly')} WHERE return_rate IS NOT NULL AND week <= DATE '{through}' ORDER BY week DESC LIMIT 1").fetchone()
    top10 = con.execute(f"SELECT top10_share FROM {t('intensity_weekly')} WHERE week <= DATE '{through}' ORDER BY week DESC LIMIT 1").fetchone()
    countries = con.execute(f"SELECT country, sum(conversations) FROM {t('volume_weekly_country')} WHERE country NOT IN ('not recorded', 'small cells') GROUP BY 1 ORDER BY 2 DESC").fetchall()
    weekly = con.execute(f"SELECT date_trunc('week', date)::DATE, sum(conversations) FROM {t('volume_daily_model')} WHERE date_trunc('week', date) <= DATE '{through}' GROUP BY 1 ORDER BY 1").fetchall()
    intents = []
    if meta.get("intent_coverage") != "none" and (aggregates_dir / "intent_by_model.parquet").exists():
        labeled = con.execute(f"SELECT sum(conversations) FROM {t('intent_by_model')}").fetchone()[0] or 1
        intents = [{"intent": i, "share": n / labeled} for i, n in con.execute(f"SELECT intent, sum(conversations) FROM {t('intent_by_model')} GROUP BY 1 ORDER BY 2 DESC LIMIT 3").fetchall()]
    oad, rep, corr = con.execute(f"""SELECT sum(one_and_done_rate * conversations) / sum(conversations), sum(repeat_rate * conversations) / sum(conversations),
        sum(correction_rate * conversations) / sum(conversations) FROM (
        SELECT * FROM {t('friction_weekly')} WHERE week <= DATE '{through}' ORDER BY week DESC LIMIT 12)""").fetchone()
    worst_repeat = con.execute(f"""SELECT intent, sum(repeat_rate * conversations) / sum(conversations) AS r FROM {t('friction_by_intent_model')}
        WHERE intent <> 'other' GROUP BY intent ORDER BY r DESC LIMIT 1""").fetchone()
    return {
        "conversations": int(total), "date_min": str(d0), "date_max": str(d1), "complete_weeks_through": through,
        "peak_weekly_pseudo_users": int(peak),
        "return_rate": float(ret[1]) if ret else None, "return_week": str(ret[0]) if ret else None,
        "top10_share": float(top10[0]) if top10 and top10[0] is not None else None,
        "n_countries": len(countries), "countries": [{"country": c, "n": int(n)} for c, n in countries[:60]],
        "largest_country": countries[0][0] if countries else None,
        "largest_country_share": (countries[0][1] / total) if countries else None,
        "intents": intents, "one_and_done_recent": float(oad) if oad is not None else None,
        "repeat_recent": float(rep) if rep is not None else None, "correction_recent": float(corr) if corr is not None else None,
        "worst_repeat_intent": worst_repeat[0] if worst_repeat else None, "worst_repeat_rate": float(worst_repeat[1]) if worst_repeat else None,
        "weekly": [[str(w), int(n)] for w, n in weekly],
        "min_cell": meta["min_cell"], "taxonomy_version": meta.get("taxonomy_version"),
        "classifier_accuracy": meta.get("classifier_accuracy"), "classifier_rater_agreement": meta.get("classifier_rater_agreement"),
    }


_ASSET_REF = re.compile(r'((?:href|src)=")((?:\.\./)?(?:styles\.css|story\.css|story\.js|app\.js))(")')


def asset_hash(site_dir: Path, name: str) -> str:
    import hashlib

    return hashlib.sha256((site_dir / name).read_bytes()).hexdigest()[:10]


def bust_assets(html: str, site_dir: Path) -> str:
    """Append a content hash to every local stylesheet and script URL so a changed asset is never served stale."""
    return _ASSET_REF.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={asset_hash(site_dir, m.group(2).removeprefix('../'))}{m.group(3)}", html)


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
            path = href.split("#", 1)[0].split("?", 1)[0]
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
    if (tpl_path.parent / "styles.css").exists():
        tpl = bust_assets(tpl, tpl_path.parent)
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
        if p.name == TEMPLATE_NAME:
            continue
        if p.is_file():
            shutil.copy2(p, out_dir / p.name)
        elif p.is_dir():
            shutil.copytree(p, out_dir / p.name)
    for page in list(out_dir.glob("*.html")) + list(out_dir.glob("*/index.html")):
        page.write_text(bust_assets(page.read_text(), site_dir))

    (out_dir / "aggregates").mkdir()
    copied = []
    for p in sorted(aggregates_dir.glob("*")):
        if p.suffix in (".parquet", ".json"):
            shutil.copy2(p, out_dir / "aggregates" / p.name)
            copied.append(p.name)
    story = story_numbers(aggregates_dir)
    if story is not None:
        (out_dir / "aggregates" / "story.json").write_text(json.dumps(story, separators=(",", ":")))
        copied.append("story.json")

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
