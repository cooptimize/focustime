// FocusTime costs: an Azure Monitor workbook with the actual cost of every resource tagged app: focustime, split by its
// env tag (dev, prod). Each environment deploys its own copy and both show dev and prod side by side, so a change is
// seen on dev first. The workbook stores only its queries, never cost data. When someone opens it, as that person
// (Reader, or Cost Management Reader plus Log Analytics Reader, on the subscription):
// - HK-2: ONE Cost Management query (daily cost by env, service and resource for the chosen period), in a hidden step.
//   Every view is a "Duplicate table" merge of that step (Merge/1.0, mergeType 'table'), summed by a grid's group-by
//   tree (treeType 1, groupBy, finalBy, aggregation Sum): the same mechanisms Microsoft's gallery workbooks use. Before
//   HK-2 each of the four charts sent its own query and opening the workbook could hit 429 "Too many requests".
// - one Log Analytics query (`print`, no data read) for yesterday's date, which costs no Cost Management quota.
// Cost Management's quota is per tenant (12 QPU per 10 s, 60 a minute, 600 an hour; one QPU per month of data), so
// a normal open (This month) costs one QPU. Nothing secret is in it.
param env string
param location string
param tags object
@description('This environment\'s Log Analytics workspace: only for the one `print` that gives yesterday\'s date.')
param workspaceId string

var api = '2023-11-01'
var queryPath = '/subscriptions/${subscription().subscriptionId}/providers/Microsoft.CostManagement/query'
var copyLabel = env == 'prod' ? '' : ' (dev copy)'
var source = 'cost-rows'

// The one Cost Management query, as a workbook step's ARM query (queryType 12). POST bodies go in "data". The
// response's rows are arrays: the cost, UsageDate (a number like 20261104), the env tag (key, then value), the
// service, the resource id, the currency.
var costBody = {
  type: 'ActualCost'
  timeframe: '{Period}'
  dataset: {
    granularity: 'Daily'
    aggregation: { totalCost: { name: 'Cost', function: 'Sum' } }
    grouping: [
      { type: 'TagKey', name: 'env' }
      { type: 'Dimension', name: 'ServiceName' }
      { type: 'Dimension', name: 'ResourceId' }
    ]
    filter: { tags: { name: 'app', operator: 'In', values: [ 'focustime' ] } }
    sorting: [ { direction: 'ascending', name: 'UsageDate' } ]
  }
}
var costQuery = string({
  version: 'ARMEndpoint/1.0'
  data: string(costBody)
  headers: []
  method: 'POST'
  path: queryPath
  urlParams: [ { key: 'api-version', value: api } ]
  batchDisabled: false
  transformers: [
    {
      type: 'jsonpath'
      settings: {
        tablePath: '$.properties.rows'
        columns: [
          { path: '$[1]', columnid: 'UsageDate' }
          // Shown as 11-04.
          { path: '$[1]', columnid: 'Day', substringRegexMatch: '^\\d{4}(\\d{2})(\\d{2})$', substringReplace: '$1-$2' }
          { path: '$[3]', columnid: 'Environment' }
          { path: '$[4]', columnid: 'Service' }
          // The resource id's last segment is its name.
          { path: '$[5]', columnid: 'Resource', substringRegexMatch: '^.*/([^/]+)$', substringReplace: '$1' }
          { path: '$[0]', columnid: 'Cost (USD)' }
        ]
      }
    }
  ]
})

var columns = [ 'UsageDate', 'Day', 'Environment', 'Service', 'Resource', 'Cost (USD)' ]
// A view of the one query: a "Duplicate table" merge of the hidden step, with any added columns.
func duplicate(id string, sourceName string, cols array, added array) string =>
  string({
    version: 'Merge/1.0'
    merges: [ { id: id, mergeType: 'table', leftTable: sourceName } ]
    projectRename: concat(
      map(cols, c => { originalName: '[${sourceName}].${c}', mergedName: c, fromId: id }),
      added
    )
  })

// Yesterday's cost on each row: its cost when its day is {Yesterday}, else 0. Summed per environment.
var yesterdayColumn = {
  originalName: '[Added column]'
  mergedName: 'Yesterday (USD)'
  fromId: null
  isNewItem: true
  newItemData: [
    {
      criteriaContext: {
        leftOperand: 'UsageDate'
        operator: '=='
        rightValType: 'param'
        rightVal: 'Yesterday'
        resultValType: 'column'
        resultVal: 'Cost (USD)'
      }
    }
    { criteriaContext: { operator: 'Default', rightValType: 'column', resultValType: 'static', resultVal: '0' } }
  ]
}

// Summed into each group row of a tree; drawn as a bar. (Bicep functions can't read variables, so the format is inline.)
func costColumn(match string) object => {
  columnMatch: match
  formatter: 4
  formatOptions: { palette: 'blue', aggregation: 'Sum' }
  numberFormat: { unit: 0, options: { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 } }
}
var hidden = [ { columnMatch: 'UsageDate', formatter: 5 } ]
// A grid of the one query, grouped by `groupBy` (each group row shows its sum) with one row per `finalBy` under it.
func tree(groupBy array, finalBy string, expand bool) object => {
  treeType: 1
  groupBy: groupBy
  finalBy: finalBy
  expandTopLevel: expand
}

