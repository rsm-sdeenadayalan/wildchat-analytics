-- intent_weekly cut by model family; week × model × intent cells under {{min_cell}} are suppressed.
SELECT c.week, c.model_family AS model, i.intent, count(*)::BIGINT AS conversations
FROM conversations c JOIN intent i USING (conv_id) WHERE i.intent IS NOT NULL
GROUP BY ALL HAVING count(*) >= {{min_cell}}
ORDER BY model, c.week, conversations DESC
