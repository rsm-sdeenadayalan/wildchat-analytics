-- intensity_weekly cut by model family. Return is model retention: a pseudo-user who used
-- model M in week w counts as returned if they used M again in week w+1. Cells with fewer
-- than {{min_cell}} pseudo-users are suppressed.
WITH per_user AS (
  SELECT week, model_family AS model, pseudo_user, count(*) AS convs FROM conversations GROUP BY ALL
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY week, model ORDER BY convs DESC) AS rk,
         count(*) OVER (PARTITION BY week, model) AS users_in_cell,
         sum(convs) OVER (PARTITION BY week, model) AS convs_in_cell
  FROM per_user
), top10 AS (
  SELECT week, model, sum(convs)::DOUBLE / max(convs_in_cell) AS top10_share
  FROM ranked WHERE rk <= greatest(1, ceil(users_in_cell * 0.10)) GROUP BY week, model
), weekly AS (
  SELECT week, model, count(*)::BIGINT AS pseudo_users, sum(convs)::BIGINT AS conversations,
         quantile_cont(convs, 0.5) AS convs_per_user_p50, quantile_cont(convs, 0.9) AS convs_per_user_p90
  FROM per_user GROUP BY week, model
), returning_users AS (
  SELECT a.week, a.model, count(DISTINCT b.pseudo_user)::DOUBLE / count(DISTINCT a.pseudo_user) AS return_rate
  FROM per_user a LEFT JOIN per_user b
    ON b.pseudo_user = a.pseudo_user AND b.model = a.model AND b.week = a.week + INTERVAL 7 DAY
  GROUP BY a.week, a.model
)
SELECT w.week, w.model, w.pseudo_users, w.conversations, w.convs_per_user_p50, w.convs_per_user_p90, t.top10_share,
       (n.week IS NOT NULL) AS next_week_present,
       CASE WHEN n.week IS NULL THEN NULL ELSE r.return_rate END AS return_rate
FROM weekly w JOIN top10 t USING (week, model) JOIN returning_users r USING (week, model)
LEFT JOIN weekly n ON n.model = w.model AND n.week = w.week + INTERVAL 7 DAY
WHERE w.pseudo_users >= {{min_cell}}
ORDER BY w.model, w.week
