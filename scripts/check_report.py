"""Execute loupe-check blocks in the trends report against committed aggregates."""
from __future__ import annotations

import json
import re
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
    if not REPORT.exists():
        print(f"report check: {REPORT} not found")
        return 1
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
