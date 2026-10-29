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

export const CONDITION_TYPES = [
  {
    value: "signed_in",
    label: "Customer is signed in",
    input: "none",
  },
  {
    value: "tag",
    label: "Customer has a tag",
    input: "list",
    help: "Comma-separated. Passes if the customer has any of these tags.",
  },
  {
    value: "email_in",
    label: "Customer email is in a list",
    input: "list",
    help: "One email per line or comma-separated.",
  },
  {
    value: "email_contains",
    label: "Customer email contains",
    input: "list",
    help: "e.g. @acme.com. Comma-separated; passes if any match.",
  },
  {
    value: "always",
    label: "Always permit",
    input: "none",
    help: "Opens the lock for everyone. Combine with other conditions or use for exclusions.",
  },
] as const;

export type ConditionType = (typeof CONDITION_TYPES)[number]["value"];

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
  type: ConditionType;
  values: string[];
  inverted: boolean;
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
    keys: [{ conditions: [{ type: "signed_in", values: [], inverted: false }] }],
  };
}

export function conditionNeedsValues(type: ConditionType) {
  return CONDITION_TYPES.find((c) => c.value === type)?.input === "list";
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
      } else if (conditionNeedsValues(c.type) && c.values.length === 0) {
        errors.push(`Key ${k + 1}, condition ${i + 1}: enter at least one value.`);
      }
    });
  });
  return errors;
}

/** Numeric id from a Shopify gid, as a string ("gid://shopify/Product/12" -> "12"). */
export function legacyId(gid: string) {
  return gid.split("/").pop() ?? gid;
}
