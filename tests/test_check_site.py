from pathlib import Path

from scripts.check_site import check


def _write_site(d: Path, app_js: str, index_html: str):
    (d / "site").mkdir()
    (d / "site" / "app.js").write_text(app_js)
    (d / "site" / "index.html").write_text(index_html)
    (d / "aggregates").mkdir()


GOOD_JS = 'import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm";\nexport const AGGREGATES = ["a", "b"];\n'
GOOD_HTML = '<a href="https://huggingface.co/datasets/allenai/WildChat-4.8M">x</a><a href="docs/">d</a>'


def test_passes_on_good_site(tmp_path):
    _write_site(tmp_path, GOOD_JS, GOOD_HTML)
    for n in ["a", "b"]:
        (tmp_path / "aggregates" / f"{n}.parquet").write_bytes(b"")
    assert check(tmp_path / "site", tmp_path / "aggregates", ["a", "b"]) == []


def test_flags_unpinned_foreign_cdn_missing_parquet_and_absolute_paths(tmp_path):
    js = 'import x from "https://unpkg.com/foo";\nimport y from "https://cdn.jsdelivr.net/npm/bar/+esm";\nexport const AGGREGATES = ["a", "c"];\n'
    html = '<script src="/app.js"></script>'
    _write_site(tmp_path, js, html)
    (tmp_path / "aggregates" / "a.parquet").write_bytes(b"")
    problems = check(tmp_path / "site", tmp_path / "aggregates", ["a", "b"])
    joined = "\n".join(problems)
    assert "unpkg.com" in joined
    assert "not pinned" in joined
    assert "AGGREGATES" in joined and "METRICS" in joined
    assert "c.parquet" in joined
    assert 'src="/' in joined
