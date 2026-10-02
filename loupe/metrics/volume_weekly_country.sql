-- Nothing is dropped silently. Two residual rows per week make the bars sum to the weekly total:
--   'not recorded'  conversations whose logs carry no country at all
--   'small cells'   week × country cells below the {{min_cell}} floor, folded together
WITH kept AS (
  SELECT week, country, count(*)::BIGINT AS conversations, count(DISTINCT pseudo_user)::BIGINT AS pseudo_users
  FROM conversations WHERE country IS NOT NULL
  GROUP BY ALL HAVING count(*) >= {{min_cell}}
), not_recorded AS (
  SELECT week, 'not recorded' AS country, count(*)::BIGINT AS conversations, NULL::BIGINT AS pseudo_users
  FROM conversations WHERE country IS NULL GROUP BY week
), weekly_total AS (
  SELECT week, count(*)::BIGINT AS conversations FROM conversations GROUP BY week
), small_cells AS (
  SELECT t.week, 'small cells' AS country,
         (t.conversations - coalesce(k.kept, 0) - coalesce(u.conversations, 0))::BIGINT AS conversations,
         NULL::BIGINT AS pseudo_users
  FROM weekly_total t
  LEFT JOIN (SELECT week, sum(conversations)::BIGINT AS kept FROM kept GROUP BY week) k USING (week)
  LEFT JOIN not_recorded u USING (week)
  WHERE t.conversations - coalesce(k.kept, 0) - coalesce(u.conversations, 0) > 0
)
SELECT * FROM kept UNION ALL SELECT * FROM not_recorded UNION ALL SELECT * FROM small_cells
ORDER BY week, conversations DESC
