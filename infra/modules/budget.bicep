// HK-2: a monthly Cost Management budget on this resource group (everything in it, tagged or not), with four alerts:
// 50%, 80% and 100% of actual cost and 100% of forecast cost. Emailed to `email` (the FT_BUDGET_EMAIL GitHub variable,
// never in the repo; the FocusTime Admins group is a security group with no mailbox, so a budget can't send to it) and
// to the resource group's Owners as a backup. Alerts only: a budget never stops or changes anything.
// The start date is fixed: Cost Management keeps a past start date on an existing budget, but it can't be moved later.
param name string
param amount int
param email string
param startDate string = '2026-11-01'

var recipients = {
  contactEmails: [ email ]
  contactRoles: [ 'Owner' ]
  locale: 'en-us'
  enabled: true
  operator: 'GreaterThanOrEqualTo'
}

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: name
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: { startDate: startDate }
    notifications: {
      actual50: union(recipients, { threshold: 50, thresholdType: 'Actual' })
      actual80: union(recipients, { threshold: 80, thresholdType: 'Actual' })
      actual100: union(recipients, { threshold: 100, thresholdType: 'Actual' })
      forecast100: union(recipients, { threshold: 100, thresholdType: 'Forecasted' })
    }
  }
}

output id string = budget.id
