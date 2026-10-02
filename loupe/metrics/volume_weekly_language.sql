-- Nothing is dropped silently. Two residual rows per week make the bars sum to the weekly total:
--   'not recorded'  conversations with no detected language
--   'small cells'   week × language cells below the {{min_cell}} floor, folded together
WITH kept AS (
  SELECT week, language, count(*)::BIGINT AS conversations
  FROM conversations WHERE language IS NOT NULL
  GROUP BY ALL HAVING count(*) >= {{min_cell}}
), not_recorded AS (
  SELECT week, 'not recorded' AS language, count(*)::BIGINT AS conversations
  FROM conversations WHERE language IS NULL GROUP BY week
), weekly_total AS (
  SELECT week, count(*)::BIGINT AS conversations FROM conversations GROUP BY week
), small_cells AS (
  SELECT t.week, 'small cells' AS language,
         (t.conversations - coalesce(k.kept, 0) - coalesce(u.conversations, 0))::BIGINT AS conversations
  FROM weekly_total t
  LEFT JOIN (SELECT week, sum(conversations)::BIGINT AS kept FROM kept GROUP BY week) k USING (week)
  LEFT JOIN not_recorded u USING (week)
  WHERE t.conversations - coalesce(k.kept, 0) - coalesce(u.conversations, 0) > 0
)
SELECT * FROM kept UNION ALL SELECT * FROM not_recorded UNION ALL SELECT * FROM small_cells
ORDER BY week, conversations DESC
