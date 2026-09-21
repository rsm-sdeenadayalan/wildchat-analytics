# Friction labeling guide (300 conversations)

Export: `uv run python scripts/export_friction_sample.py` after `uv run loupe flatten --shards 0 --keep-raw`. Open `samples/friction_sample.csv` in a spreadsheet. Never commit that file.

Label each row. Read all user turns, then the assistant turns.

- `got_what_they_came_for`: 1 if the final assistant turn plausibly satisfies what the person was asking for by the end; 0 if not, or if they gave up. Judge outcome, not politeness.
- `is_repeat`: 1 if any user turn asks for essentially the same thing as the previous user turn.
- `is_correction`: 1 if any user turn tells the assistant it was wrong or off-target.
- `is_refusal`: 1 if any assistant turn declines or deflects the request.
- `notes`: your own words only. No quotes from the conversation.

When done, copy the columns `conv_id, got_what_they_came_for, is_repeat, is_correction, is_refusal, notes` into `docs/pm/research/friction_labels.csv` and run `uv run python scripts/friction_precision.py`. Paste the table into `03-metrics-framework.md` under "Friction proxy validation". A proxy under 0.70 precision is dropped from the dashboard, not softened.
