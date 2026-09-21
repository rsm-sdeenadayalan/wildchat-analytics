from pathlib import Path

from scripts.build_site import build, render_doc


def test_render_doc_fills_template_and_relative_nav():
    html = render_doc("# My PRD\n\nHello **world**.\n", "My PRD", [("index.html", "Guide"), ("04-prd.html", "My PRD")])
    assert "<title>My PRD — Loupe</title>" in html
    assert "<strong>world</strong>" in html
    assert 'href="index.html"' in html and 'href="../"' in html


def test_build_copies_site_aggregates_and_renders_docs(tmp_path):
    site = tmp_path / "site"; site.mkdir()
    (site / "index.html").write_text("<p>app</p>")
    (site / "app.js").write_text("// js")
    (site / "styles.css").write_text("body{}")
    (site / "doc_template.html").write_text(Path("site/doc_template.html").read_text())
    agg = tmp_path / "aggregates"; agg.mkdir()
    (agg / "x.parquet").write_bytes(b"pq")
    (agg / "meta.json").write_text("{}")
    docs = tmp_path / "docs"; docs.mkdir()
    (docs / "README.md").write_text("# Guide\n\nStart here.")
    (docs / "01-opportunity-brief.md").write_text("# Opportunity brief\n\nWhy.")
    out = tmp_path / "dist"
    result = build(site, agg, docs, out)
    assert (out / "index.html").read_text() == "<p>app</p>"
    assert not (out / "doc_template.html").exists()
    assert (out / "aggregates" / "x.parquet").exists() and (out / "aggregates" / "meta.json").exists()
    assert (out / "docs" / "index.html").exists() and (out / "docs" / "01-opportunity-brief.html").exists()
    assert "Opportunity brief" in (out / "docs" / "index.html").read_text()   # nav lists it
    assert result["pages"] == ["index.html", "01-opportunity-brief.html"]


def test_build_without_docs_writes_fallback_index(tmp_path):
    site = tmp_path / "site"; site.mkdir()
    (site / "index.html").write_text("<p>app</p>")
    (site / "app.js").write_text("// js")
    (site / "styles.css").write_text("body{}")
    (site / "doc_template.html").write_text(Path("site/doc_template.html").read_text())
    agg = tmp_path / "aggregates"; agg.mkdir()
    (agg / "x.parquet").write_bytes(b"pq")
    (agg / "meta.json").write_text("{}")
    out = tmp_path / "dist"
    result = build(site, agg, tmp_path / "missing-docs", out)
    assert (out / "docs" / "index.html").exists()
    assert "Case study pages will appear here" in (out / "docs" / "index.html").read_text()
    assert result["pages"] == []
