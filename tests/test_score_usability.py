from scripts.score_usability import score


def test_score_targets():
    results = []
    for p in range(1, 6):
        for qn in range(1, 6):
            results.append({"participant": f"P{p}", "question": str(qn), "seconds": "90" if (p, qn) != (5, 5) else "200",
                            "correct": "1" if not (p == 5 and qn in (4, 5)) else "0", "caveat_stated_after_test": "1" if p != 5 else "0"})
    survey = [{"respondent": f"R{r}", "finding_id": f"F{f}", "would_act": "1" if f <= 3 or r == 1 else "0"} for r in range(1, 6) for f in range(1, 6)]
    s = score(results, survey)
    assert s["time_under_120_share"] == 24 / 25 and s["task_success"] == 23 / 25 and s["caveat_retention"] == 4 / 5
    assert s["actionable_findings"] == ["F1", "F2", "F3"] and s["actionability_pass"] is True
    assert all(s["pass"].values())
