// Shared (client + server) lock types and the condition catalog.

export const RESOURCE_TYPES = [
  { value: "product", label: "Products" },
  { value: "collection", label: "Collections" },
  { value: "page", label: "Pages" },
  { value: "blog", label: "Blogs" },
  { value: "article", label: "Blog posts" },
  { value: "store", label: "Entire store" },
  { value: "variant", label: "Product variants" },
  { value: "vendor", label: "Products by vendor" },
  { value: "product_tag", label: "Products by tag" },
  { value: "liquid", label: "Custom (Liquid, secure mode)" },
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number]["value"];

// Resource types whose "resources" are typed-in names rather than picked items.
export const NAMED_RESOURCE_TYPES: ResourceType[] = ["vendor", "product_tag"];

export const PROTECT_MODES = [
  { value: "page", label: "Hide the whole page" },
  { value: "commerce", label: "Hide price and add to cart only" },
  { value: "manual", label: "Manual: only LockRules app blocks" },
] as const;

export type ProtectMode = (typeof PROTECT_MODES)[number]["value"];

export const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

// group: shown as option groups in the editor.
// remote: checked by our server through the app proxy, which issues a signed token.
export const CONDITION_TYPES = [
  { value: "signed_in", group: "Customer", label: "Customer is signed in", input: "none" },
  {
    value: "tag",
    group: "Customer",
    label: "Customer has a tag",
    input: "list",
    help: "Comma-separated. Passes if the customer has any of these tags.",
  },
  {
    value: "email_in",
    group: "Customer",
    label: "Customer email is in a list",
    input: "list",
    lists: "email",
    help: "One email per line or comma-separated.",
  },
  {
    value: "email_contains",
    group: "Customer",
    label: "Customer email contains",
    input: "list",
    help: "e.g. @acme.com. Comma-separated; passes if any match.",
  },
  {
    value: "passcode",
    group: "Visitor",
    label: "Visitor enters a passcode",
    input: "list",
    lists: "passcode",
    remote: true,
    help: "One or more passcodes, comma-separated. Add \"CODE -> /pages/next\" to redirect after unlocking.",
  },
  {
    value: "secret_link",
    group: "Visitor",
    label: "Visitor opens a secret link",
    input: "none",
    remote: true,
  },
  {
    value: "confirm",
    group: "Visitor",
    label: "Visitor confirms a prompt",
    input: "none",
    remote: true,
    help: "e.g. age confirmation. Uses the prompt text below.",
  },
  {
    value: "domain",
    group: "Visitor",
    label: "Visitor is on a domain",
    input: "list",
    help: "e.g. wholesale.example.com. Storefront only; not checked at checkout.",
  },
  {
    value: "country",
    group: "Location",
    label: "Visitor's country is",
    input: "list",
    help: "Two-letter codes, e.g. US, CA. Uses the shopper's selected or detected country.",
  },
  {
    value: "market",
    group: "Location",
    label: "Visitor is in a Shopify Market",
    input: "list",
    help: "Market handles, e.g. us, eu.",
  },
  {
    value: "ip",
    group: "Location",
    label: "Visitor's IP address is",
    input: "list",
    remote: true,
    help: "IPs or ranges in CIDR form, e.g. 203.0.113.7, 10.0.0.0/8.",
  },
  {
    value: "always",
    group: "Special",
    label: "Always permit",
    input: "none",
    help: "Opens the lock for everyone. Combine with other conditions or use for exclusions.",
  },
  {
    value: "liquid",
    group: "Special",
    label: "Custom Liquid (secure mode)",
    input: "liquid",
    help: "Liquid that outputs true when the condition passes, e.g. {% if customer.accepts_marketing %}true{% endif %}. Only runs in secure mode; otherwise it never passes.",
  },
  {
    value: "order_count",
    group: "Customer history",
    label: "Customer has placed at least N orders",
    input: "number",
  },
  {
    value: "purchased",
    group: "Customer history",
    label: "Customer has purchased a product",
    input: "products",
    help: "Passes if they bought any of these. Needs customer data access; run “Sync purchase history” in Settings once.",
  },
  {
    value: "cart_product",
    group: "Cart",
    label: "Cart contains a product",
    input: "products",
  },
  {
    value: "cart_variant",
    group: "Cart",
    label: "Cart contains a variant",
    input: "variants",
  },
  {
    value: "cart_subtotal",
    group: "Cart",
    label: "Cart subtotal is at least",
    input: "amount",
    help: "In your store currency. Shoppers paying in another currency are compared at checkout's exchange rate.",
  },
  {
    value: "date_after",
    group: "Time",
    label: "It's after a date",
    input: "datetime",
    help: "In your store's timezone.",
  },
  {
    value: "date_before",
    group: "Time",
    label: "It's before a date",
    input: "datetime",
    help: "In your store's timezone.",
  },
  {
    value: "schedule",
    group: "Time",
    label: "It's within a weekly schedule",
    input: "schedule",
    help: "In your store's timezone. An end time earlier than the start runs overnight.",
  },
] as const;

