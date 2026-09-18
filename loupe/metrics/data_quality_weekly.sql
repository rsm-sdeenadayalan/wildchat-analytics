SELECT week, count(*) AS conversations,
       avg(redacted::INT) AS redacted_rate,
       avg(has_empty_user_input::INT) AS empty_input_rate,
       avg((prompt_tokens IS NOT NULL)::INT) AS token_usage_coverage
FROM conversations GROUP BY week ORDER BY week
