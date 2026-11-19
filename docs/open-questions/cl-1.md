## Cleanup step 1 (CL-1, Nov 7)

- Q-CL1-1: step 2 (`docs/cleanup-step-2.md`) needs the product owner's OK, and a counts-only check of the four user tables and the bytes column on dev and prod first (no existing script reads the hosted databases; CL-1 didn't connect). It is two releases: 2a takes the tables out of `USER_TABLES` and stops the 14-day cleanup, 2b drops.
- Q-CL1-2: the per-client "Delete stored messages" (`requests.purge`) reaches only the shared `teams_messages` since D519; a person's old `chat_messages` and `asks` rows for that client go only with the 14-day rule, Delete my data, or the drop. Asks keep their message past 14 days. Fine to wait for the drop, or should 2a clear them sooner?
- Q-CL1-3: can the org bootstrap's reading of a person's old `[ai]` keys go? It needs the `org_bootstrap_v1` mark confirmed on dev and prod (a read of `org_settings`, scope "meta"). Then `use`, `monthly_cap_usd` and `allowed_clients` can leave the settings model, with the loader ignoring them (BH-1).

