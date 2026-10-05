-- Friction attributed to the responder answerable for it, turn by turn (loupe/attribution.py).
-- A user turn's repeat or correction is charged to the responder of the assistant turn it reacts to.
-- Turns flattened without attributed_to fall back to the conversation's model, so in WildChat this
-- equals the by-model cut; an orchestrator that logs `responder` per message splits here by sub-assistant.
-- The first user turn reacts to nothing and is excluded. Responders under {{min_cell}} assistant turns are suppressed.
WITH t AS (
  SELECT t.role, t.idx, t.repeats_prev_user, t.is_correction,
         coalesce(t.attributed_to, c.model) AS responder_raw
  FROM turns t JOIN conversations c USING (conv_id)
  WHERE NOT c.has_empty_user_input AND NOT (t.role = 'user' AND t.idx = 1)
), r AS (
  SELECT regexp_replace(regexp_replace(responder_raw, '-(\d{4}-\d{2}-\d{2}|\d{4}|preview)$', ''), '-(\d{4}-\d{2}-\d{2}|\d{4}|preview)$', '') AS responder,
         role, repeats_prev_user, is_correction
  FROM t
)
SELECT responder,
       count(*) FILTER (WHERE role = 'assistant')::BIGINT AS assistant_turns,
       count(*) FILTER (WHERE role = 'user' AND is_correction)::BIGINT AS corrections,
       count(*) FILTER (WHERE role = 'user' AND repeats_prev_user)::BIGINT AS repeats,
       (count(*) FILTER (WHERE role = 'user' AND is_correction))::DOUBLE / nullif(count(*) FILTER (WHERE role = 'assistant'), 0) AS correction_rate,
       (count(*) FILTER (WHERE role = 'user' AND repeats_prev_user))::DOUBLE / nullif(count(*) FILTER (WHERE role = 'assistant'), 0) AS repeat_rate
FROM r GROUP BY responder HAVING count(*) FILTER (WHERE role = 'assistant') >= {{min_cell}}
ORDER BY assistant_turns DESC
