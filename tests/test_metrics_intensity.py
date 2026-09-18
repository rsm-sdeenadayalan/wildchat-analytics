import datetime as dt

from loupe.stages import metrics, flatten


def test_intensity_weekly(con, tmp_path, mini_shard_path):
    flat = tmp_path / "flat"
    flatten.run(local_paths=[mini_shard_path], out_dir=flat)
    metrics.register(con, flat)
    rows = {r["week"]: r for r in metrics.run_sql(con, "intensity_weekly").to_pylist()}
    w1, w2 = rows[dt.date(2024, 3, 4)], rows[dt.date(2024, 3, 11)]
    # week 1: users U1 (C1, C2), U2 (C3) -> 2 users, 3 convs; both return in week 2 -> return_rate 1.0
    assert w1["pseudo_users"] == 2 and w1["conversations"] == 3
    assert w1["return_rate"] == 1.0
    assert w1["convs_per_user_p50"] == 1.5 and w1["convs_per_user_p90"] == 1.9
    # top 10% of 2 users -> ceil(0.2)=1 user -> U1 with 2 of 3 convs
    assert abs(w1["top10_share"] - 2 / 3) < 1e-9
    # week 2: U1 (C4), U3 (C5), U2 (C6) -> 3 users, none return (no week 3) -> 0.0
    assert w2["pseudo_users"] == 3 and w2["conversations"] == 3 and w2["return_rate"] == 0.0
