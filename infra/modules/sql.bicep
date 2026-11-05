// Azure SQL: a logical server with Entra-only authentication (no SQL logins), its Entra admin the "FocusTime DB Admins"
// group; one database `focustime` on a fixed-price DTU Standard tier (HK-2: dev S0, prod S1; it never pauses), 250 GB
// (included in the price), zone redundancy off, retentionDays of point-in-time restore (dev 7, prod 14). Public endpoint
// with only "Allow Azure services" (a private endpoint is a later step).
// Rollback to serverless (before HK-2): sku { name: 'GP_S_Gen5', tier: 'GeneralPurpose', family: 'Gen5', capacity: 1
// (dev) or 2 (prod) }, properties minCapacity json('0.5'), autoPauseDelay 60, maxSizeBytes 34359738368; see the runbook.
param name string
param location string
param tags object
param tenantId string
param adminGroupName string
param adminGroupObjectId string
param workspaceId string
@description('HK-2: the DTU Standard service objective (dev S0, prod S1; S2 or S3 to scale up, docs/azure/runbook.md).')
@allowed([ 'S0', 'S1', 'S2', 'S3' ])
param sku string = 'S0'
param retentionDays int = 7

resource server 'Microsoft.Sql/servers@2023-08-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'Group'
      login: adminGroupName
      sid: adminGroupObjectId
      tenantId: tenantId
      azureADOnlyAuthentication: true
    }
  }
}

// 0.0.0.0 to 0.0.0.0 is Azure's "Allow Azure services and resources to access this server".
resource azureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01' = {
  parent: server
  name: 'AllowAllWindowsAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: server
  name: 'focustime'
  location: location
  tags: tags
  sku: { name: sku, tier: 'Standard' }
  properties: {
    maxSizeBytes: 268435456000 // 250 GB, the largest S0 to S2 allow and included in their price
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
    collation: 'SQL_Latin1_General_CP1_CI_AS'
  }
}

resource shortTerm 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01' = {
  parent: database
  name: 'default'
  properties: { retentionDays: retentionDays }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: database
  name: 'to-log-analytics'
  properties: {
    workspaceId: workspaceId
    logs: [ { categoryGroup: 'allLogs', enabled: true } ]
  }
}

output serverName string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