var items = [
  {
    type: 1
    name: 'intro'
    content: {
      json: '## FocusTime costs\nActual cost in USD of every resource tagged `app: focustime`, split by its `env` tag: **dev** is resource group FocusTime-dev, **prod** is FocusTime. Cost Management data is 8 to 24 hours behind, so yesterday may still grow. The container registry is in dev and shared by prod, so its cost shows under dev. OpenAI usage is billed by OpenAI, not Azure: see Settings › AI. Fixed costs, budgets and alerts: docs/azure/runbook.md (Cost).\n\nOne Cost Management query feeds everything below. "Too many requests" means the tenant\'s Cost Management quota is used up for now (12 QPU per 10 seconds, 60 a minute, 600 an hour, shared by everyone in the tenant; each month of data costs one QPU): wait a minute, then Refresh.'
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
        {
          // Yesterday in UTC as Cost Management's UsageDate (20261104). Log Analytics, not Cost Management.
          id: 'b3a7e0c4-2f6d-4e8a-9c1b-5d4f3e2a1b07'
          version: 'KqlParameterItem/1.0'
          name: 'Yesterday'
          type: 1
          isHiddenWhenLocked: true
          query: 'print Yesterday = format_datetime(ago(1d), \'yyyyMMdd\')'
          crossComponentResources: [ workspaceId ]
          queryType: 0
          resourceType: 'microsoft.operationalinsights/workspaces'
        }
      ]
      style: 'pills'
      queryType: 0
      resourceType: 'microsoft.operationalinsights/workspaces'
    }
  }
  {
    // The one Cost Management query. Never shown (its condition is never true); it runs because the merges below
    // reference it.
    type: 3
    name: source
    conditionalVisibility: { parameterName: '1', comparison: 'isEqualTo', value: '2' }
    content: {
      version: 'KqlItem/1.0'
      queryType: 12
      query: costQuery
      visualization: 'table'
      size: 0
    }
  }
  {
    type: 3
    name: 'by-env'
    customWidth: '35'
    content: {
      version: 'KqlItem/1.0'
      title: 'Dev and prod: this period and yesterday'
      queryType: 7
      query: duplicate('2a4e6c80-1b3d-4f5a-8c7e-9d0b1a2c3e40', source, columns, [ yesterdayColumn ])
      visualization: 'table'
      size: 4
      noDataMessage: 'No cost yet for this period.'
      gridSettings: {
        formatters: concat(hidden, [
          costColumn('Cost (USD)')
          costColumn('Yesterday (USD)')
          { columnMatch: 'Day|Service|Resource', formatter: 5 }
        ])
        hierarchySettings: tree([ 'Environment' ], 'Environment', false)
        sortBy: [ { itemKey: 'Environment', sortOrder: 1 } ]
      }
    }
  }
  {
    type: 3
    name: 'daily'
    customWidth: '65'
    content: {
      version: 'KqlItem/1.0'
      title: 'Each day, dev and prod (newest first)'
      queryType: 7
      query: duplicate('3b5f7d91-2c4e-4a6b-9d8f-0e1c2b3d4f51', source, columns, [])
      visualization: 'table'
      size: 0
      noDataMessage: 'No cost yet for this period.'
      gridSettings: {
        formatters: concat(hidden, [ costColumn('Cost (USD)'), { columnMatch: 'Service|Resource', formatter: 5 } ])
        hierarchySettings: tree([ 'Day' ], 'Environment', true)
        sortBy: [ { itemKey: 'Day', sortOrder: 2 } ]
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
      queryType: 7
      query: duplicate('4c6a8ea2-3d5f-4b7c-ae90-1f2d3c4e5a62', source, columns, [])
      visualization: 'table'
      size: 0
      noDataMessage: 'No cost yet for this period.'
      gridSettings: {
        formatters: concat(hidden, [ costColumn('Cost (USD)'), { columnMatch: 'Day|Resource', formatter: 5 } ])
        hierarchySettings: tree([ 'Environment' ], 'Service', true)
        sortBy: [ { itemKey: 'Cost (USD)', sortOrder: 2 } ]
      }
    }
  }
  {
    type: 3
    name: 'by-resource'
    customWidth: '50'
    content: {
      version: 'KqlItem/1.0'
      title: 'By resource'
      queryType: 7
      query: duplicate('5d7b9fb3-4e6a-4c8d-bfa1-2a3e4d5f6b73', source, columns, [])
      visualization: 'table'
      size: 0
      noDataMessage: 'No cost yet for this period.'
      gridSettings: {
        formatters: concat(hidden, [ costColumn('Cost (USD)'), { columnMatch: 'Day', formatter: 5 } ])
        hierarchySettings: tree([ 'Environment' ], 'Resource', true)
        sortBy: [ { itemKey: 'Cost (USD)', sortOrder: 2 } ]
      }
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
