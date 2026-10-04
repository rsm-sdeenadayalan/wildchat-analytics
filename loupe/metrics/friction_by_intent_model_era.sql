-- Friction by intent and model family, restricted to the two windows in which more than one model
-- served traffic at the same time. Only inside such a window can two models be compared on the same
-- population and period; across windows the population itself changed (trends report, F3).
--   era A  2023-04-09 .. 2024-05-06  gpt-3.5-turbo and gpt-4 side by side
--   era B  2024-09-12 .. 2025-01-05  gpt-4o, gpt-4o-mini, o1 and o1-mini side by side
-- Cells under {{min_cell}} conversations are suppressed. Empty-input conversations are excluded, as in friction_weekly.
WITH eras AS (
  SELECT 'A' AS era, DATE '2023-04-09' AS d0, DATE '2024-05-06' AS d1
  UNION ALL SELECT 'B', DATE '2024-09-12', DATE '2025-01-05'
)
SELECT e.era, e.d0 AS era_start, e.d1 AS era_end, i.intent, c.model_family AS model, count(*)::BIGINT AS conversations,
       avg(c.repeated_request::INT) AS repeat_rate,
       avg(c.one_and_done::INT) AS one_and_done_rate,
       avg(c.correction_followup::INT) AS correction_rate,
       avg(c.assistant_refusal::INT) AS refusal_rate
FROM conversations c JOIN intent i USING (conv_id) JOIN eras e ON c.date BETWEEN e.d0 AND e.d1
WHERE NOT c.has_empty_user_input AND i.intent IS NOT NULL
GROUP BY ALL HAVING count(*) >= {{min_cell}}
ORDER BY e.era, i.intent, model
