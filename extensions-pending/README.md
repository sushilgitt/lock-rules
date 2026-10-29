# Extensions waiting on Shopify approval

Shopify won't release an app version containing these, so they live outside
`extensions/` (which `shopify app deploy` publishes) until approved.

- **members-access**: customer account block (needs network access). In the
  Partner Dashboard, open the app's extension settings and request network
  access for customer account UI extensions. Once approved:
  `git mv extensions-pending/members-access extensions/members-access`,
  `npm install`, then deploy. The backend route `/customer/access` is already live.
