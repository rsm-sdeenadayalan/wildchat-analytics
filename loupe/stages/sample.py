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


def allocate(sizes: dict[tuple, int], n: int, min_per_stratum: int) -> dict[tuple, int]:
    """Proportional allocation with a per-stratum floor, capped at stratum size, summing to at most n.
    If the floors alone exceed n, the floor is lowered to max(1, n // len(sizes))."""
    if not sizes or n <= 0:
        return {k: 0 for k in sizes}
    total = sum(sizes.values()) or 1
    floor = min_per_stratum
    if floor * len(sizes) > n:
        floor = max(1, n // len(sizes))
    alloc = {k: min(max(floor, round(n * c / total)), c) for k, c in sizes.items()}
    over = sum(alloc.values()) - n
    for k in sorted(alloc, key=lambda k: -alloc[k]):
        if over <= 0:
            break
        cut = min(over, max(0, alloc[k] - min(floor, sizes[k])))
        alloc[k] -= cut
        over -= cut
    return alloc


def run(n: int = 20000, flat_dir: Path = Path("data/flat"), out_path: Path = Path("samples/intent_sample.parquet"),
        seed: int = 7, min_per_stratum: int = 20) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("SET threads = 1")
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
      SELECT language FROM base GROUP BY language ORDER BY count(*) DESC, language LIMIT 8
    """)
    con.execute("""
      CREATE TEMP TABLE strat AS
      SELECT b.*, CASE WHEN t.language IS NULL THEN 'other' ELSE b.language END AS lang_bucket
      FROM base b LEFT JOIN top_lang t USING (language)
    """)
    sizes_rows = con.execute("""
      SELECT model_family, lang_bucket, quarter, count(*) AS c FROM strat GROUP BY ALL
    """).fetchall()
    sizes = {(mf, lb, q): c for mf, lb, q, c in sizes_rows}
    alloc = allocate(sizes, n, min_per_stratum)
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
