import pyarrow as pa
from loupe import schema


def test_conversations_schema_fields():
    names = schema.CONVERSATIONS.names
    assert names[:3] == ["conv_id", "model", "ts"]
    assert "intent_text" in names and "pseudo_user" in names
    assert schema.CONVERSATIONS.field("conv_id").type == pa.int64()
    assert schema.CONVERSATIONS.field("prompt_tokens").nullable


def test_turns_and_intent_schema_fields():
    assert schema.TURNS.names[:3] == ["conv_id", "idx", "role"]
    assert schema.INTENT.names == ["conv_id", "intent", "proba_max", "shard"]
