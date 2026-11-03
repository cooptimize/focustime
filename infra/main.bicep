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

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: { name: 'ft${env}acr${suffix}', location: location, tags: tags }
}

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
    registryName: registry.outputs.name
    vaultName: keyvault.outputs.name
    vaultUri: keyvault.outputs.uri
    appReady: appReady
    imageTag: imageTag
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
output registryName string = registry.outputs.name
output registryLoginServer string = registry.outputs.loginServer
output vaultName string = keyvault.outputs.name
output vaultUri string = keyvault.outputs.uri
output sqlServerName string = sql.outputs.serverName
output sqlServerFqdn string = sql.outputs.fqdn
output sqlDatabaseName string = sql.outputs.databaseName
