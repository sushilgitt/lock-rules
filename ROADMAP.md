# Access-Control App for Shopify — Implementation Roadmap

Reference product: **Locksmith** by Lightward (4.7★, 308 reviews, Built for Shopify).
Goal: build our own access-control app with the same capabilities. We use our own name, branding and code.

---

## 1. What we are building (feature inventory)

### Core model
- A **lock** restricts or hides one or more resources of the **same type**.
- A **key** sets the condition that opens a lock.
  - A lock can have many keys, and **any** one of them opens it (OR).
  - A key can hold several conditions, and **all** of them must pass (AND).
  - Any condition can be **inverted**.
- **Lock settings:**
  - Hide the resource from lists (collections and search).
  - Hide navigation links to it.
  - Manual mode, which hides only some parts of a page.
  - Force open other locks.
  - Access-denied message or redirect.
  - Store-lock exceptions (home page, policies, account pages).

### Lockable resources
- Products, variants, collections (including "All"), pages, blogs and articles.
- Products by vendor and products by tag.
- Home page, search results page, registration form.
- The entire store.
- Custom "Liquid locks" for anything else.

### Key conditions (about 25 in total)
| Group | Conditions |
|---|---|
| Customer | Is signed in · has a tag · email in a list · email in an input list · email contains… · has purchased X · has placed at least N orders |
| Visitor | Passcode · one of many passcodes · passcode from an input list · secret link · secret link from an input list · confirms a prompt · visiting a certain domain |
| Cart | Has product X · has variant X · cart subtotal at least $X |
| Location | IP address or range · country or region (GeoIP) · Shopify Market |
| Marketing | Subscribes to a Mailchimp list · subscribes to a Klaviyo list · already a member of a Klaviyo list or segment |
| Time | Before a date · after a date · weekly schedule · access expires after N minutes (for passcodes and secret links) |
| Special | Always permit (used for exclusions) · custom Liquid |

### Beyond page locking
- **Hide prices and add-to-cart** (wholesale use), including several price tiers.
- **Checkout validation:** block checkout when the cart holds locked products the buyer can't access. This also stops bots and resellers.
- **Payment method restriction** by customer tag.
- **Customer registration approval:** new sign-ups are tagged and must be approved.
- **SEO:** manage the `seo.hidden` metafield for locked items automatically.
- **Customizable messages:** login, passcode, signup and denied prompts, with translations.
- **Input lists:** bulk passcodes or emails.
- **Key usage stats:** who used which passcode.
- **Developer surface:** Liquid variables (`access_granted`, `hide_resource`, `lock_ids`…), an Admin API and a Storefront API.
- **Integrations:** Klaviyo, Mailchimp, subscription apps (ReCharge, Seal…).

### Pricing to match or undercut
Locksmith's price depends on the merchant's Shopify plan: Basic $12, Grow $29, Advanced $99, Plus $199. Each plan has a 15-day trial. Its competitors (Sami, BSS) all offer **free plans**, which leaves room for a freemium tier.

---

## 2. The key architecture decision: how locks are enforced

This is the single most important technical choice, and everything else follows from it.

| Approach | Security | Effort | Notes |
|---|---|---|---|
| **A. Theme file injection.** Write a `snippets/<app>.liquid` and wrap `{{ content_for_layout }}` in `layout/theme.liquid` using the Asset API. | ✅ Real server-side gating. Locked HTML is never sent to the browser. | High | This is how Locksmith works. Writing theme assets needs a **`write_themes` scope exemption from Shopify**, which must be requested. Theme updates and theme switches need re-install logic. |
| **B. Theme app extension only.** An app embed in `<head>` plus app blocks. | ⚠️ The embed can't stop the template rendering, so content stays in the page source and gating happens on the client (overlay or redirect). | Low | Allowed by default and passes review easily. Fine for "soft" use cases: hiding prices from guests, wholesale visibility. Not fine for paid or confidential content. |
| **C. Hybrid (recommended).** Build B first. Add A as "secure mode" once the exemption is granted. Enforce at checkout with Functions in both cases. | ✅ for buying (Functions). ✅ for viewing once A ships. | Medium | Lets us ship early, and the purchase path is never insecure. |

**Plan:**
- Go with **C**.
- Request the Asset API exemption during Phase 1 so it doesn't block us later.
- Design the Liquid evaluator so the **same snippet** runs both as an app embed and as an injected theme snippet.

### How conditions are evaluated without calling our server on every page view
1. **Compile locks into metafields** whenever a merchant saves.
   - Per-resource locks go into app-owned metafields, e.g. `product.metafields.app--<id>.lock`.
   - Store-wide locks and settings go into shop or app metafields.
   - Liquid reads these at render time, so there is no extra request.
2. **Customer conditions run in Liquid:** `customer.tags`, `customer.email`, `customer.orders_count`, and the cart.
   - For **"has purchased X"**, an `orders/create` webhook keeps a customer metafield listing purchased product IDs.