export type ConditionType = (typeof CONDITION_TYPES)[number]["value"];

export const REMOTE_CONDITIONS: ConditionType[] = CONDITION_TYPES.filter(
  (c) => "remote" in c && c.remote,
).map((c) => c.value);

export function conditionMeta(type: ConditionType) {
  return CONDITION_TYPES.find((c) => c.value === type) as
    | ((typeof CONDITION_TYPES)[number] & { help?: string; lists?: "email" | "passcode"; remote?: boolean })
    | undefined;
}

export const DENIED_ACTIONS = [
  { value: "login", label: "Ask guests to sign in, show a message otherwise" },
  { value: "message", label: "Show the access-denied message" },
  { value: "redirect", label: "Redirect to a URL" },
] as const;

export type DeniedAction = (typeof DENIED_ACTIONS)[number]["value"];

export const STORE_EXCEPTIONS = [
  { value: "home", label: "Home page" },
  { value: "policies", label: "Policy pages" },
  { value: "pages", label: "Online store pages" },
  { value: "search", label: "Search page" },
] as const;

export interface LockResource {
  id: string; // gid://shopify/Product/1
  handle: string;
  title: string;
}

export interface ConditionInput {
  // Stable id that survives edits; unlock tokens are signed against it.
  uid: string;
  type: ConditionType;
  values: string[];
  inverted: boolean;
  // Input list used in addition to values (email_in, passcode)
  listId?: string;
  // How long an unlock lasts (remote conditions). 0 = 30 days.
  minutes?: number;
  // confirm: prompt text
  prompt?: string;
  // secret_link: the code in the link
  code?: string;
  // products / variants inputs: display titles, parallel to values (gids)
  titles?: string[];
  // amount (store currency) / number (order count)
  amount?: number;
  // datetime: local "YYYY-MM-DDTHH:MM" in the store's timezone
  at?: string;
  // schedule: ISO weekdays (1 = Monday) and local "HH:MM" window
  days?: number[];
  from?: string;
  to?: string;
  // liquid: merchant-written Liquid that outputs "true"
  liquid?: string;
}

export function newUid() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

