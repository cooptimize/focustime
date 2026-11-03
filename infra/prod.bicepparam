// FocusTime prod (A5): subscription "Production Services and Apps"
// (65be698f-0695-48f4-b322-1aa1c387d5e2), resource group FocusTime, Central US.
using 'main.bicep'

param env = 'prod'
param location = 'centralus'
param adminGroupObjectId = 'b6320a08-7f2f-4902-b2b5-7a99e11c29fc' // FocusTime DB Admins
param appReady = bool(readEnvironmentVariable('FT_APP_READY', 'true'))
param imageTag = readEnvironmentVariable('FT_IMAGE_TAG', 'latest')
// deploy-prod.yml: the digest of the image dev built and tested for the chosen commit (D466). Never built for prod.
param imageDigest = readEnvironmentVariable('FT_IMAGE_DIGEST', '')
param sharedRegistry = { name: 'ftdevacr5bthbn', resourceGroup: 'FocusTime-dev' } // dev's registry, AcrPull only
param pullIdentityName = 'ft-prod-pull' // bootstrap.sh --env prod
param sqlMaxVCores = 2
param sqlRetentionDays = 14
param inviteDomains = 'cooptimize.org' // Settings: "Set by your FocusTime admin"
param minReplicas = 1 // the in-process scheduler must keep running for reminders and timer ends
param entraClientId = '0040169f-a4c9-46d9-bd81-83c31d0d6ff0'
param googleClientId = '1059654433254-tdph7ca8a4psvt1sve51mhp6sr5j1re3.apps.googleusercontent.com' // the "FocusTime Web" client
param dataverseUrl = 'https://cooptimize.crm.dynamics.com'
param dataverseTenantId = 'abf29d42-2ea9-422b-b0af-ed7cb5595b7e'
param dataverseClientId = 'bf36f621-3e9f-43f9-ab47-89fb89fe7f4a'