3. **Market and country** come from `localization.country` and `localization.market` in Liquid. This needs no GeoIP for the common case.
4. **"Remote" conditions** run through our server via an **App Proxy** (`/apps/<handle>/…`). These are passcode, secret link, IP and precise geo, newsletter signup, and Klaviyo membership.
   - The server checks the condition and issues a **signed token**: lockId, expiry, and an HMAC.
   - The token is stored in a **cart attribute**, and in a customer metafield when the customer is logged in.
   - Liquid checks the token with the `hmac_sha256` filter, using a secret kept in an app-owned metafield.
   - Result: still no round-trip on later page views.
5. **Time conditions** use `'now' | date` in Liquid. Shopify's page cache makes these roughly accurate rather than to the second. Document this for merchants, and back it up at checkout.
6. **Checkout** uses a **Cart & Checkout Validation Function**. It reads lock metafields on the cart lines and customer tags or metafields, and rejects carts the buyer isn't allowed to buy. A **Payment Customization Function** hides payment methods by tag.

---

## 3. Tech stack

- **Shopify CLI app template:** React Router (the successor to Remix), TypeScript.
- **Admin UI:** App Bridge plus Polaris web components, embedded in the Shopify admin.
- **Database:** PostgreSQL with Prisma. Holds sessions, locks, keys, input lists, usage logs and billing state.
- **Extensions:**
  - Theme app extension: app embed plus app blocks for price, add-to-cart and the prompt form.
  - Checkout Validation Function and Payment Customization Function, in Rust or JS.
  - Later, a customer account UI extension.
- **Background jobs:** a BullMQ/Redis queue, or a simpler Postgres-backed queue. Used for metafield compilation, bulk tag syncs and webhooks.
- **Hosting:** Fly.io, Render or Railway for the app, managed Postgres.
- **GeoIP:** the MaxMind GeoLite2 database, only for the IP and precise-location keys.
- **Required compliance:** GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`), `app/uninstalled` cleanup, and the Billing API.

### Data model (first draft)
```
Shop(id, domain, plan, settings, hmacSecret, installedAt)
Lock(id, shopId, name, resourceType, resourceIds[], enabled,
     hideFromLists, hideNavLinks, manualMode, forceOpenOthers,
     deniedMessage, redirectUrl, storeExceptions)
