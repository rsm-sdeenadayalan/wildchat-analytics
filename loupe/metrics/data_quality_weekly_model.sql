-- data_quality_weekly cut by model family; week × model cells under {{min_cell}} are suppressed.
SELECT week, model_family AS model, count(*)::BIGINT AS conversations,
       round(avg(redacted::INT) + 0.0, 6) AS redacted_rate,
       round(avg(has_empty_user_input::INT) + 0.0, 6) AS empty_input_rate,
       round(avg((prompt_tokens IS NOT NULL)::INT) + 0.0, 6) AS token_usage_coverage
FROM conversations GROUP BY ALL HAVING count(*) >= {{min_cell}}
ORDER BY model, week
