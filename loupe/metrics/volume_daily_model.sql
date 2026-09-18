SELECT date, model, count(*) AS conversations, sum(n_turns) AS turns,
       sum(prompt_tokens) AS prompt_tokens, sum(completion_tokens) AS completion_tokens,
       count(prompt_tokens) AS conversations_with_tokens
FROM conversations
GROUP BY ALL ORDER BY date, model
