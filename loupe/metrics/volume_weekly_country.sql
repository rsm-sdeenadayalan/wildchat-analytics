SELECT week, country, count(*) AS conversations, count(DISTINCT pseudo_user) AS pseudo_users
FROM conversations WHERE country IS NOT NULL
GROUP BY ALL HAVING count(*) >= {{min_cell}} ORDER BY week, conversations DESC
