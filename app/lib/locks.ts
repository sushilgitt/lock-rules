// Shared (client + server) lock types and the condition catalog.

export const RESOURCE_TYPES = [
  { value: "product", label: "Products" },
  { value: "collection", label: "Collections" },
  { value: "page", label: "Pages" },
  { value: "blog", label: "Blogs" },
  { value: "article", label: "Blog posts" },
  { value: "store", label: "Entire store" },
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number]["value"];

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
  if (lock.resourceType !== "store" && lock.resources.length === 0) {
    errors.push("Pick at least one resource to lock.");
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
