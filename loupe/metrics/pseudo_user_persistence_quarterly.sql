-- How long a pseudo-user key survives across weeks. The key stops persisting in the
-- later collection window, which is why return rates are not comparable across eras.
WITH per_user AS (
  SELECT date_trunc('quarter', week)::DATE AS quarter, pseudo_user, count(DISTINCT week) AS weeks_active
  FROM conversations GROUP BY ALL
)
SELECT quarter, count(*)::BIGINT AS pseudo_users,
       avg(weeks_active) AS avg_weeks_active,
       avg((weeks_active > 1)::INT) AS share_multi_week
FROM per_user GROUP BY quarter ORDER BY quarter
