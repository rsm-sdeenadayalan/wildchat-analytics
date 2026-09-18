SELECT i.intent, c.model, count(*) AS conversations,
       avg(c.repeated_request::INT) AS repeat_rate,
       avg(c.one_and_done::INT) AS one_and_done_rate,
       avg(c.correction_followup::INT) AS correction_rate,
       avg(c.assistant_refusal::INT) AS refusal_rate
FROM conversations c JOIN intent i USING (conv_id)
WHERE NOT c.has_empty_user_input AND i.intent IS NOT NULL
GROUP BY ALL HAVING count(*) >= {{min_cell}} ORDER BY i.intent, c.model
