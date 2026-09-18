import json
from pathlib import Path

import pytest
from loupe.stages import label


def test_taxonomy_has_ten_named_classes():
    tax = json.loads(Path("loupe/taxonomy.json").read_text())
    names = [c["name"] for c in tax["classes"]]
    assert len(names) == 10 and names[0] == "coding" and names[-1] == "other"
    assert label.class_names() == names


def test_estimate_cost_applies_batch_discount():
    # 20k requests, 800 in / 30 out tokens, opus-5 standard $5/$25 per 1M, batch 50%
    est = label.estimate_cost_usd("claude-opus-5", 20000, 800.0, 30.0)
    assert round(est, 2) == round(0.5 * (20000 * 800 * 5 / 1e6 + 20000 * 30 * 25 / 1e6), 2)


def test_estimate_unknown_model_raises():
    with pytest.raises(KeyError):
        label.estimate_cost_usd("gpt-4o", 1, 1.0)


def test_build_request_shape():
    req = label.build_request(1001, "Write a python function", "claude-opus-5", label.system_blocks())
    assert req["custom_id"] == "1001"
    params = req["params"]
    assert params["model"] == "claude-opus-5"
    assert params["max_tokens"] == 64
    schema = params["output_config"]["format"]["schema"]
    assert schema["properties"]["intent"]["enum"] == label.class_names()
    assert params["messages"][0]["content"].endswith("Write a python function")


def test_budget_guard_blocks_over_cap(monkeypatch):
    with pytest.raises(label.BudgetExceeded):
        label.check_budget(estimated_usd=61.0, budget_usd=60.0)
    label.check_budget(estimated_usd=59.0, budget_usd=60.0)
