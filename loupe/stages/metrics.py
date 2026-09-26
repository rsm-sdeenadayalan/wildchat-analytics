"""Stage 4: run each loupe/metrics/*.sql against the flat tables and write aggregates/."""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from loupe import hf

SQL_DIR = Path(__file__).resolve().parent.parent / "metrics"
METRICS = [
    "volume_daily_model", "volume_weekly_country", "volume_weekly_language",
    "intensity_weekly", "pseudo_user_persistence_quarterly", "depth_by_model",
    "intent_weekly", "intent_by_model", "intent_by_language",
    "friction_by_intent_model", "friction_weekly", "data_quality_weekly",
]


# Two passes, mirroring loupe.stages.sample.model_family, so slices read as families
# (gpt-4o) rather than as dated point releases (gpt-4o-2024-05-13).
_MODEL_FAMILY_SQL = (
    r"regexp_replace(regexp_replace(model, '-(\d{4}-\d{2}-\d{2}|\d{4}|preview)$', ''), "
    r"'-(\d{4}-\d{2}-\d{2}|\d{4}|preview)$', '') AS model_family"
)


def register(con: duckdb.DuckDBPyConnection, flat_dir: Path) -> str:
    con.execute(f"CREATE OR REPLACE VIEW conversations AS SELECT *, {_MODEL_FAMILY_SQL} "
                f"FROM read_parquet('{flat_dir}/conversations/*.parquet')")
    intent_dir = flat_dir / "intent"
    if intent_dir.exists() and any(intent_dir.glob("*.parquet")):
        con.execute(f"CREATE OR REPLACE VIEW intent AS SELECT * FROM read_parquet('{intent_dir}/*.parquet')")
        conv_shards = {r[0] for r in con.execute("SELECT DISTINCT shard FROM conversations").fetchall()}
        intent_shards = {r[0] for r in con.execute("SELECT DISTINCT shard FROM intent").fetchall()}
        # "full" means every flattened shard has intent predictions, not merely that some file exists.
        return "full" if intent_shards == conv_shards else "partial"
    con.execute("CREATE OR REPLACE VIEW intent AS SELECT NULL::BIGINT AS conv_id, NULL::VARCHAR AS intent, "
                "NULL::FLOAT AS proba_max, NULL::VARCHAR AS shard WHERE false")
    return "none"


def complete_weeks(date_min: dt.date, date_max: dt.date) -> tuple[dt.date | None, dt.date | None]:
    """First and last week (Monday) that is fully inside [date_min, date_max]."""
    first = date_min + dt.timedelta(days=(7 - date_min.weekday()) % 7)
    last = date_max - dt.timedelta(days=date_max.weekday())
    if last + dt.timedelta(days=6) > date_max:
        last -= dt.timedelta(days=7)
    if first + dt.timedelta(days=6) > date_max or last < first:
        return None, None
    return first, last


POPULATION_CAVEAT = ("Conversations come from a free public chatbot hosted by the WildChat researchers, not from "
                     "ChatGPT's own product. Findings describe this population only.")
PSEUDO_USER_CAVEAT = ("Pseudo-users are a hash of IP, user agent, and accept-language. They merge people behind "
                      "shared networks and split one person across devices.")


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
    labeled = con.execute("SELECT count(*) FROM intent WHERE intent IS NOT NULL").fetchone()[0]
    token_first_week = con.execute(
        "SELECT min(week) FROM conversations WHERE prompt_tokens IS NOT NULL").fetchone()[0]
    week_from, week_through = complete_weeks(dmin, dmax)
    report_path = out_dir / "intent_classifier_report.json"
    rep = json.loads(report_path.read_text()) if report_path.exists() else {}
    if coverage == "full" and rep.get("forced"):
        coverage = "forced_below_threshold"
    caveats = [
        POPULATION_CAVEAT, PSEUDO_USER_CAVEAT,
        "return_rate is NULL for weeks whose following week is absent from the data, including the final week.",
        "Pseudo-user persistence across weeks changes sharply around 2024-10 "
        "(see pseudo_user_persistence_quarterly); return rates are not comparable across that boundary.",
    ]
    meta = {
        "product": "Loupe", "dataset": hf.DATASET, "license": "ODC-By 1.0",
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "conversations": int(n), "shards": int(shards),
        "date_min": dmin.isoformat(), "date_max": dmax.isoformat(),
        "complete_weeks_from": week_from.isoformat() if week_from else None,
        "complete_weeks_through": week_through.isoformat() if week_through else None,
        "min_cell": int(min_cell), "intent_coverage": coverage,
        "intent_labeled_conversations": int(labeled),
        "intent_share": (int(labeled) / int(n)) if n else 0.0,
        "token_coverage_first_week": token_first_week.isoformat() if token_first_week else None,
        "token_coverage_note": "Token usage fields are present for a minority of conversations from that week "
                               "onward; use conversations_with_tokens to normalize.",
        "taxonomy_version": json.loads((SQL_DIR.parent / "taxonomy.json").read_text())["version"],
        "aggregate_bytes": total_bytes,
        "population_caveat": POPULATION_CAVEAT,
        "pseudo_user_caveat": PSEUDO_USER_CAVEAT,
        "caveats": caveats,
    }
    for key in ("classifier_accuracy", "classifier_macro_f1", "classifier_threshold", "classifier_threshold_requested",
                "classifier_threshold_rule", "classifier_forced", "classifier_taxonomy_version", "classifier_n_test",
                "classifier_rater_agreement", "classifier_rater_study_n"):
        src = key.removeprefix("classifier_")
        if src in rep:
            meta[key] = rep[src]
    if "per_class" in rep:
        meta["classifier_per_class_f1"] = {c: round(v["f1"], 3) for c, v in rep["per_class"].items()}
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    con.close()
    if total_bytes > 25 * 1024 * 1024:
        print(f"WARNING aggregates total {total_bytes/1e6:.1f} MB exceeds the 25 MB budget", file=sys.stderr)
    return meta
