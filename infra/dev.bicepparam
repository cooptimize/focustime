// FocusTime dev: subscription "Production Services and Apps" (65be698f-0695-48f4-b322-1aa1c387d5e2), resource group
// FocusTime-dev, Central US. Ids only; secrets live in Key Vault and are never parameters.
using 'main.bicep'

param env = 'dev'
param location = 'centralus'
param adminGroupObjectId = 'b6320a08-7f2f-4902-b2b5-7a99e11c29fc' // FocusTime DB Admins
// Set by the deploy workflow: false only for the very first deploy, before an image and the secrets exist.
param appReady = bool(readEnvironmentVariable('FT_APP_READY', 'true'))
param imageTag = readEnvironmentVariable('FT_IMAGE_TAG', 'latest')
// HK-1: dev scales to zero again. A request wakes it (the default HTTP scale rule); it goes back to zero 300 s after
// the last one. While it sleeps nothing polls: the DevOps checks catch up from their stored watermarks on the next
// start. Prod stays at 1 (prod.bicepparam).
param minReplicas = 0
// ENV-1: the CV-1 watch period is over, so dev reads registered client chats only when someone presses Refresh (with
// their own sign-in). 'on' declares a new watch period: dev then reads every chat every 5 minutes and sorts them with
// AI, and Admin › Status says so. Set it back to 'off' when the period ends (docs/azure/runbook.md).
param requestsPoll = 'off'
param entraClientId = '0040169f-a4c9-46d9-bd81-83c31d0d6ff0' // the "FocusTime" registration
param googleClientId = '1059654433254-tdph7ca8a4psvt1sve51mhp6sr5j1re3.apps.googleusercontent.com' // the "FocusTime Web" client
param dataverseUrl = 'https://cooptimize.crm.dynamics.com'
param dataverseTenantId = 'abf29d42-2ea9-422b-b0af-ed7cb5595b7e'
param dataverseClientId = 'bf36f621-3e9f-43f9-ab47-89fb89fe7f4a'
// D522: who registers client chats, from the deploy workflow's FT_ADMINS (the GitHub variable; object ids only).
param admins = readEnvironmentVariable('FT_ADMINS', '')
param adminGroupId = readEnvironmentVariable('FT_ADMIN_GROUP_ID', '')
// HK-2: the monthly budget (USD) and who its alerts go to (the FT_BUDGET_EMAIL GitHub variable; empty: no budget).
param budgetAmount = 30
param budgetEmail = readEnvironmentVariable('FT_BUDGET_EMAIL', '')
