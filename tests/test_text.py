from loupe import text


def test_tokens_lowercases_and_splits_unicode():
    assert text.tokens("Hello, WORLD! Привет мир") == {"hello", "world", "привет", "мир"}


def test_jaccard_identical_is_one_and_empty_is_zero():
    assert text.jaccard("a b c", "c b a") == 1.0
    assert text.jaccard("", "a b") == 0.0
    assert text.jaccard("!!!", "a b") == 0.0


def test_is_repeat_uses_threshold():
    assert text.is_repeat("write a poem about the sea", "write a poem about the sea please") is True
    assert text.is_repeat("write a poem about the sea", "fix my python code") is False
    assert text.is_repeat(None, "anything") is False


def test_is_correction_multilingual():
    assert text.is_correction("No, that's not what I asked") is True
    assert text.is_correction("Wrong. I said 2023, not 2022") is True
    assert text.is_correction("不对，我要的是中文") is True
    assert text.is_correction("Нет, неправильно") is True
    assert text.is_correction("Incorrecto, quiero otra cosa") is True
    assert text.is_correction("Non, ce n'est pas ça") is True
    assert text.is_correction("Thanks, now translate it") is False
    assert text.is_correction("Nobody knows") is False


def test_is_refusal_multilingual():
    assert text.is_refusal("I'm sorry, but I can't help with that.") is True
    assert text.is_refusal("As an AI language model, I cannot") is True
    assert text.is_refusal("很抱歉，我无法提供") is True
    assert text.is_refusal("Извините, я не могу") is True
    assert text.is_refusal("Sure! Here is the code:") is False


def test_pseudo_user_is_deterministic_16_hex_and_handles_none():
    a = text.pseudo_user("abc", "Mozilla/5.0", "en-US")
    b = text.pseudo_user("abc", "Mozilla/5.0", "en-US")
    c = text.pseudo_user("abc", "Mozilla/5.0", "fr-FR")
    assert a == b and a != c
    assert len(a) == 16 and int(a, 16) >= 0
    assert text.pseudo_user(None, None, None) == text.pseudo_user("", "", "")


def test_curly_apostrophe_handling():
    # Curly/smart apostrophe (U+2019) in refusal
    assert text.is_refusal("I’m sorry, but I can’t help with that.") is True
    # Curly apostrophe in correction
    assert text.is_correction("That’s not what I asked") is True
    # Verify _AP contains the curly apostrophe character
    assert "’" in text._AP


def test_correction_false_positives_fixed():
    # "No worries" and "No problem" should not match
    assert text.is_correction("No worries, I'll handle it") is False
    assert text.is_correction("No problem, thanks!") is False
    # "Again" in non-correction context should not match
    assert text.is_correction("Again, thank you for the help") is False
    # "No." at start of turn should still match correction pattern
    assert text.is_correction("No. I said 2023, not 2022") is True


def test_refusal_false_positives_fixed():
    # "I can't" in non-refusal context should not match
    assert text.is_refusal("I can't believe how well this worked!") is False
    # "I cannot" with refusal object should match
    assert text.is_refusal("I cannot provide that information.") is True


def test_chinese_correction_edge_cases():
    # "不要客气" (you're welcome) should not match
    assert text.is_correction("不要客气") is False
    # "不是这个" and "不是我要的" should match
    assert text.is_correction("不是这个，我要另一个") is True
