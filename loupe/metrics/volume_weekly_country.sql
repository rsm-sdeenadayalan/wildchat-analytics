-- Cells below the floor and conversations with no country are not dropped: their
-- total is published per week as a single 'suppressed_or_unknown' row.
WITH kept AS (
  SELECT week, country, count(*)::BIGINT AS conversations, count(DISTINCT pseudo_user)::BIGINT AS pseudo_users
  FROM conversations WHERE country IS NOT NULL
  GROUP BY ALL HAVING count(*) >= {{min_cell}}
), weekly_total AS (
  SELECT week, count(*)::BIGINT AS conversations FROM conversations GROUP BY week
), residual AS (
  SELECT t.week, 'suppressed_or_unknown' AS country,
         (t.conversations - coalesce(k.kept, 0))::BIGINT AS conversations,
         NULL::BIGINT AS pseudo_users
  FROM weekly_total t
  LEFT JOIN (SELECT week, sum(conversations)::BIGINT AS kept FROM kept GROUP BY week) k USING (week)
  WHERE t.conversations - coalesce(k.kept, 0) > 0
)
SELECT * FROM kept UNION ALL SELECT * FROM residual
ORDER BY week, conversations DESC
