// Azure Container Registry, Basic, admin user off: the app pulls with its managed identity (AcrPull, app.bicep), the
// deploy workflow pushes with its federated identity (AcrPush, infra/scripts/bootstrap.sh).
param name string
param location string
param tags object

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

output name string = registry.name
output loginServer string = registry.properties.loginServer
