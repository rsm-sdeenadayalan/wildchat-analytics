SELECT week, count(*)::BIGINT AS conversations,
       avg(repeated_request::INT) AS repeat_rate, avg(one_and_done::INT) AS one_and_done_rate,
       avg(correction_followup::INT) AS correction_rate, avg(assistant_refusal::INT) AS refusal_rate
FROM conversations WHERE NOT has_empty_user_input
GROUP BY week ORDER BY week
