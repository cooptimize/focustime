Dry run (stub provider: checks the harness, not the models), 2026-11-06, 1 run(s) per case, 17 cases. Not covered: stories.draft, conversations.update with images, assistant_transcribe.

| Task | Model | Passed | Invalid | Input tokens / run | Output tokens / run | Cost / 1,000 runs | Latency / run |
|---|---|---|---|---|---|---|---|
| test_ai | gpt-6-luna | 1/1 | 0 | 25 | 4 | $0.005 | 0.0 s |
| asks.classify | gpt-6-luna | 3/3 | 0 | 305 | 30 | $0.046 | 0.0 s |
| promises.extract | gpt-6-luna | 3/3 | 0 | 249 | 26 | $0.038 | 0.0 s |
| conversations.update | gpt-6-luna | 2/2 | 0 | 756 | 9 | $0.080 | 0.0 s |
| capture.prepare | gpt-6-luna | 1/1 | 0 | 284 | 27 | $0.042 | 0.0 s |
| conversations.draft_item | gpt-6-luna | 1/1 | 0 | 332 | 41 | $0.054 | 0.0 s |
| conversations.merge_summary | gpt-6-luna | 1/1 | 0 | 177 | 7 | $0.021 | 0.0 s |
| conversations.comment | gpt-6-luna | 1/1 | 0 | 139 | 3 | $0.015 | 0.0 s |
| status_draft | gpt-6-luna | 1/1 | 0 | 215 | 4 | $0.024 | 0.0 s |
| assistant.intent | gpt-6-luna | 2/2 | 0 | 331 | 3 | $0.035 | 0.0 s |
| assistant.answer | gpt-6-luna | 1/1 | 0 | 219 | 4 | $0.024 | 0.0 s |
| test_ai | gpt-6-luna@flex | 1/1 | 0 | 25 | 4 | $0.002 | 0.0 s |
| asks.classify | gpt-6-luna@flex | 3/3 | 0 | 305 | 30 | $0.023 | 0.0 s |
| promises.extract | gpt-6-luna@flex | 3/3 | 0 | 249 | 26 | $0.019 | 0.0 s |
| conversations.update | gpt-6-luna@flex | 2/2 | 0 | 756 | 9 | $0.040 | 0.0 s |
| capture.prepare | gpt-6-luna@flex | 1/1 | 0 | 284 | 27 | $0.021 | 0.0 s |
| conversations.draft_item | gpt-6-luna@flex | 1/1 | 0 | 332 | 41 | $0.027 | 0.0 s |
| conversations.merge_summary | gpt-6-luna@flex | 1/1 | 0 | 177 | 7 | $0.011 | 0.0 s |
| conversations.comment | gpt-6-luna@flex | 1/1 | 0 | 139 | 3 | $0.008 | 0.0 s |
| status_draft | gpt-6-luna@flex | 1/1 | 0 | 215 | 4 | $0.012 | 0.0 s |
| assistant.intent | gpt-6-luna@flex | 2/2 | 0 | 331 | 3 | $0.017 | 0.0 s |
| assistant.answer | gpt-6-luna@flex | 1/1 | 0 | 219 | 4 | $0.012 | 0.0 s |
| test_ai | gpt-5-nano | 1/1 | 0 | 25 | 4 | $0.003 | 0.0 s |
| asks.classify | gpt-5-nano | 3/3 | 0 | 305 | 30 | $0.027 | 0.0 s |
| promises.extract | gpt-5-nano | 3/3 | 0 | 249 | 26 | $0.023 | 0.0 s |
| conversations.update | gpt-5-nano | 2/2 | 0 | 756 | 9 | $0.042 | 0.0 s |
| capture.prepare | gpt-5-nano | 1/1 | 0 | 284 | 27 | $0.025 | 0.0 s |
| conversations.draft_item | gpt-5-nano | 1/1 | 0 | 332 | 41 | $0.033 | 0.0 s |
| conversations.merge_summary | gpt-5-nano | 1/1 | 0 | 177 | 7 | $0.012 | 0.0 s |
| conversations.comment | gpt-5-nano | 1/1 | 0 | 139 | 3 | $0.008 | 0.0 s |
| status_draft | gpt-5-nano | 1/1 | 0 | 215 | 4 | $0.012 | 0.0 s |
| assistant.intent | gpt-5-nano | 2/2 | 0 | 331 | 3 | $0.018 | 0.0 s |
| assistant.answer | gpt-5-nano | 1/1 | 0 | 219 | 4 | $0.013 | 0.0 s |

| Model | Passed | Cost of one pass over every case |
|---|---|---|
| gpt-6-luna | 17/17 | $0.00067 |
| gpt-6-luna@flex | 17/17 | $0.00033 |
| gpt-5-nano | 17/17 | $0.00038 |
