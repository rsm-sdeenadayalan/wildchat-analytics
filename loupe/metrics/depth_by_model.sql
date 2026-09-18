SELECT model,
       CASE WHEN n_turns = 1 THEN '1' WHEN n_turns = 2 THEN '2' WHEN n_turns <= 5 THEN '3-5'
            WHEN n_turns <= 10 THEN '6-10' ELSE '11+' END AS depth_bucket,
       count(*) AS conversations, median(n_turns) AS median_turns
FROM conversations GROUP BY ALL ORDER BY model, depth_bucket
