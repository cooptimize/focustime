// Key Vault in RBAC mode, soft delete and purge protection on. The key ft-data-key wraps the app's data key
// (host/azure/datakey.ts); app secrets (ft-entra-client-secret, ft-google-client-secret, ft-dataverse-client-secret) are
// written by infra/scripts, never by this template, so a deploy never changes or reveals one. The admin group may set
// secrets (Key Vault Secrets Officer); the app's identity gets Secrets User and Crypto User in app.bicep.
param name string
param location string
param tags object
param tenantId string
param adminGroupObjectId string
param workspaceId string

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

resource dataKey 'Microsoft.KeyVault/vaults/keys@2023-07-01' = {
  parent: vault
  name: 'ft-data-key'
  properties: {
    kty: 'RSA'
    keySize: 3072
    keyOps: [ 'wrapKey', 'unwrapKey' ]
    attributes: { enabled: true }
  }
}

var secretsOfficer = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
resource adminSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, adminGroupObjectId, secretsOfficer)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsOfficer)
    principalId: adminGroupObjectId
    principalType: 'Group'
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: vault
  name: 'to-log-analytics'
  properties: {
    workspaceId: workspaceId
    logs: [ { categoryGroup: 'audit', enabled: true } ]
  }
}

output name string = vault.name
output uri string = vault.properties.vaultUri
output id string = vault.id
