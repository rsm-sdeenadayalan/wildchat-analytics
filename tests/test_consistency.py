"""The committed aggregates must reconcile with each other; this is what keeps every view's numbers in agreement."""
from pathlib import Path

from scripts.check_consistency import check


def test_committed_aggregates_reconcile():
    problems = check(Path("aggregates"))
    assert problems == []
