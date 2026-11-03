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
@description('A5: the SQL database\'s vCores (serverless max) and days of point-in-time restore.')
param sqlMaxVCores int = 1
param sqlRetentionDays int = 7
@description('A5: the only domains help invites may go to, for everyone (comma list); empty: each person\'s work email.')
param inviteDomains string = ''
@description('F1: Send feedback creates stories in this DevOps organization and project, under this feature.')
param feedbackOrg string = 'cooptimize'
param feedbackProject string = 'Cooptimize Internal'
param feedbackParentId string = '496'
@description('F1: true sends feedback (prod); false shows the preview only (dev, unless switched on for a test).')
param feedbackLive bool = false
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
    maxVCores: sqlMaxVCores
    retentionDays: sqlRetentionDays
  }
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
    vaultName: keyvault.outputs.name
    vaultUri: keyvault.outputs.uri
    appReady: appReady
    imageTag: imageTag
    imageDigest: imageDigest
    inviteDomains: inviteDomains
    feedbackOrg: feedbackOrg
    feedbackProject: feedbackProject
    feedbackParentId: feedbackParentId
    feedbackLive: feedbackLive
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
