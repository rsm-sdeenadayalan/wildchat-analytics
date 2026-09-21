from scripts.friction_precision import precision


def test_precision_per_proxy_and_outcome_link():
    labels = [
        {"conv_id": "1", "got_what_they_came_for": "0", "is_repeat": "1", "is_correction": "1", "is_refusal": "1"},
        {"conv_id": "2", "got_what_they_came_for": "1", "is_repeat": "0", "is_correction": "0", "is_refusal": "0"},
        {"conv_id": "3", "got_what_they_came_for": "1", "is_repeat": "0", "is_correction": "0", "is_refusal": "0"},
        {"conv_id": "4", "got_what_they_came_for": "0", "is_repeat": "1", "is_correction": "0", "is_refusal": "0"},
    ]
    flags = {
        1: {"repeated_request": True, "correction_followup": True, "assistant_refusal": True, "one_and_done": False},
        2: {"repeated_request": True, "correction_followup": False, "assistant_refusal": False, "one_and_done": True},
        3: {"repeated_request": False, "correction_followup": False, "assistant_refusal": False, "one_and_done": False},
        4: {"repeated_request": True, "correction_followup": False, "assistant_refusal": False, "one_and_done": False},
    }
    r = precision(labels, flags)
    assert r["repeated_request"] == {"predicted": 3, "true_positives": 2, "precision": 2 / 3}
    assert r["correction_followup"] == {"predicted": 1, "true_positives": 1, "precision": 1.0}
    assert r["assistant_refusal"]["precision"] == 1.0
    # one_and_done has no direct human label; it is judged against the outcome column
    assert r["one_and_done"] == {"predicted": 1, "true_positives": 0, "precision": 0.0}
    # any proxy fired on 1, 2, 4; outcome bad on 1 and 4 -> 2/3
    assert abs(r["friction_vs_outcome"] - 2 / 3) < 1e-9
