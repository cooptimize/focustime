// FocusTime dev: subscription "Production Services and Apps" (65be698f-0695-48f4-b322-1aa1c387d5e2), resource group
// FocusTime-dev, Central US. Ids only; secrets live in Key Vault and are never parameters.
using 'main.bicep'

param env = 'dev'
param location = 'centralus'
param adminGroupObjectId = 'b6320a08-7f2f-4902-b2b5-7a99e11c29fc' // FocusTime DB Admins
// Set by the deploy workflow: false only for the very first deploy, before an image and the secrets exist.
param appReady = bool(readEnvironmentVariable('FT_APP_READY', 'true'))
param imageTag = readEnvironmentVariable('FT_IMAGE_TAG', 'latest')
// CV-1 watch period: one replica so shared polling runs every 5 minutes in working hours (0.5 vCPU, 1 GiB: about
// 0.40 USD a day at the idle rate, at most 1.30 at the active rate, more than scale to zero). Afterwards set it back to 0 through the workflow (docs/azure/runbook.md, "Conversations").
param minReplicas = 1
param requestsPoll = 'on'
param entraClientId = '0040169f-a4c9-46d9-bd81-83c31d0d6ff0' // the "FocusTime" registration
param googleClientId = '1059654433254-tdph7ca8a4psvt1sve51mhp6sr5j1re3.apps.googleusercontent.com' // the "FocusTime Web" client
param dataverseUrl = 'https://cooptimize.crm.dynamics.com'
param dataverseTenantId = 'abf29d42-2ea9-422b-b0af-ed7cb5595b7e'
param dataverseClientId = 'bf36f621-3e9f-43f9-ab47-89fb89fe7f4a'
// F1: Send feedback on dev is preview only; deploy-dev's "feedback_live" input switches it on for one test deploy
// (titles start "[dev]"). The next deploy switches it off again. Org, project and feature: main.bicep's defaults.
param feedbackLive = bool(readEnvironmentVariable('FT_FEEDBACK_LIVE', 'false'))
// D522: who registers client chats, from the deploy workflow's FT_ADMINS (the GitHub variable; object ids only).
param admins = readEnvironmentVariable('FT_ADMINS', '')
param adminGroupId = readEnvironmentVariable('FT_ADMIN_GROUP_ID', '')
