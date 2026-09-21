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
tolerance: 0.15
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
