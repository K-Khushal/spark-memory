# Jev (TypeSafe) for Categories

Read on 2026-11-12 from TypeSafe's own documentation. Third-party blogs disagree with each other on rate limits and retention, so only the official pages are used here. Re-read them before the owner turns Jev on.

Sources: [State](https://docs.typesafe.ai/concepts/state), [Choice](https://docs.typesafe.ai/primitives/choice), [System One API](https://docs.typesafe.ai/api/system-one) (OpenAPI at `https://api.typesafe.ai/openapi.json`), [Models](https://docs.typesafe.ai/models), [Images](https://docs.typesafe.ai/images), [Errors](https://docs.typesafe.ai/api/errors), [Legal](https://docs.typesafe.ai/legal), [Privacy policy](https://typesafe.ai/legal/privacy-policy), [Data processing addendum](https://typesafe.ai/legal/data-processing).

## The call

`POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`.

- Request: `model`, `state` (a string, object or array), `questions` (a map of name to question). A Choice question is `{ type: "choice", instructions?, criteria }`, where `criteria` maps each option name to a description (1 to 255 options).
- Response: `answers.<name>` for a Choice has `choice` (the top option), `confidence` and `probabilities` (option to number, summing to about 1); `usage` has `input_tokens` and `output_tokens`.
- Models: `jev-1.14.0` (available from 2026-10-14) and `jev-1.13.0`. `jev-latest` is an alias that moves; a versioned id is accepted and is what to send once a threshold is tuned. No deprecation policy is published.
- Context: 64k tokens a request by default, 32k per question. Body at most 32 MiB.
- Errors: 429 (rate limited) and 529 (overloaded) are retryable; other 4xx are not.

Spark sends one Choice question (`category`) whose options are the built-in Category names, with `state` set to the Memory's text (cut to `INDEXING.maxInputChars`). The state is always described as content, never instructions.

## Facts that decide how Spark uses it

| Fact                                                                                                              | Consequence                                                                                       |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Price $0.042 per million input tokens, output free (images are billed as input).                                  | A Memory costs well under $0.0005; priced in `INDEXING.pricesMicrosPerMTokens`.                   |
| Rate limits are per organisation, set in the console, and not in the docs.                                        | One attempt per Memory, then the embedding fallback; the hourly sweep retries later.              |
| "Jev is not trained on customer requests or responses."                                                           | Matches ADR-0008.                                                                                 |
| No retention period for API inputs is published. Zero data retention is for enterprise customers, by support form. | **Owner decision.** Jev stays off until the owner has accepted or negotiated the terms.           |
| The privacy policy allows "anonymized or aggregated data" use and disclosure of "objectionable content".          | Same decision. AI opt-out Memories never reach it either way (ADR-0011).                          |
| Hosted in the United States.                                                                                      | Mention in the privacy page if it is enabled.                                                     |
| Image input needs the `TypeSafe-Danger-Zone-Images` header, 280 to 1568 px sides, and the docs call it not yet production-ready. | Spark sends text only: an image's description and the text read from it come from Indexing.       |
| The direct API had a waitlist at launch.                                                                          | The key is the owner's to obtain.                                                                 |

## Judging Direct Matches (Noul)

The same System One endpoint, with one **Noul** question per saved item over a shared state (docs: [Noul](https://docs.typesafe.ai/primitives/noul), [State](https://docs.typesafe.ai/concepts/state)). A Noul answer is `answers.<name>.noul`, a probability between 0 and 1 that the statement is true. Spark sends `state: { search, saved: { m0, m1, … } }` (the person's words, then up to 20 Memories as text cut to 700 characters) and `questions.m<n>` = `{ type: "noul", instructions: "Is saved item m<n> what the person described in the search? …", criteria: { true, false } }`. All questions in a request see the same state and are evaluated independently, so one round trip answers every candidate and a search costs one rate-limit hit, not twenty.

- Cost: input tokens are billed once per request as `usage.input_tokens` (the docs do not say whether each question re-reads the state; Spark records what comes back and, when a call fails or is cut off, an estimate). About 4,000 input tokens a search is $0.0002.
- Privacy: the person's query and the text of the Memories judged go to Jev, the same as Categories. AI opt-out Memories and Samples are never sent (`Library.judgingTexts`).
- Direct at `JUDGING.jevThreshold` (0.5), a starting point that cannot be tuned without a key.
- Latency is unpublished. Jev gets what is left of full search's 600 ms (at most 350 ms) and is dropped, never waited for, past that; see evals/README.md → `--latency`.

## Off by default

Jev needs `JEV_API_KEY` and `JEV_ENABLED=true`. Neither is set in this repository or its deployments. Without them (or when a call fails or times out), Categories come from the Memory's embedding compared with each Category's prototype sentence (`CATEGORISING.prototypes`), up to three above a cosine threshold, else Other.

The thresholds (`jevThreshold` 0.2, `embeddingThreshold` 0.45) are untuned starting points: Jev's cannot be tuned until a key exists, and the fallback's needs the real embedding model, which the sample Library's `eval:real` run reports (`Categories` in the report, labels in `evals/categories.json`).
