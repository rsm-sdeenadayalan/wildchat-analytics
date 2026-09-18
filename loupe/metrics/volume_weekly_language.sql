SELECT week, language, count(*) AS conversations
FROM conversations WHERE language IS NOT NULL
GROUP BY ALL HAVING count(*) >= {{min_cell}} ORDER BY week, conversations DESC
