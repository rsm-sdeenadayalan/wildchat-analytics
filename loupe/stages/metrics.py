"""Stage 4: run each loupe/metrics/*.sql against the flat tables and write aggregates/."""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from loupe import hf, schema

SQL_DIR = Path(__file__).resolve().parent.parent / "metrics"
METRICS = [
    "volume_daily_model", "volume_weekly_country", "volume_weekly_language",
    "intensity_weekly", "depth_by_model",
    "intent_weekly", "intent_by_model", "intent_by_language",
    "friction_by_intent_model", "friction_weekly", "data_quality_weekly",
]


def register(con: duckdb.DuckDBPyConnection, flat_dir: Path) -> str:
    con.execute(f"CREATE OR REPLACE VIEW conversations AS SELECT * FROM read_parquet('{flat_dir}/conversations/*.parquet')")
    intent_dir = flat_dir / "intent"
    if intent_dir.exists() and any(intent_dir.glob("*.parquet")):
        con.execute(f"CREATE OR REPLACE VIEW intent AS SELECT * FROM read_parquet('{intent_dir}/*.parquet')")
        return "full"
    con.execute("CREATE OR REPLACE VIEW intent AS SELECT NULL::BIGINT AS conv_id, NULL::VARCHAR AS intent, "
                "NULL::FLOAT AS proba_max, NULL::VARCHAR AS shard WHERE false")
    return "none"


def run_sql(con: duckdb.DuckDBPyConnection, name: str, min_cell: int = 20) -> pa.Table:
    sql = (SQL_DIR / f"{name}.sql").read_text().replace("{{min_cell}}", str(int(min_cell)))
    return con.execute(sql).to_arrow_table()


def run(flat_dir: Path = Path("data/flat"), out_dir: Path = Path("aggregates"), min_cell: int = 20) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    coverage = register(con, flat_dir)
    total_bytes = 0
    for name in METRICS:
        table = run_sql(con, name, min_cell)
        path = out_dir / f"{name}.parquet"
        pq.write_table(table, path, compression="zstd")
        total_bytes += path.stat().st_size
        print(f"{name}: {table.num_rows} rows", file=sys.stderr)
    n, dmin, dmax, shards = con.execute(
        "SELECT count(*), min(date), max(date), count(DISTINCT shard) FROM conversations").fetchone()
    report_path = out_dir / "intent_classifier_report.json"
    if coverage == "full" and report_path.exists():
        rep = json.loads(report_path.read_text())
        if rep.get("forced"):
            coverage = "forced_below_threshold"
    meta = {
        "product": "Loupe", "dataset": hf.DATASET, "license": "ODC-By 1.0",
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "conversations": int(n), "shards": int(shards),
        "date_min": dmin.isoformat(), "date_max": dmax.isoformat(),
        "min_cell": int(min_cell), "intent_coverage": coverage,
        "taxonomy_version": json.loads((SQL_DIR.parent / "taxonomy.json").read_text())["version"],
        "aggregate_bytes": total_bytes,
        "population_caveat": "Conversations come from a free public chatbot hosted by the WildChat researchers, not from ChatGPT's own product. Findings describe this population only.",
        "pseudo_user_caveat": "Pseudo-users are a hash of IP, user agent, and accept-language. They merge people behind shared networks and split one person across devices.",
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    con.close()
    if total_bytes > 25 * 1024 * 1024:
        print(f"WARNING aggregates total {total_bytes/1e6:.1f} MB exceeds the 25 MB budget", file=sys.stderr)
    return meta
