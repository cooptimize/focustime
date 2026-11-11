// FocusTime on Azure: one resource group per environment (FocusTime-dev, FocusTime for prod), names ft-<env>-<resource>.
// Deployed by .github/workflows/deploy-<env>.yml with a federated identity; see docs/azure/runbook.md.
targetScope = 'resourceGroup'

@allowed([ 'dev', 'prod' ])
param env string
param location string = resourceGroup().location
param tenantId string = subscription().tenantId
@description('Object id of the Entra security group "FocusTime DB Admins" (SQL admin, Key Vault Secrets Officer).')
param adminGroupObjectId string
param adminGroupName string = 'FocusTime DB Admins'
@description('false on the very first deploy (placeholder image, before the image and secrets exist); true after.')
param appReady bool = true
param imageTag string = 'latest'
@description('A5: prod deploys the exact image dev tested, by digest (sha256:...); empty uses imageTag.')
param imageDigest string = ''
@description('A5: prod pulls from dev\'s registry ({ name, resourceGroup }) with a pull identity; empty: its own registry (dev).')
param sharedRegistry object = {}
@description('A5: the user-assigned identity (in this resource group) that pulls from the shared registry; made by bootstrap.sh.')
param pullIdentityName string = ''
@description('HK-2: the SQL database\'s DTU Standard tier (dev S0, prod S1) and A5\'s days of point-in-time restore.')
@allowed([ 'S0', 'S1', 'S2', 'S3' ])
param sqlSku string = 'S0'
param sqlRetentionDays int = 7
@description('A5: the only domains help invites may go to, for everyone (comma list); empty: each person\'s work email.')
param inviteDomains string = ''
@description('D522: Entra object ids of the people who register client chats (comma list); empty: nobody. From the FT_ADMINS GitHub variable.')
param admins string = ''
@description('ADM-1: the "FocusTime Admins" Entra security group\'s object id; its members are admins. From the FT_ADMIN_GROUP_ID GitHub variable (infra/scripts/admin-group.sh prints it).')
param adminGroupId string = ''
@description('F1, FB-1: Send feedback creates stories in this DevOps organization and project, under this feature, with each person\'s own write PAT.')
param feedbackOrg string = 'cooptimize'
param feedbackProject string = 'Cooptimize Internal'
param feedbackParentId string = '496'
@description('CV-1: shared polling of client chats in the background. ENV-1: on by default only in prod; elsewhere \'on\' declares a watch period.')
@allowed(['on', 'off'])
param requestsPoll string = env == 'prod' ? 'on' : 'off'
@description('HK-2: the monthly budget in USD for this resource group (dev 30, prod 60).')
param budgetAmount int
@description('HK-2: who gets the budget alerts, from the FT_BUDGET_EMAIL GitHub variable (never in the repo); empty: no budget.')
param budgetEmail string = ''
@description('dev 0 (scale to zero); prod 1 so the scheduler keeps running.')
param minReplicas int
param entraClientId string
param googleClientId string
param dataverseUrl string
param dataverseTenantId string
param dataverseClientId string

var prefix = 'ft-${env}'
var tags = { app: 'focustime', env: env }
// Globally unique names: ACR allows letters and digits only, Key Vault and SQL servers are global DNS names.
var suffix = take(uniqueString(resourceGroup().id), 6)

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: { prefix: prefix, location: location, tags: tags }
}

var shared = !empty(sharedRegistry)
module registry 'modules/registry.bicep' = if (!shared) {
  name: 'registry'
  params: { name: 'ft${env}acr${suffix}', location: location, tags: tags }
}
var registryName = shared ? sharedRegistry.name : 'ft${env}acr${suffix}'

module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    name: '${prefix}-kv-${suffix}'
    location: location
    tags: tags
    tenantId: tenantId
    adminGroupObjectId: adminGroupObjectId
    workspaceId: monitoring.outputs.workspaceId
  }
}

module sql 'modules/sql.bicep' = {
  name: 'sql'
  params: {
    name: '${prefix}-sql-${suffix}'
    location: location
    tags: tags
    tenantId: tenantId
    adminGroupName: adminGroupName
    adminGroupObjectId: adminGroupObjectId
    workspaceId: monitoring.outputs.workspaceId
    sku: sqlSku
    retentionDays: sqlRetentionDays
  }
}

// TB-1: the bot's identity (its Microsoft App ID is this identity's client id); the app holds it to send replies.
resource botIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-bot-id'
  location: location
  tags: tags
}

module app 'modules/app.bicep' = {
  name: 'app'
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
    workspaceName: monitoring.outputs.workspaceName
    insightsName: monitoring.outputs.insightsName
    registryName: registryName
    registryLoginServer: '${registryName}.azurecr.io'
    pullIdentityId: empty(pullIdentityName) ? '' : resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', pullIdentityName)
    botIdentityId: botIdentity.id
    botAppId: botIdentity.properties.clientId
    vaultName: keyvault.outputs.name
    vaultUri: keyvault.outputs.uri
    appReady: appReady
    imageTag: imageTag
    imageDigest: imageDigest
    inviteDomains: inviteDomains
    admins: admins
    adminGroupId: adminGroupId
    feedbackOrg: feedbackOrg
    feedbackProject: feedbackProject
    feedbackParentId: feedbackParentId
    requestsPoll: requestsPoll
    minReplicas: minReplicas
    tenantId: tenantId
    entraClientId: entraClientId
    googleClientId: googleClientId
    dataverseUrl: dataverseUrl
    dataverseTenantId: dataverseTenantId
    dataverseClientId: dataverseClientId
    sqlServerFqdn: sql.outputs.fqdn
    sqlDatabaseName: sql.outputs.databaseName
  }
}

module bot 'modules/bot.bicep' = {
  name: 'bot'
  params: {
    prefix: prefix
    tags: tags
    displayName: env == 'prod' ? 'FocusTime' : 'FocusTime (dev)'
    endpoint: '${app.outputs.publicUrl}/teams/messages'
    tenantId: tenantId
    identityId: botIdentity.id
    identityClientId: botIdentity.properties.clientId
  }
}

// FocusTime costs (the workbook in Monitor › Workbooks): dev and prod's actual cost, read live from Cost Management.
module costs 'modules/costs.bicep' = {
  name: 'costs'
  params: { env: env, location: location, tags: tags, workspaceId: monitoring.outputs.workspaceId }
}

// HK-2: the monthly budget and its alerts (50%, 80%, 100% actual, 100% forecast), only once FT_BUDGET_EMAIL is set.
module budget 'modules/budget.bicep' = if (!empty(budgetEmail)) {
  name: 'budget'
  params: { name: '${prefix}-budget', amount: budgetAmount, email: budgetEmail }
}

output appName string = app.outputs.name
output appFqdn string = app.outputs.fqdn
output publicUrl string = app.outputs.publicUrl
output appPrincipalId string = app.outputs.principalId
output registryName string = registryName
output registryLoginServer string = '${registryName}.azurecr.io'
output vaultName string = keyvault.outputs.name
output vaultUri string = keyvault.outputs.uri
output sqlServerName string = sql.outputs.serverName
output sqlServerFqdn string = sql.outputs.fqdn
output sqlDatabaseName string = sql.outputs.databaseName
output botAppId string = botIdentity.properties.clientId
