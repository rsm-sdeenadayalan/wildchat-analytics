SELECT c.model_family AS model, i.intent, count(*)::BIGINT AS conversations
FROM conversations c JOIN intent i USING (conv_id) WHERE i.intent IS NOT NULL
GROUP BY ALL ORDER BY model, conversations DESC
