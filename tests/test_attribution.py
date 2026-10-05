from loupe.attribution import Message, attribute_turns


def test_blame_lands_on_the_responder_whose_reply_the_user_reacted_to():
    convo = [
        Message("user", "Write a haiku about rain"),
        Message("assistant", "Rain taps the window...", responder="writer-bot"),
        Message("user", "Now translate it to French"),
        Message("assistant", "La pluie frappe...", responder="translator-bot"),
        Message("user", "No, that's wrong, the second line is off"),          # correction → translator-bot
        Message("assistant", "Apologies. La pluie tape...", responder="translator-bot"),
        Message("user", "Now translate it to French"),                        # repeats an earlier ask? no: compares to previous user turn only
    ]
    flags = attribute_turns(convo, default_responder="orchestrator")
    assert flags[0].attributed_to is None                     # first user turn reacts to nothing
    assert flags[1].attributed_to == "writer-bot"
    assert flags[2].attributed_to == "writer-bot"             # reacts to the haiku
    assert flags[4].is_correction and flags[4].attributed_to == "translator-bot"
    assert not flags[2].is_correction and not flags[0].is_correction


def test_missing_responder_field_falls_back_to_the_default_and_never_guesses():
    convo = [Message("user", "hi"), Message("assistant", "Hello!"), Message("user", "hi")]
    flags = attribute_turns(convo, default_responder="gpt-4o-mini")
    assert flags[1].attributed_to == "gpt-4o-mini" and flags[2].attributed_to == "gpt-4o-mini"
    assert flags[2].repeats_prev_user is True


def test_refusal_is_flagged_on_the_assistant_turn_itself():
    flags = attribute_turns([Message("user", "Do X"), Message("assistant", "I'm sorry, I cannot help with that.", responder="safety-bot")], "orch")
    assert flags[1].is_refusal and flags[1].attributed_to == "safety-bot"
