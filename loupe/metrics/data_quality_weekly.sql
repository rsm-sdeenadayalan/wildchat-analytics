SELECT week, count(*)::BIGINT AS conversations,
       round(avg(redacted::INT) + 0.0, 6) AS redacted_rate,
       round(avg(has_empty_user_input::INT) + 0.0, 6) AS empty_input_rate,
       round(avg((prompt_tokens IS NOT NULL)::INT) + 0.0, 6) AS token_usage_coverage
FROM conversations GROUP BY week ORDER BY week
