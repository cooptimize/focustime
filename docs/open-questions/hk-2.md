## Costs (HK-2, Nov 5)

- Q-HK2-1: Answered (HK-3, D702, D704): yes. A page counts only while visible with input in the last N minutes (the Rule `org.idle_minutes`, 10 by default, 5 to 60); timer calls are background and never move the server's last use. Was: One open tab kept prod "in use" all night on Nov 4 to 5 (about 150 `/api/action` calls an hour), so the idle rule never let the scheduler sleep: the pollers and the container stayed busy, and before HK-2 the database stayed awake. Count someone as active only while a tab is visible and there has been input in the last N minutes? Not HK-2's step (app code).
- Q-HK2-2: The workbook's views (merges, group-by sums, the Yesterday column) are built from gallery-proven settings but couldn't be rendered from the CLI; check dev's copy after the merge against the PR's expected figures before deploying prod. If a view doesn't sum, the fallback is a second query for that view only.
- Q-HK2-3: The budget alerts go to one person's address (FT_BUDGET_EMAIL) and the resource group Owners. A mail-enabled FocusTime Admins group, or an action group, would reach every admin; worth it once there's more than one?
- Q-HK2-4: The Container Apps free grant is per subscription and shared with every other app in "Production Services and Apps", so prod's container cost depends on what else runs there. Track it in the workbook after Nov 7.

