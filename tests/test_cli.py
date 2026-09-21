import pyarrow.parquet as pq
from loupe import cli


def test_cli_flatten_local_then_metrics(tmp_path, mini_shard_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert cli.main(["flatten", "--local", str(mini_shard_path)]) == 0
    assert (tmp_path / "data/flat/conversations/mini_wildchat.parquet").exists()
    assert cli.main(["metrics", "--min-cell", "1"]) == 0
    assert pq.read_table(tmp_path / "aggregates/intensity_weekly.parquet").num_rows == 2


def test_cli_no_stage_returns_1():
    assert cli.main([]) == 1


def test_cli_label_exit_codes(monkeypatch):
    from loupe.stages import label

    def canary_failed(**kw):
        raise label.CanaryFailed("canary parse rate 0.10 below 0.9")

    monkeypatch.setattr(label, "run", canary_failed)
    assert cli.main(["label"]) == 5
    monkeypatch.setattr(label, "run", lambda **kw: {"ok": False, "labeled": 1})
    assert cli.main(["label"]) == 4
    monkeypatch.setattr(label, "run", lambda **kw: {"ok": True, "labeled": 4})
    assert cli.main(["label"]) == 0
    monkeypatch.setattr(label, "run", lambda **kw: {"dry": True})  # dry-run log has no "ok"
    assert cli.main(["label", "--dry-run"]) == 0


def test_cli_label_resume_batch_is_passed_through(monkeypatch):
    from loupe.stages import label
    seen = {}
    monkeypatch.setattr(label, "run", lambda **kw: seen.update(kw) or {"ok": True})
    assert cli.main(["label", "--resume-batch", "msgbatch_123"]) == 0
    assert seen["resume_batch_id"] == "msgbatch_123"
