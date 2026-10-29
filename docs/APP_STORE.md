# LockRules: App Store launch kit

Everything needed to submit LockRules to the Shopify App Store, plus the
self-review results (34 locally checkable requirements) from Shopify's AI self-review requirements (fetched
2026-10-29).

## 1. Partner Dashboard setup

### Pricing (Shopify App Pricing)
Create these plans under **Apps › LockRules › Distribution › Pricing**. The
**handles must match** `app/lib/plans.ts`, which also holds the feature limits.

| Handle | Display name | Price | Trial | Welcome link |
|---|---|---|---|---|
| `free` | Free | $0 | – | `/app/plans` |
| `basic` | Basic | $9.99 / month | 15 days | `/app/plans` |
| `pro` | Pro | $24.99 / month | 15 days | `/app/plans` |

Top features to list per plan: copy `highlights` from `app/lib/plans.ts`.
If you change prices, update `price` there too (display only).

Then create a **Partner API client** (Organization settings › Users › Security
› Partner API clients) with access to app subscriptions, and set on the server:

| Env var | Value |
|---|---|
| `PARTNER_ID` | Number in your Partner Dashboard URL (not the Dev Dashboard org id) |
| `PARTNER_API_TOKEN` | The client's access token |
| `APP_HANDLE` | App handle in the plan selection URL (defaults to `lockrules`) |
| `SUPPORT_EMAIL` | Shown on `/privacy` |

Without `PARTNER_ID`/`PARTNER_API_TOKEN`, billing is off and every shop gets
Pro, so development stores stay fully usable.

### Approvals to request
0. **Network access for the members-access customer account extension**
   (Partner Dashboard › the extension › request network access), so the block
   can call `/customer/access`. The extension waits in `extensions-pending/`
   until then (see the README there).
1. **Protected customer data**: Level 2 (name, email) for customers and
   orders. Needed for "has purchased", customer approval and Klaviyo
   membership keys. After approval, uncomment the `orders/paid` and
   `customers/create` webhooks in `shopify.app.toml` and deploy.
2. **Theme file exemption** (`themeFilesUpsert`): needed for secure mode.
   Request text:

   > LockRules is an access-control app. Merchants lock products, collections,
   > pages or their whole store to customers with a tag, passcode, secret link,
   > location and similar keys. Our theme app extension can only hide locked
   > content in the browser, which leaves it in the page source, so it isn't
   > suitable for paid or confidential content. We use themeFilesUpsert to wrap
   > `content_for_layout` and product/search/menu loops in our own clearly
   > marked snippets so locked content is never rendered. Merchants turn it on
   > explicitly after a dry-run preview, can exclude files, and turning it off
   > restores the original files exactly. We re-apply it when a new theme is
   > published.

## 2. Listing copy

**App name:** LockRules

**Tagline (≤ 62 chars):** Members-only products, wholesale and private pages

**Introduction:**
Control who can see and buy every part of your store. Lock products,
collections, pages, blogs or your whole store, and choose who gets in: tagged
customers, passcode holders, secret-link visitors, shoppers in certain
countries, repeat buyers and more. Checkout protection makes sure locked
products can't be bought by anyone without access.

**Feature list:**
- Lock products, variants, collections, pages, blog posts, vendors, product tags or the entire store
- 23 key types: customer tags, emails, passcodes, secret links, country, market, IP, cart, order history, dates and schedules
- Hide prices and add to cart for wholesale, with app blocks for custom layouts
- Checkout protection and payment method rules by customer tag
- Customer registration approval, passcode lists, key usage reports
- Klaviyo and Mailchimp: unlock by subscribing; REST and JavaScript APIs (Pro)
- Secure mode keeps locked content off the page entirely (Pro)
- Analytics per lock, bulk customer import with tags, B2B company keys
- Members-access block in new customer accounts
- Works with page builders (configurable content and buy-button selectors)

**Privacy policy URL:** `https://<app domain>/privacy`

## 3. Review submission checklist
- [ ] Plans created in the Partner Dashboard with the handles above
- [ ] Partner API env vars set on the server; plan switching tested on a dev store
- [ ] Screencast (≤ 3 min, English or subtitled): install → enable app embed → create a
      tag lock → guest sees the sign-in prompt → tagged customer gets in → locked
      product blocked at checkout → passcode unlock → Plans page upgrade
- [ ] Test store credentials and a tagged test customer for the reviewer
- [ ] App icon (1200×1200) and 3–6 screenshots (1600×900)
- [ ] Support email set (`SUPPORT_EMAIL`) and listed
- [ ] Emergency developer contact in the Partner Dashboard
- [ ] Production domain instead of sslip.io (recommended before submission)

## 4. Self-review results (2026-10-29)

**Summary:** ✅ Likely passing: 29 · ❌ Likely failing: 0 · ⚠️ Needs review: 5 · ⏭️ Groups skipped: 9

### ⚠️ Needs review

**1.1.4 Use only factual information.** The listing copy above is accurate to the
code, but check final screenshots and any comparison claims before submitting.

**1.2.1 and 1.2.2 Shopify App Pricing (two requirements).** The app reads `activeSubscription` from the
Partner API and sends merchants to Shopify's hosted plan page (`app/lib/billing.server.ts`,
`app/routes/app.plans.tsx`). A declined or missing charge falls back to Free; reinstalling
re-checks the plan. Plans themselves only exist once you configure them in the Partner
Dashboard, so verify the full flow on a dev store.

**5.1.1 Use theme app extensions.** Storefront features use the theme app extension.
Secure mode writes theme files with `themeFilesUpsert`, which requires the exemption
above; it's off until a merchant turns it on and fails safely without the exemption.
The Developers page documents an optional Liquid snippet for theme developers; this is
an opt-in developer feature, not a setup step.

**5.1.5 Send collected data back to the merchant.** Emails entered for newsletter keys
go straight to the merchant's own Klaviyo or Mailchimp account; key usage (passcodes,
customer IDs) is shown under Key usage. Confirm this satisfies the reviewer.

### Skipped groups
- **5.2 Payments**: no payments extension
- **5.3**: opt-in only
- **5.4 Purchase options / subscriptions**: no subscription scopes
- **5.5**: opt-in only
- **5.6 Checkout UI extensions**: none (we use Functions)
- **5.7 Sales channels**: not a channel
- **5.8 Post purchase**: no post-purchase extension
- **5.9 Mobile app builders**, **5.10 Donation**: opt-in only
