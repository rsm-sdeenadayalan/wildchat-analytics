"""Arrow schemas for the Loupe tables. These are the contract between stages."""
import pyarrow as pa

CONVERSATIONS = pa.schema([
    pa.field("conv_id", pa.int64(), nullable=False),
    pa.field("model", pa.string()),
    pa.field("ts", pa.timestamp("us")),
    pa.field("date", pa.date32()),
    pa.field("week", pa.date32()),
    pa.field("country", pa.string()),
    pa.field("state", pa.string()),
    pa.field("language", pa.string()),
    pa.field("n_turns", pa.int32()),
    pa.field("pseudo_user", pa.string()),
    pa.field("redacted", pa.bool_()),
    pa.field("has_empty_user_input", pa.bool_()),
    pa.field("prompt_tokens", pa.int64(), nullable=True),
    pa.field("completion_tokens", pa.int64(), nullable=True),
    pa.field("first_user_len", pa.int32()),
    pa.field("last_assistant_len", pa.int32()),
    pa.field("repeated_request", pa.bool_()),
    pa.field("correction_followup", pa.bool_()),
    pa.field("assistant_refusal", pa.bool_()),
    pa.field("one_and_done", pa.bool_()),
    pa.field("intent_text", pa.string()),
    pa.field("shard", pa.string()),
])

TURNS = pa.schema([
    pa.field("conv_id", pa.int64(), nullable=False),
    pa.field("idx", pa.int32()),
    pa.field("role", pa.string()),
    pa.field("language", pa.string()),
    pa.field("content_len", pa.int32()),
    pa.field("is_empty", pa.bool_()),
    pa.field("redacted", pa.bool_()),
    pa.field("repeats_prev_user", pa.bool_()),
    pa.field("is_correction", pa.bool_()),
    pa.field("is_refusal", pa.bool_()),
    pa.field("shard", pa.string()),
])

INTENT = pa.schema([
    pa.field("conv_id", pa.int64(), nullable=False),
    pa.field("intent", pa.string()),
    pa.field("proba_max", pa.float32()),
    pa.field("shard", pa.string()),
])

ONE_AND_DONE_MAX_ASSISTANT_CHARS = 200
INTENT_TEXT_MAX_CHARS = 2000
