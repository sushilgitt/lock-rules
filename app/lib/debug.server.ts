// "Why isn't my lock working?" — evaluates the compiled storefront config for a
// simulated visitor and page, explaining every condition. Mirrors
// extensions/lockrules-embed/snippets/lr_applies.liquid and lr_open.liquid.
import type { StorefrontConfig, StorefrontLock } from "./compile.server";

export interface Visitor {
  signedIn: boolean;
  email: string;
  tags: string[];
  orders: number;
  purchased: string[]; // product legacy ids
  country: string;
  market: string;
  host: string;
  subtotalCents: number;
  cartProducts: string[];
  now: number; // epoch seconds
  weekday: number; // 1 = Monday, store time
  hm: number; // HHMM, store time
  unlockedRemote: boolean; // pretend passcodes, links, prompts, IP and newsletter keys were unlocked
  customLiquid: boolean; // pretend custom Liquid passes
}

export interface PageContext {
  template: "product" | "collection" | "page" | "index" | "other";
  id?: string; // legacy id
  collections?: string[];
  vendor?: string;
  tags?: string[];
  variants?: string[];
  title?: string;
}

export interface ConditionResult {
  label: string;
  pass: boolean;
  why: string;
}

export interface LockResult {
  id: string;
  applies: boolean;
  appliesWhy: string;
  open: boolean;
  keys: { pass: boolean; conditions: ConditionResult[] }[];
}

const REMOTE = ["passcode", "secret_link", "confirm", "ip", "newsletter", "klaviyo_member"];

function applies(lock: StorefrontLock, page: PageContext): [boolean, string] {
  const has = (list: string[] | undefined, v: string | undefined) => Boolean(v && list?.includes(v));
  switch (lock.type) {
    case "store":
      if (page.template === "index" && lock.ex.includes("home")) return [false, "Home page is an exception"];
      if (page.template === "page" && lock.ex.includes("pages")) return [false, "Pages are an exception"];
      return [true, "Covers the whole store"];
    case "product":
      return page.template === "product" && has(lock.ids, page.id)
        ? [true, "This product is locked"]
        : [false, "Not one of the locked products"];
    case "collection":
      if (page.template === "collection" && has(lock.ids, page.id)) return [true, "This collection is locked"];
      if (page.template === "product" && page.collections?.some((c) => lock.ids.includes(c))) {
        return [true, "The product is in a locked collection"];
      }
      return [false, "Not in a locked collection"];
    case "vendor":
      return page.template === "product" && lock.ids.includes((page.vendor ?? "").toLowerCase())
        ? [true, `Vendor “${page.vendor}” is locked`]
        : [false, "Vendor isn't locked"];
    case "product_tag": {
      const tag = page.tags?.find((t) => lock.ids.includes(t.toLowerCase()));
      return page.template === "product" && tag ? [true, `Tagged “${tag}”`] : [false, "No locked tag"];
    }
    case "variant":
      return page.template === "product" && page.variants?.some((v) => lock.ids.includes(v))
        ? [true, "Has locked variants (they're removed from the picker)"]
        : [false, "No locked variants"];
    case "page":
      return page.template === "page" && has(lock.ids, page.id) ? [true, "This page is locked"] : [false, "Different page"];
    case "liquid":
      return [false, "Liquid locks only run in secure mode; not simulated"];
    default:
      return [false, `${lock.type} locks aren't simulated for this page`];
  }
}

