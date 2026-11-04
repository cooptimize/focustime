// FocusTime costs: an Azure Monitor workbook with the actual cost of every resource tagged app: focustime, split by its
// env tag (dev, prod). Each environment deploys its own copy and both show dev and prod side by side, so a change is
// seen on dev first. The workbook stores only its queries, never cost data: each chart calls Cost Management's query
// API at the subscription when someone opens it, as that person, who needs Cost Management Reader (or Reader) on the
// subscription. Nothing secret is in it.
param env string
param location string
param tags object

var api = '2023-11-01'
var queryPath = '/subscriptions/${subscription().subscriptionId}/providers/Microsoft.CostManagement/query'
var copyLabel = env == 'prod' ? '' : ' (dev copy)'

// One Cost Management query as a workbook step's ARM query (queryType 12). POST bodies go in "data". The response's
// rows are arrays in the order: the cost, UsageDate (daily only), then each grouping (a tag grouping is two columns, key
// and value), then the currency; the columns below pick them by index.
func armQuery(path string, apiVersion string, body object, columns array) string =>
  string({
    version: 'ARMEndpoint/1.0'
    data: string(body)
    headers: []
    method: 'POST'
    path: path
    urlParams: [ { key: 'api-version', value: apiVersion } ]
    batchDisabled: false
    transformers: [ { type: 'jsonpath', settings: { tablePath: '$.properties.rows', columns: columns } } ]
  })

func costQuery(granularity string, grouping array) object => {
  type: 'ActualCost'
  timeframe: '{Period}'
  dataset: union(
    {
      granularity: granularity
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } }
      grouping: grouping
      filter: { tags: { name: 'app', operator: 'In', values: [ 'focustime' ] } }
    },
    granularity == 'Daily' ? { sorting: [ { direction: 'ascending', name: 'UsageDate' } ] } : {}
  )
}

var byEnv = { type: 'TagKey', name: 'env' }
var usd = { unit: 0, options: { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 } }
var costColumn = { columnMatch: 'Cost (USD)', formatter: 4, formatOptions: { palette: 'blue' }, numberFormat: usd }

var items = [
  {
    type: 1
    name: 'intro'
    content: {
      json: '## FocusTime costs\nActual cost in USD of every resource tagged `app: focustime`, split by its `env` tag: **dev** is resource group FocusTime-dev, **prod** is FocusTime. Cost Management data is 8 to 24 hours behind. The container registry is in dev and shared by prod, so its cost shows under dev. OpenAI usage is billed by OpenAI, not Azure: see Settings › AI. Estimates to compare with: docs/azure/runbook.md (Cost).'
    }
  }
  {
    type: 9
    name: 'parameters'
    content: {
      version: 'KqlParameterItem/1.0'
      parameters: [
        {
          id: '6f1d0c3e-6a52-4c1e-9d0e-3b7f5a2c9e11'
          version: 'KqlParameterItem/1.0'
          name: 'Period'
          type: 2
          isRequired: true
          typeSettings: { additionalResourceOptions: [], showDefault: false }
          jsonData: string([
            { value: 'MonthToDate', label: 'This month', selected: true }
            { value: 'TheLastMonth', label: 'Last month' }
            { value: 'WeekToDate', label: 'This week' }
          ])
        }
      ]
      style: 'pills'
      queryType: 0
      resourceType: 'microsoft.operationalinsights/workspaces'
    }
  }
  {
    type: 3
    name: 'by-env'
    customWidth: '35'
    content: {
      version: 'KqlItem/1.0'
      title: 'Dev and prod'
      queryType: 12
      visualization: 'table'
      size: 4
      noDataMessage: 'No cost yet for this period.'
      query: armQuery(queryPath, api, costQuery('None', [ byEnv ]), [
        { path: '$[2]', columnid: 'Environment' }
        { path: '$[0]', columnid: 'Cost (USD)' }
      ])
      gridSettings: { formatters: [ costColumn ], sortBy: [ { itemKey: 'Environment', sortOrder: 1 } ] }
    }
  }
  {
    type: 3
    name: 'daily'
    customWidth: '65'
    content: {
      version: 'KqlItem/1.0'
      title: 'Each day, dev and prod'
      queryType: 12
      visualization: 'barchart'
      size: 0
      noDataMessage: 'No cost yet for this period.'
      query: armQuery(
        queryPath,
        api,
        costQuery('Daily', [ byEnv ]),
        [
          // UsageDate is a number like 20261104; shown as 11-04.
          { path: '$[1]', columnid: 'Day', substringRegexMatch: '^\\d{4}(\\d{2})(\\d{2})$', substringReplace: '$1-$2' }
          { path: '$[3]', columnid: 'Environment' }
          { path: '$[0]', columnid: 'Cost (USD)' }
        ]
      )
      chartSettings: {
        xAxis: 'Day'
        yAxis: [ 'Cost (USD)' ]
        group: 'Environment'
        createOtherGroup: 0
        seriesLabelSettings: [
          { seriesName: 'dev', color: 'blue' }
          { seriesName: 'prod', color: 'green' }
        ]
      }
    }
  }
  {
    type: 3
    name: 'by-service'
    customWidth: '50'
    content: {
      version: 'KqlItem/1.0'
      title: 'By service'
      queryType: 12
      visualization: 'table'
      size: 0
      noDataMessage: 'No cost yet for this period.'
      query: armQuery(queryPath, api, costQuery('None', [ byEnv, { type: 'Dimension', name: 'ServiceName' } ]), [
        { path: '$[2]', columnid: 'Environment' }
        { path: '$[3]', columnid: 'Service' }
        { path: '$[0]', columnid: 'Cost (USD)' }
      ])
      gridSettings: { formatters: [ costColumn ], sortBy: [ { itemKey: 'Cost (USD)', sortOrder: 2 } ] }
    }
  }
  {
    type: 3
    name: 'by-resource'
    customWidth: '50'
    content: {
      version: 'KqlItem/1.0'
      title: 'By resource'
      queryType: 12
      visualization: 'table'
      size: 0
      noDataMessage: 'No cost yet for this period.'
      query: armQuery(queryPath, api, costQuery('None', [ byEnv, { type: 'Dimension', name: 'ResourceId' } ]), [
        { path: '$[2]', columnid: 'Environment' }
        // The resource id's last segment is its name.
        { path: '$[3]', columnid: 'Resource', substringRegexMatch: '^.*/([^/]+)$', substringReplace: '$1' }
        { path: '$[0]', columnid: 'Cost (USD)' }
      ])
      gridSettings: { formatters: [ costColumn ], sortBy: [ { itemKey: 'Cost (USD)', sortOrder: 2 } ] }
    }
  }
]

resource workbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: guid(resourceGroup().id, 'focustime-costs')
  location: location
  tags: tags
  kind: 'shared'
  properties: {
    displayName: 'FocusTime costs${copyLabel}'
    category: 'workbook'
    sourceId: 'azure monitor'
    serializedData: string({
      version: 'Notebook/1.0'
      items: items
      fallbackResourceIds: [ 'azure monitor' ]
      '$schema': 'https://github.com/Microsoft/Application-Insights-Workbooks/blob/master/schema/workbook.json'
    })
  }
}

output workbookId string = workbook.id
