// Log Analytics (30 days) and workspace-based Application Insights. The app sends only its closed log fields and
// fixed route names (log/appinsights.ts): no request or response bodies.
param prefix string
param location string
param tags object

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-log'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-appi'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    RetentionInDays: 30
    IngestionMode: 'LogAnalytics'
    DisableIpMasking: false
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
output insightsName string = insights.name
