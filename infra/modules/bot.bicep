// TB-1: the FocusTime bot in Teams. An Azure Bot (free tier, global) whose credential is a user-assigned managed
// identity (no secret anywhere), with the Teams channel only, pointing at /api/messages on the existing Container App.
// The identity itself is made in main.bicep (the app needs it before this module can know the app's URL).
param prefix string
param tags object
param displayName string
param endpoint string
param tenantId string
param identityId string
param identityClientId string

resource bot 'Microsoft.BotService/botServices@2022-09-15' = {
  name: '${prefix}-bot'
  location: 'global'
  tags: tags
  kind: 'azurebot'
  sku: { name: 'F0' }
  properties: {
    displayName: displayName
    endpoint: endpoint
    msaAppType: 'UserAssignedMSI'
    msaAppId: identityClientId
    msaAppTenantId: tenantId
    msaAppMSIResourceId: identityId
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource teams 'Microsoft.BotService/botServices/channels@2022-09-15' = {
  parent: bot
  name: 'MsTeamsChannel'
  location: 'global'
  properties: {
    channelName: 'MsTeamsChannel'
    properties: { isEnabled: true, acceptedTerms: true }
  }
}

output name string = bot.name
output appId string = identityClientId
