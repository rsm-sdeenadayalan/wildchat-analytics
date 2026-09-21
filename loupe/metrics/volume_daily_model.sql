SELECT date, model_family AS model, count(*)::BIGINT AS conversations, sum(n_turns)::BIGINT AS turns,
       sum(prompt_tokens)::BIGINT AS prompt_tokens, sum(completion_tokens)::BIGINT AS completion_tokens,
       count(prompt_tokens)::BIGINT AS conversations_with_tokens
FROM conversations
GROUP BY ALL ORDER BY date, model
