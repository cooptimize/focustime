// The Container Apps environment and the one Container App. System-assigned identity; HTTPS-only external ingress on
// 8080; probes on /healthz (no database call, so the serverless database can pause); single revision mode.
//
// Scale: dev runs 0 to 1 replicas (scale to zero when nobody uses it). Prod must run min 1: the in-process scheduler
// (server/scheduler.ts) runs only while a replica is up, so a reminder or a timer end due while the app is scaled to
// zero would wait for the next request. Max is 1 in both: the scheduler and the session sweep assume one replica.
//
// Two phases (appReady), because the system identity exists only after the app does:
// - false: a public placeholder image, no registry, no Key Vault references. Creates the app and its identity, which
//   then gets AcrPull and the Key Vault roles below.
// - true: the FocusTime image from ACR, pulled with the system identity, and the app secrets as Key Vault references.
param prefix string
@description('S1 (D452): the env label the app shows in About and at /version (dev or prod).')
param env string
param location string
param tags object
param workspaceName string
param insightsName string
param registryName string
param vaultName string
@description('The vault URI (a parameter so the secret references can be computed at the start).')
param vaultUri string
param appReady bool
param imageTag string
param minReplicas int
param tenantId string
param entraClientId string
param googleClientId string
param dataverseUrl string
param dataverseTenantId string
param dataverseClientId string
param sqlServerFqdn string
param sqlDatabaseName string

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = { name: workspaceName }
resource insights 'Microsoft.Insights/components@2020-02-02' existing = { name: insightsName }
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: registryName }
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: vaultName }

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-cae'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
    workloadProfiles: [ { name: 'Consumption', workloadProfileType: 'Consumption' } ]
  }
}

var appName = '${prefix}-app'
var publicUrl = 'https://${appName}.${environment.properties.defaultDomain}'

// name in the app's secret list, Key Vault secret name, the env var host/azure/secrets.ts reads
var appSecrets = [
  { name: 'entra-client-secret', vault: 'ft-entra-client-secret', env: 'FOCUSTIME_SECRET_ENTRA_CLIENT' }
  { name: 'google-client-secret', vault: 'ft-google-client-secret', env: 'FOCUSTIME_SECRET_GOOGLE_CLIENT' }
  { name: 'dataverse-client-secret', vault: 'ft-dataverse-client-secret', env: 'FOCUSTIME_SECRET_DATAVERSE_CLIENT' }
]

var settings = [
  { name: 'FOCUSTIME_HOST', value: 'azure' }
  { name: 'FOCUSTIME_ENV', value: env }
  { name: 'PORT', value: '8080' }
  { name: 'FOCUSTIME_PUBLIC_URL', value: publicUrl }
  { name: 'FOCUSTIME_ENTRA_TENANT_ID', value: tenantId }
  { name: 'FOCUSTIME_ENTRA_CLIENT_ID', value: entraClientId }
  { name: 'FOCUSTIME_GOOGLE_CLIENT_ID', value: googleClientId }
  { name: 'FOCUSTIME_DATAVERSE_URL', value: dataverseUrl }
  { name: 'FOCUSTIME_DATAVERSE_TENANT_ID', value: dataverseTenantId }
  { name: 'FOCUSTIME_DATAVERSE_CLIENT_ID', value: dataverseClientId }
  { name: 'FOCUSTIME_DB_DRIVER', value: 'sqlserver' }
  { name: 'FOCUSTIME_DB_SERVER', value: sqlServerFqdn }
  { name: 'FOCUSTIME_DB_PORT', value: '1433' }
  { name: 'FOCUSTIME_DB_NAME', value: sqlDatabaseName }
  { name: 'FOCUSTIME_DB_AUTH', value: 'entra' }
  { name: 'FOCUSTIME_KEYVAULT_URL', value: vaultUri }
  { name: 'FOCUSTIME_DATA_KEY_NAME', value: 'ft-data-key' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
]

var secretRefs = [for s in appSecrets: { name: s.name, keyVaultUrl: '${vaultUri}secrets/${s.vault}', identity: 'system' }]
var secretEnv = [for s in appSecrets: { name: s.env, secretRef: s.name }]

var probe = { type: 'Liveness', httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }, periodSeconds: 30, timeoutSeconds: 5, failureThreshold: 3 }

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: appReady ? 8080 : 80
        transport: 'auto'
        allowInsecure: false
      }
      registries: appReady ? [ { server: registry.properties.loginServer, identity: 'system' } ] : []
      secrets: appReady ? secretRefs : []
    }
    template: {
      containers: [
        {
          name: 'focustime'
          image: appReady ? '${registry.properties.loginServer}/focustime:${imageTag}' : 'mcr.microsoft.com/k8se/quickstart:latest'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: appReady ? concat(settings, secretEnv) : []
          probes: appReady ? [
            probe
            { type: 'Readiness', httpGet: { path: '/readyz', port: 8080, scheme: 'HTTP' }, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 3 }
            { type: 'Startup', httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }, periodSeconds: 5, timeoutSeconds: 5, failureThreshold: 24 }
          ] : []
        }
      ]
      scale: { minReplicas: minReplicas, maxReplicas: 1 }
    }
  }
}

var acrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var kvSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var kvCryptoUser = '12338af0-0e69-4776-bea7-57ae8d297424'

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, app.id, acrPull)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPull)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, app.id, kvSecretsUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUser)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource cryptoUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, app.id, kvCryptoUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvCryptoUser)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output name string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
output publicUrl string = publicUrl
output principalId string = app.identity.principalId
