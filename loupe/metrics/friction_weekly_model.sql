-- friction_weekly cut by model family; week × model cells under {{min_cell}} are suppressed.
SELECT week, model_family AS model, count(*)::BIGINT AS conversations,
       avg(repeated_request::INT) AS repeat_rate, avg(one_and_done::INT) AS one_and_done_rate,
       avg(correction_followup::INT) AS correction_rate, avg(assistant_refusal::INT) AS refusal_rate
FROM conversations WHERE NOT has_empty_user_input
GROUP BY ALL HAVING count(*) >= {{min_cell}}
ORDER BY model, week
