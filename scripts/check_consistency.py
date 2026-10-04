"""Reconcile the published aggregates with each other and with meta.json.

Every number the dashboard shows is derived from these files, so if the files agree with each
other the views cannot disagree. Run after `loupe metrics`; the site build and CI run it too.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb


def check(agg: Path = Path("aggregates")) -> list[str]:
    meta = json.loads((agg / "meta.json").read_text())
    con = duckdb.connect()
    t = lambda name: f"'{agg / name}.parquet'"  # noqa: E731
    problems: list[str] = []

    def expect(label: str, sql: str, want, tol: float = 0):
        got = con.execute(sql).fetchone()[0]
        if got is None or abs(float(got) - float(want)) > tol:
            problems.append(f"{label}: got {got}, expected {want}")

    total = meta["conversations"]
    expect("volume_daily_model sums to meta.conversations", f"SELECT sum(conversations) FROM {t('volume_daily_model')}", total)
    expect("depth_by_model sums to meta.conversations", f"SELECT sum(conversations) FROM {t('depth_by_model')}", total)
    expect("country rows (incl. residuals) sum to meta.conversations", f"SELECT sum(conversations) FROM {t('volume_weekly_country')}", total)
    expect("language rows (incl. residuals) sum to meta.conversations", f"SELECT sum(conversations) FROM {t('volume_weekly_language')}", total)
    expect("intensity_weekly conversations equal weekly volume",
           f"""SELECT count(*) FROM (SELECT date_trunc('week', date)::DATE AS week, sum(conversations) AS n FROM {t('volume_daily_model')} GROUP BY 1) v
               FULL JOIN {t('intensity_weekly')} i USING (week) WHERE v.n IS DISTINCT FROM i.conversations""", 0)
    expect("data_quality_weekly conversations equal weekly volume",
           f"""SELECT count(*) FROM (SELECT date_trunc('week', date)::DATE AS week, sum(conversations) AS n FROM {t('volume_daily_model')} GROUP BY 1) v
               FULL JOIN {t('data_quality_weekly')} d USING (week) WHERE v.n IS DISTINCT FROM d.conversations""", 0)
    expect("friction_weekly excludes exactly the empty-input conversations",
           f"""SELECT max(abs(f.conversations - round(d.conversations * (1 - d.empty_input_rate)))) FROM {t('friction_weekly')} f JOIN {t('data_quality_weekly')} d USING (week)""",
           0, tol=1)
    for cut, whole in (("friction_weekly_model", "friction_weekly"), ("data_quality_weekly_model", "data_quality_weekly")):
        expect(f"{cut} sums over models to {whole}",
               f"""SELECT count(*) FROM (SELECT week, sum(conversations) AS n FROM {t(cut)} GROUP BY week) a
                   FULL JOIN {t(whole)} b USING (week) WHERE a.n IS DISTINCT FROM b.conversations""", 0)
    expect("intensity_weekly_model conversations never exceed the model's weekly volume",
           f"""SELECT count(*) FROM {t('intensity_weekly_model')} i JOIN
               (SELECT date_trunc('week', date)::DATE AS week, model, sum(conversations) AS n FROM {t('volume_daily_model')} GROUP BY 1, 2) v USING (week, model)
               WHERE i.conversations <> v.n""", 0)
    if meta.get("intent_coverage") != "none":
        labeled = meta["intent_labeled_conversations"]
        expect("intent_by_model sums to labeled conversations", f"SELECT sum(conversations) FROM {t('intent_by_model')}", labeled)
        expect("intent_weekly sums to labeled conversations", f"SELECT sum(conversations) FROM {t('intent_weekly')}", labeled)
        expect("intent_weekly_model never exceeds intent_weekly per week",
               f"""SELECT count(*) FROM (SELECT week, sum(conversations) AS n FROM {t('intent_weekly_model')} GROUP BY week) a
                   JOIN (SELECT week, sum(conversations) AS n FROM {t('intent_weekly')} GROUP BY week) b USING (week) WHERE a.n > b.n""", 0)
    expect("era-restricted friction cells never exceed the all-time cell for the same intent and model",
           f"""SELECT count(*) FROM {t('friction_by_intent_model_era')} e JOIN {t('friction_by_intent_model')} a USING (intent, model)
               WHERE e.conversations > a.conversations""", 0)
    expect("every rate column is within [0, 1]",
           f"""SELECT count(*) FROM (
               SELECT repeat_rate r FROM {t('friction_weekly')} UNION ALL SELECT one_and_done_rate FROM {t('friction_weekly')}
               UNION ALL SELECT correction_rate FROM {t('friction_weekly')} UNION ALL SELECT refusal_rate FROM {t('friction_weekly')}
               UNION ALL SELECT return_rate FROM {t('intensity_weekly')} UNION ALL SELECT top10_share FROM {t('intensity_weekly')}
               UNION ALL SELECT return_rate FROM {t('intensity_weekly_model')} UNION ALL SELECT top10_share FROM {t('intensity_weekly_model')}
               UNION ALL SELECT redacted_rate FROM {t('data_quality_weekly')} UNION ALL SELECT token_usage_coverage FROM {t('data_quality_weekly')}
           ) WHERE r IS NOT NULL AND (r < 0 OR r > 1)""", 0)
    expect("return_rate is NULL exactly when the next week is absent",
           f"SELECT count(*) FROM {t('intensity_weekly')} WHERE (return_rate IS NULL) <> (NOT next_week_present)", 0)
    expect("complete_weeks_through is the last Monday whose week is fully inside the data",
           f"SELECT count(*) FROM {t('intensity_weekly')} WHERE week = DATE '{meta['complete_weeks_through']}'", 1)
    return problems


def main() -> int:
    problems = check()
    for p in problems:
        print(f"MISMATCH {p}", file=sys.stderr)
    print(f"consistency check: {'OK' if not problems else f'{len(problems)} mismatch(es)'}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
