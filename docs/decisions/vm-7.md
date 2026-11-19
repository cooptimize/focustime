## VM-7: A refused Azure answer says enough to explain the next one (Nov 18)

Unnumbered until merge.

| # | Status | Decision |
|---|---|---|
| - | Done | Admin › Health gets no Azure line. Health keeps nothing it could count today's Azure answers from: its rows are the status registry's (DevOps polling, client accounts, telemetry batches sent and dropped, the background passes) and the scheduler's runs, none of which records an Azure answer. Counting them would mean keeping something new, which this step doesn't do. The answers are counted from the logs instead, with the queries in `docs/technical/operations.md`. |
| - | Done | When Azure answers no to any allowed call, the line already logged (`sources/azure/client.ts`, `send`) gains three facts, each one word from a fixed list (`log/logger.ts`): the challenge (from a Bearer WWW-Authenticate's error word only: invalid_token, insufficient_claims, insufficient_scope, other, none), the failure cause (from x-ms-failure-cause: gateway, service, other, none) and the body (json_with_code, json_no_code, not_json, empty). |
| - | Done | Never a header's value beyond those words, never any of the body, never an id, an address or a name. A word not on a list is "other"; the logger itself maps any value off a list to "other" (challenge, cause) or leaves it out (body), so a caller can't widen them. |
| - | Done | An answer of yes logs none of them. |
| - | Done | The closed set is one list (`LOG_FIELDS`), and `log/logger.test.ts` names the three fields and still refuses any other, on the console line and in Application Insights. |
| - | Done | The three facts join the VM-6 queries in `docs/technical/operations.md`, with one query listing refused answers by revision (the console log's `RevisionName_s`, which already names it; no new field) and these facts. |
| - | Done | The body is read once as text and its shape and Azure's code taken from it; the code is what `res.json()` gave before, so the kind, the chip's reason and what each failure returns are unchanged. |
| - | Done | Nothing else changes: the allowed calls (`ALLOWED`), what a refusal does (`failure`), the chip's words, the automatic start. No migration, dependency or new background work. |

