SELECT c.week, i.intent, count(*)::BIGINT AS conversations
FROM conversations c JOIN intent i USING (conv_id) WHERE i.intent IS NOT NULL
GROUP BY ALL ORDER BY c.week, conversations DESC
