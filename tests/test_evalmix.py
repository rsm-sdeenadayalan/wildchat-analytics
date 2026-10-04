from loupe.evalmix import weighted_score


def test_weighted_score_weights_by_usage_and_reports_coverage():
    weights = {"questions": 0.5, "coding": 0.3, "translation": 0.2}
    results = [{"intent": "questions", "score": 0.9}, {"intent": "questions", "score": 0.7}, {"intent": "coding", "score": 0.4}]
    out = weighted_score(results, weights)
    # translation has no results: excluded, coverage stated, score renormalized over covered weight
    assert out["missing_intents"] == ["translation"]
    assert abs(out["covered_weight"] - 0.8) < 1e-12
    assert abs(out["usage_weighted_score"] - (0.5 * 0.8 + 0.3 * 0.4) / 0.8) < 1e-12
    assert abs(out["unweighted_mean"] - (0.9 + 0.7 + 0.4) / 3) < 1e-12
    assert out["per_intent"]["questions"]["n"] == 2


def test_weighted_score_ignores_unknown_intents_and_blank_scores():
    out = weighted_score([{"intent": "zzz", "score": 1}, {"intent": "coding", "score": ""}, {"intent": "coding", "score": "0.5"}], {"coding": 1.0})
    assert out["usage_weighted_score"] == 0.5 and out["per_intent"]["coding"]["n"] == 1