Key(id, lockId, position)                      -- keys are ORed
Condition(id, keyId, type, params JSON, inverted)  -- conditions are ANDed
InputList(id, shopId, name, kind[passcode|email|link], entries[])
Message(id, shopId, kind[login|passcode|denied|signup|confirm], locale, body)
KeyUsage(id, shopId, keyId, conditionId, value, customerId?, at)
```

---

## 4. Phased roadmap

Estimates assume 1–2 developers. A week is roughly 5 developer-days.

### Phase 0: Foundations (1 week)
- [ ] Partner account, dev stores (one OS 2.0 theme such as Dawn or Horizon, one vintage theme), and an app scaffolded with `shopify app init`.
- [ ] Prisma with Postgres, session storage, OAuth, App Bridge, and a navigation shell (Locks · Messages · Settings · Billing).
- [ ] GDPR and uninstall webhooks, CI pipeline, staging deploy.
- [ ] **Submit the `write_themes` and Asset API exemption request** with our use case.

### Phase 1: MVP lock engine (3–4 weeks)
**Goal:** a merchant can lock a product, collection or page, and only tagged or logged-in customers can see it.
- [ ] **Lock editor UI:**
  - Resource picker (App Bridge `resourcePicker` for products, collections and variants; a custom search for pages, blogs and articles).
  - Lock name, enable/disable, settings.
- [ ] **Key builder UI:** add keys, add conditions, AND within a key, OR across keys, invert toggle, copy and paste keys.
- [ ] Conditions in this phase: is signed in, has tag, email in a list, email contains, always permit.
- [ ] **Compiler:** on save, write lock definitions to resource and shop metafields. Add a "sync status" indicator in the UI.
- [ ] **Theme app extension (app embed):**
  - A Liquid evaluator snippet.
  - Denied overlay or redirect.
  - Login prompt that links to the customer login page and returns the visitor afterwards.
  - Hide-from-lists via CSS/JS filtering on collection and search cards.
- [ ] **Store-wide lock** with exceptions.
- [ ] **Checkout Validation Function**, which blocks locked products for unauthorized buyers. This is the real enforcement point at this stage.
- [ ] Onboarding checklist: turn on the app embed, then create your first lock.

### Phase 2: Visitor and remote keys (3 weeks)
- [ ] **App Proxy** routes: `/verify-passcode`, `/secret/:code`, `/confirm`, `/signup`.
- [ ] Signed-token scheme stored in a cart attribute and a customer metafield, checked in Liquid with `hmac_sha256`. Tokens can expire.
- [ ] Conditions in this phase:
  - Passcode, many passcodes, secret link.
  - Confirms a prompt, is visiting a domain.
  - IP address or range, GeoIP country.
  - Shopify Market (pure Liquid).
- [ ] **Input lists** with CSV upload, used for passcodes, links and emails.
- [ ] Passcode-specific redirects. KeyUsage logging and a usage report.
- [ ] Prompt and message customization (login, passcode, denied, confirm) with a theme-styled default and per-locale translations.

### Phase 3: Commerce and wholesale features (3 weeks)
- [ ] **Manual mode plus app blocks:**
  - "Protected price", "Protected add-to-cart" and "Protected content" blocks.
  - A documented Liquid snippet for custom themes.
- [ ] Price tiers: show different variants or prices per customer tag, using variant locks.
- [ ] Cart conditions: has product, has variant, subtotal at least $X.
- [ ] Customer history conditions: has purchased X, has at least N orders. Both are kept current by order webhooks writing to a customer metafield, with a backfill job using the Bulk Operations API.
- [ ] Time conditions: before or after a date, weekly schedule, with the store's timezone.
- [ ] **Payment Customization Function:** hide payment methods by tag.
- [ ] **Customer registration approval:** auto-tag new customers as pending, with an approval queue in the admin.
- [ ] Automatic `seo.hidden` management for locked resources.
- [ ] Lock by vendor, lock by product tag, variant locks.

### Phase 4: Secure mode and theme injection (2–3 weeks, needs the exemption)
- [ ] Use the Asset API to write `snippets/<app>.liquid` and wrap `content_for_layout`, plus the collection, search and nav loops for real server-side hiding.
- [ ] Idempotent install and uninstall that adds and removes only our own code.
- [ ] Handle `themes/publish` and `themes/update` webhooks by re-applying the code to newly published themes.
- [ ] "Disable for certain theme files" setting. Detect hand-written code that conflicts with ours and show a warning.
- [ ] Liquid locks for custom resources, and the custom-Liquid key condition.
- [ ] Close leaks through the storefront JSON endpoints (`/products/x.json` and `.js`) by redirecting to a template or hiding the publication where possible, and document the rest.

### Phase 5: Integrations and developer surface (2 weeks)
- [ ] Klaviyo: subscribe-to-unlock, plus the list or segment membership check.
- [ ] Mailchimp: subscribe-to-unlock.
- [ ] Subscription apps: tag-based guides for ReCharge, Seal and Appfox, since they all tag customers.
- [ ] Public **Admin API** (REST/GraphQL, per-shop API keys) for managing locks, keys and input lists.
- [ ] Storefront JS API, for example `window.<App>.accessGranted(lockId)` and a redirect helper.
- [ ] Liquid variables reference doc.

### Phase 6: Billing, polish and App Store launch (2 weeks)
- [ ] Billing API with plans tied to the merchant's Shopify plan, a 15-day trial, and a possible **free tier** (for example, one lock with tag/login keys only) to compete with Sami and BSS.
- [ ] Docs site (quick start, key reference, troubleshooting FAQ) and an in-app "Why isn't my lock working?" debugger that shows which keys passed or failed for a test customer.
- [ ] Performance: keep the app embed under about 10KB and avoid blocking JS. Meet the **Built for Shopify** criteria (web vitals, Polaris UI, embedded app).
- [ ] App Store listing, demo video, privacy policy, App Store review submission.

### Phase 7: After launch
- [ ] Analytics dashboard: denied views, unlocks, conversions per lock.
- [ ] Theme-section and block hiding profiles.
- [ ] Markets and B2B catalog interop. New customer accounts extension.
- [ ] Bulk customer import with tags. Page-builder compatibility (PageFly, GemPages).

**Total to App Store launch:** about **16–18 weeks**. A usable MVP (Phases 0–1) is ready in about **4–5 weeks**.

---

## 5. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Asset API exemption denied or delayed | Phases 1–3 work without it. Checkout Functions enforce purchases. Position secure mode as a later add-on. |
| Client-side gating can be bypassed (content in page source) | Be clear in the UI ("visibility mode" vs. "secure mode"). Checkout validation always enforces. |
| Theme diversity (vintage themes, page builders) | Test against Dawn, Horizon, one vintage theme and the top paid themes. Provide manual-mode snippets. |
| Page cache makes time and cart conditions stale | Make remote and time-sensitive checks also run on our server via the proxy, and re-check at checkout. |
| Metafield size limits for very large lock sets | Store locks per resource (on each product or collection), not in one large shop blob. |
| Bots and resellers buying locked products | Validation Function plus "has purchased"/order-count rules. Document the "Someone bought a locked product" path. |

---

## 6. Immediate next steps
1. Pick the app name and handle, and create the Partner app.
2. Scaffold with `shopify app init` (React Router template) in this folder.
3. Build Phase 0. In parallel, draft the Asset API exemption request.
4. Start Phase 1 with the data model and the lock editor UI.