function condition(c: StorefrontLock["keys"][number]["c"][number], v: Visitor): ConditionResult {
  const list = c.v.join(", ");
  let pass = false;
  let label = c.t;
  let why = "";
  switch (c.t) {
    case "always":
      [label, pass, why] = ["Always permit", true, "Always passes"];
      break;
    case "signed_in":
      [label, pass, why] = ["Signed in", v.signedIn, v.signedIn ? "Visitor is signed in" : "Visitor is a guest"];
      break;
    case "tag": {
      const hit = c.v.find((t) => v.tags.map((x) => x.toLowerCase()).includes(t));
      [label, pass, why] = [`Has tag: ${list}`, Boolean(hit), hit ? `Has “${hit}”` : `Tags: ${v.tags.join(", ") || "none"}`];
      break;
    }
    case "email_in":
      pass = v.signedIn && c.v.includes(v.email.toLowerCase());
      [label, why] = [`Email in list (${c.v.length})`, pass ? "Email is on the list" : v.signedIn ? "Email isn't on the list" : "Guests have no email"];
      break;
    case "email_contains": {
      const hit = c.v.find((p) => v.email.toLowerCase().includes(p));
      pass = v.signedIn && Boolean(hit);
      [label, why] = [`Email contains: ${list}`, pass ? `Contains “${hit}”` : "No match"];
      break;
    }
    case "order_count":
      pass = v.signedIn && v.orders >= (c.n ?? 1);
      [label, why] = [`At least ${c.n} orders`, `Has ${v.orders}`];
      break;
    case "purchased": {
      pass = v.signedIn && c.v.some((id) => v.purchased.includes(id));
      [label, why] = ["Has purchased a product", pass ? "Bought one of them" : "Hasn't bought any of them"];
      break;
    }
    case "cart_product":
      pass = c.v.some((id) => v.cartProducts.includes(id));
      [label, why] = ["Cart has a product", pass ? "It's in the cart" : "Not in the cart"];
      break;
    case "cart_variant":
      [label, pass, why] = ["Cart has a variant", false, "Cart variants aren't simulated"];
      break;
    case "cart_subtotal":
      pass = v.subtotalCents >= (c.n ?? 0);
      [label, why] = [`Subtotal at least ${((c.n ?? 0) / 100).toFixed(2)}`, `Cart is ${(v.subtotalCents / 100).toFixed(2)}`];
      break;
    case "date_after":
      pass = v.now >= (c.n ?? 0);
      [label, why] = [`After ${new Date((c.n ?? 0) * 1000).toLocaleString()}`, pass ? "Date has passed" : "Too early"];
      break;
    case "date_before":
      pass = v.now < (c.n ?? 0);
      [label, why] = [`Before ${new Date((c.n ?? 0) * 1000).toLocaleString()}`, pass ? "Still before" : "Date has passed"];
      break;
    case "schedule": {
      const f = Number(c.f), e = Number(c.e);
      const inWindow = f < e ? v.hm >= f && v.hm < e : v.hm >= f || v.hm < e;
      pass = c.v.includes(String(v.weekday)) && inWindow;
      [label, why] = [`Schedule ${c.f}–${c.e}`, pass ? "Within the schedule" : "Outside the schedule"];
      break;
    }
    case "domain":
      pass = c.v.includes(v.host.toLowerCase());
      [label, why] = [`Domain: ${list}`, `Visitor is on ${v.host || "the primary domain"}`];
      break;
    case "country":
      pass = c.v.includes(v.country.toLowerCase());
      [label, why] = [`Country: ${list.toUpperCase()}`, `Visitor is in ${v.country.toUpperCase() || "?"}`];
      break;
    case "market":
      pass = c.v.includes(v.market.toLowerCase());
      [label, why] = [`Market: ${list}`, `Visitor's market is ${v.market || "?"}`];
      break;
    case "liquid":
      [label, pass, why] = ["Custom Liquid", v.customLiquid, "Assumed from the simulator setting"];
      break;
    default:
      if (REMOTE.includes(c.t)) {
        [label, pass, why] = [
          c.t.replace(/_/g, " "),
          v.unlockedRemote,
          v.unlockedRemote ? "Assumed unlocked" : "Visitor hasn't unlocked it (passcode, link, prompt, IP or signup)",
        ];
      } else {
        why = "Unknown condition";
      }
  }
  if (c.inv) {
    pass = !pass;
    label = `NOT ${label}`;
    why = `${why} (inverted)`;
  }
  return { label, pass, why };
}

export function simulate(config: StorefrontConfig, visitor: Visitor, page: PageContext): LockResult[] {
  return config.locks.map((lock) => {
    const [does, appliesWhy] = applies(lock, page);
    const keys = lock.keys.map((k) => {
      const conditions = k.c.map((c) => condition(c, visitor));
      return { pass: conditions.length > 0 && conditions.every((c) => c.pass), conditions };
    });
    return { id: lock.id, applies: does, appliesWhy, open: keys.some((k) => k.pass), keys };
  });
}
