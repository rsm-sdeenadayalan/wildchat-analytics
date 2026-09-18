WITH top_lang AS (SELECT language FROM conversations GROUP BY language ORDER BY count(*) DESC LIMIT 10)
SELECT c.language, i.intent, count(*)::BIGINT AS conversations
FROM conversations c JOIN intent i USING (conv_id) JOIN top_lang USING (language)
WHERE i.intent IS NOT NULL
GROUP BY ALL HAVING count(*) >= {{min_cell}} ORDER BY c.language, conversations DESC
