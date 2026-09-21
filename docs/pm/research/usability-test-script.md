# Usability test script (v1 launch checks)

Status: not yet run; the project owner could not recruit participants in the v1 window. The kit is ready for a later round.

Five participants from the interview pool. 25 minutes each. Moderated over a video call with screen share, or asynchronous as the fallback in the spec's risk table.

## Setup (3 min)
Open the live dashboard at https://rsm-sdeenadayalan.github.io/wildchat-analytics/. "I'll ask five questions a product owner might ask about this assistant. Answer each using the dashboard; think aloud; I'll time you but speed is not the point. There are no trick questions."

## Questions (one per job; start the timer when you finish reading; stop when they state an answer)
1. Who: "Which three countries produced the most conversations overall?" (Data quality view)
2. How much: "In the most recent complete week, what share of pseudo-users came back the following week?" (Intensity view; the answer is the second-to-last week's return rate)
3. For what: "Which intent grew the most between 2023 and 2025?" (Intent view)
4. Where it fails: "Which intent has the highest one-and-done rate across all models?" (Friction view table)
5. Defensible: "How many conversations are behind the intent chart, and what is the minimum cell size?" (Data quality tiles)

Record `seconds` and `correct` (1/0) per question in `usability_results.csv`. The correct answers are computed once from the aggregates before the sessions and kept in a private note, not in the repo.

## After the test (4 min)
"Explain the return-rate result to me as if I were your VP." Record `caveat_stated_after_test` = 1 if they mention, unprompted, either that these are pseudo-users (hashes, not accounts) or that the population came from a free public chatbot. Then: "What would you change?" Note verbatim.

## Actionability survey (separate, by message)
Send the five findings from the trends report. For each: "Would you act on this if it were about your assistant? yes/no." Record in `actionability_survey.csv`.