export function newCondition(type: ConditionType = "tag"): ConditionInput {
  return {
    uid: newUid(),
    type,
    values: [],
    inverted: false,
    ...(type === "secret_link" ? { code: newUid() } : {}),
    ...(type === "schedule" ? { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" } : {}),
    ...(type === "order_count" ? { amount: 1 } : {}),
  };
}

export interface KeyInput {
  conditions: ConditionInput[];
}

export interface LockInput {
  name: string;
  resourceType: ResourceType;
  resources: LockResource[];
  enabled: boolean;
  hideFromLists: boolean;
  hideNavLinks: boolean;
  deniedAction: DeniedAction;
  deniedMessage: string;
  redirectUrl: string;
  storeExceptions: string[];
  protect: ProtectMode;
  seoHidden: boolean;
  // liquid locks: Liquid that outputs "true" on pages the lock covers
  liquidCode: string;
  keys: KeyInput[];
}

export function emptyLock(): LockInput {
  return {
    name: "",
    resourceType: "product",
    resources: [],
    enabled: true,
    hideFromLists: false,
    hideNavLinks: false,
    protect: "page",
    seoHidden: false,
    liquidCode: "",
    deniedAction: "login",
    deniedMessage: "",
    redirectUrl: "",
    storeExceptions: [],
    keys: [{ conditions: [newCondition("signed_in")] }],
  };
}

export function conditionNeedsValues(type: ConditionType) {
  return conditionMeta(type)?.input === "list";
}

export function splitList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Returns a list of human-readable problems, empty when the lock is valid. */
export function validateLock(lock: LockInput): string[] {
  const errors: string[] = [];
  if (!lock.name.trim()) errors.push("Give the lock a name.");
  if (!RESOURCE_TYPES.some((r) => r.value === lock.resourceType)) {
    errors.push("Choose what to lock.");
  }
  if (!["store", "liquid"].includes(lock.resourceType) && lock.resources.length === 0) {
    errors.push("Pick at least one resource to lock.");
  }
  if (lock.resourceType === "liquid") {
    errors.push(...liquidProblems(lock.liquidCode, "Lock Liquid"));
  }
  if (lock.deniedAction === "redirect" && !/^(https?:\/\/|\/)/.test(lock.redirectUrl)) {
    errors.push("Redirect URL must start with / or https://.");
  }
  lock.keys.forEach((key, k) => {
    if (key.conditions.length === 0) {
      errors.push(`Key ${k + 1} has no conditions.`);
    }
    key.conditions.forEach((c, i) => {
      if (!CONDITION_TYPES.some((t) => t.value === c.type)) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: unknown condition.`);
      } else if (conditionNeedsValues(c.type) && c.values.length === 0 && !c.listId) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: enter at least one value.`);
      } else if (c.type === "ip" && c.values.some((v) => !isIpOrCidr(v))) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: not a valid IP address or range.`);
      } else if (c.type === "country" && c.values.some((v) => !/^[a-z]{2}$/i.test(v))) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: use two-letter country codes.`);
      } else if (c.type === "secret_link" && !c.code) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: secret link is missing its code.`);
      } else if (["products", "variants"].includes(conditionMeta(c.type)?.input ?? "") && !c.values.length) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: pick at least one item.`);
      } else if (["amount", "number"].includes(conditionMeta(c.type)?.input ?? "") && !(Number(c.amount) >= 0)) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: enter a number.`);
      } else if (conditionMeta(c.type)?.input === "datetime" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c.at ?? "")) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: enter a date and time.`);
      } else if (c.type === "liquid" && liquidProblems(c.liquid ?? "", "x").length) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: ${liquidProblems(c.liquid ?? "", "Custom Liquid")[0]}`);
      } else if (
        c.type === "schedule" &&
        (!c.days?.length || !/^\d{2}:\d{2}$/.test(c.from ?? "") || !/^\d{2}:\d{2}$/.test(c.to ?? "") || c.from === c.to)
      ) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: pick days and a start and end time (HH:MM).`);
      }
    });
  });
  return errors;
}

/** Numeric id from a Shopify gid, as a string ("gid://shopify/Product/12" -> "12"). */
export function legacyId(gid: string) {
  return gid.split("/").pop() ?? gid;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isIpOrCidr(value: string) {
  const [ip, bits, extra] = value.split("/");
  if (extra !== undefined) return false;
  if (IPV4.test(ip)) return bits === undefined || (/^\d+$/.test(bits) && +bits <= 32);
  // IPv6: accept hex groups with optional :: compression.
  if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(":")) {
    return bits === undefined || (/^\d+$/.test(bits) && +bits <= 128);
  }
  return false;
}

/** "CODE -> /pages/x" => { code: "CODE", redirect: "/pages/x" } */
export function parsePasscode(entry: string) {
  const [code, redirect] = entry.split("->").map((s) => s.trim());
  return { code, redirect: redirect || undefined };
}

/**
 * Basic checks on merchant-written Liquid before it goes into the theme.
 * Shopify validates syntax when secure mode writes the file.
 */
export function liquidProblems(code: string, what: string) {
  const problems: string[] = [];
  if (!code.trim()) problems.push(`${what}: enter some Liquid.`);
  if (code.length > 5000) problems.push(`${what}: keep it under 5,000 characters.`);
  if (/\{%-?\s*(schema|javascript|stylesheet|section|layout)\b/.test(code)) {
    problems.push(`${what}: schema, section, layout, javascript and stylesheet tags aren't allowed.`);
  }
  return problems;
}
