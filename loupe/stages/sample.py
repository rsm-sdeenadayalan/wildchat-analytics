"""Stage 2: stratified sample of conversations for intent labeling."""
from __future__ import annotations

import re
from pathlib import Path

import duckdb

_VERSION_SUFFIX = re.compile(r"-(\d{4}-\d{2}-\d{2}|\d{4}|preview|\d{4}-preview)$")


def model_family(model: str) -> str:
    m = model or ""
    prev = None
    while prev != m:
        prev, m = m, _VERSION_SUFFIX.sub("", m)
    return m


def run(n: int = 20000, flat_dir: Path = Path("data/flat"), out_path: Path = Path("samples/intent_sample.parquet"),
        seed: int = 7, min_per_stratum: int = 20) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.create_function("model_family", model_family, [str], str)
    con.execute(f"SELECT setseed({(seed % 1000) / 1000.0})")
    con.execute(f"""
      CREATE TEMP TABLE base AS
      SELECT conv_id, model_family(model) AS model_family, language, date_trunc('quarter', ts)::DATE AS quarter, intent_text
      FROM read_parquet('{flat_dir}/conversations/*.parquet')
      WHERE NOT has_empty_user_input AND length(intent_text) >= 5
    """)
    con.execute("""
      CREATE TEMP TABLE top_lang AS
      SELECT language FROM base GROUP BY language ORDER BY count(*) DESC LIMIT 8
    """)
    con.execute("""
      CREATE TEMP TABLE strat AS
      SELECT b.*, CASE WHEN t.language IS NULL THEN 'other' ELSE b.language END AS lang_bucket
      FROM base b LEFT JOIN top_lang t USING (language)
    """)
    sizes = con.execute("""
      SELECT model_family, lang_bucket, quarter, count(*) AS c FROM strat GROUP BY ALL
    """).fetchall()
    total = sum(r[3] for r in sizes) or 1
    alloc = {}
    for mf, lb, q, c in sizes:
        want = max(min_per_stratum, round(n * c / total))
        alloc[(mf, lb, q)] = min(want, c)
    # trim proportionally if floors pushed us over n
    over = sum(alloc.values()) - n
    if over > 0:
        for key in sorted(alloc, key=lambda k: -alloc[k]):
            if over <= 0:
                break
            cut = min(over, max(0, alloc[key] - min_per_stratum))
            alloc[key] -= cut
            over -= cut
    con.execute("CREATE TEMP TABLE alloc (model_family VARCHAR, lang_bucket VARCHAR, quarter DATE, k INTEGER)")
    con.executemany("INSERT INTO alloc VALUES (?, ?, ?, ?)", [(k[0], k[1], k[2], v) for k, v in alloc.items()])
    con.execute(f"""
      COPY (
        SELECT conv_id, model_family, lang_bucket, quarter, intent_text
        FROM (
          SELECT s.*, row_number() OVER (PARTITION BY s.model_family, s.lang_bucket, s.quarter ORDER BY random()) AS rn, a.k
          FROM strat s JOIN alloc a USING (model_family, lang_bucket, quarter)
        ) WHERE rn <= k
      ) TO '{out_path}' (FORMAT PARQUET)
    """)
    count = con.execute(f"SELECT count(*) FROM read_parquet('{out_path}')").fetchone()[0]
    con.close()
    return int(count)
