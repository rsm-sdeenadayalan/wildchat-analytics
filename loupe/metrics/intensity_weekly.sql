WITH per_user AS (
  SELECT week, pseudo_user, count(*) AS convs FROM conversations GROUP BY ALL
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY week ORDER BY convs DESC) AS rk,
         count(*) OVER (PARTITION BY week) AS users_in_week,
         sum(convs) OVER (PARTITION BY week) AS convs_in_week
  FROM per_user
), top10 AS (
  SELECT week, sum(convs)::DOUBLE / max(convs_in_week) AS top10_share
  FROM ranked WHERE rk <= greatest(1, ceil(users_in_week * 0.10)) GROUP BY week
), weekly AS (
  SELECT week, count(*)::BIGINT AS pseudo_users, sum(convs)::BIGINT AS conversations,
         quantile_cont(convs, 0.5) AS convs_per_user_p50, quantile_cont(convs, 0.9) AS convs_per_user_p90
  FROM per_user GROUP BY week
), returning_users AS (
  SELECT a.week, count(DISTINCT b.pseudo_user)::DOUBLE / count(DISTINCT a.pseudo_user) AS return_rate
  FROM per_user a LEFT JOIN per_user b ON b.pseudo_user = a.pseudo_user AND b.week = a.week + INTERVAL 7 DAY
  GROUP BY a.week
)
-- return_rate is only meaningful when the following week exists in the data at all:
-- otherwise a 0.0 would read as total churn rather than as a gap in the collection.
SELECT w.week, w.pseudo_users, w.conversations, w.convs_per_user_p50, w.convs_per_user_p90, t.top10_share,
       (n.week IS NOT NULL) AS next_week_present,
       CASE WHEN n.week IS NULL THEN NULL ELSE r.return_rate END AS return_rate
FROM weekly w JOIN top10 t USING (week) JOIN returning_users r USING (week)
LEFT JOIN weekly n ON n.week = w.week + INTERVAL 7 DAY
ORDER BY w.week
