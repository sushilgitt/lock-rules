import type {
  CartValidationsGenerateRunInput,
  CartValidationsGenerateRunResult,
  ValidationError,
} from "../generated/api";
import { hmacSha256Hex } from "./hmac";

// Mirrors CheckoutConfig in app/lib/compile.server.ts.
type Condition = {
  t: string;
  v: string[];
  inv: boolean;
  id?: string;
  n?: number;
  s?: number;
  o?: boolean;
  x?: boolean;
};
type Key = { c: Condition[] };
type LockType = "product" | "collection" | "store" | "variant" | "vendor" | "product_tag";
type Lock = { id: string; type: LockType; ids: string[]; keys: Key[] };
type Config = { locks: Lock[]; message: string; secret?: string };

type Buyer = {
  signedIn: boolean;
  email: string;
  tags: Set<string>;
  orders: number;
  purchased: Set<string>;
  country: string;
  // Condition uids unlocked by a valid, unexpired token in the `_lr` cart attribute.
  unlocked: Set<string>;
  cartProducts: Set<string>;
  cartVariants: Set<string>;
  subtotal: number; // store currency
  weekday: number; // 1 = Monday
  dateSlots: boolean[]; // shop local time is at/after slot datetime
  scheduleSlots: boolean[]; // shop local time is within slot window
};

const legacy = (gid: string) => gid.split("/").pop() ?? gid;

/**
 * Tokens are "<uid>.<exp>.<hmac>" (see app/lib/tokens.server.ts). Functions
 * can't read the clock, so expiry is checked against the shop's local date:
 * a token stays valid until the end of the day it expires.
 */
export function unlockedConditions(raw: string | null | undefined, secret: string, today: string) {
  const unlocked = new Set<string>();
  if (!raw || !secret) return unlocked;
  for (const token of raw.split(" ")) {
    const [uid, exp, sig] = token.split(".");
    if (!uid || !exp || !sig) continue;
    const expDate = new Date(Number(exp) * 1000).toISOString().slice(0, 10);
    if (expDate < today) continue;
    if (hmacSha256Hex(secret, `${uid}.${exp}`) === sig) unlocked.add(uid);
  }
  return unlocked;
}

function conditionPasses(c: Condition, buyer: Buyer): boolean {
  // Too large to ship to checkout (see compile.server.ts); the storefront enforces it.
  if (c.x) return true;
  let pass: boolean;
  switch (c.t) {
    case "always":
      pass = true;
      break;
    case "signed_in":
      pass = buyer.signedIn;
      break;
    case "tag":
      pass = c.v.some((tag) => buyer.tags.has(tag));
      break;
    // Email conditions only trust the signed-in customer's email, never one typed at checkout.
    case "email_in":
      pass = buyer.signedIn && c.v.includes(buyer.email);
      break;
    case "email_contains":
      pass = buyer.signedIn && c.v.some((part) => buyer.email.includes(part));
      break;
    case "order_count":
      pass = buyer.signedIn && buyer.orders >= (c.n ?? 1);
      break;
    case "purchased":
      pass = buyer.signedIn && c.v.some((id) => buyer.purchased.has(id));
      break;
    case "cart_product":
      pass = c.v.some((id) => buyer.cartProducts.has(id));
      break;
    case "cart_variant":
      pass = c.v.some((id) => buyer.cartVariants.has(id));
      break;
    case "cart_subtotal":
      pass = buyer.subtotal >= (c.n ?? 0);
      break;
    case "country":
      pass = c.v.includes(buyer.country);
      break;
    case "passcode":
    case "secret_link":
    case "confirm":
    case "ip":
    case "newsletter":
    case "klaviyo_member":
      pass = Boolean(c.id && buyer.unlocked.has(c.id));
      break;
    case "date_after":
    case "date_before":
      // Beyond the checkout's time slots: only the storefront enforces it.
      if (c.s === undefined) return true;
      pass = c.t === "date_after" ? buyer.dateSlots[c.s] : !buyer.dateSlots[c.s];
      break;
    case "schedule": {
      if (c.s === undefined) return true;
      const inWindow = c.o ? !buyer.scheduleSlots[c.s] : buyer.scheduleSlots[c.s];
      pass = c.v.includes(String(buyer.weekday)) && inWindow;
      break;
    }
    case "domain":
    case "market":
    case "liquid":
      // Not available to checkout functions; the storefront enforces these.
      return true;
    default:
      pass = false;
  }
  return c.inv ? !pass : pass;
}

export function lockOpens(lock: Lock, buyer: Buyer): boolean {
  return lock.keys.some((key) => key.c.length > 0 && key.c.every((c) => conditionPasses(c, buyer)));
}

export function cartValidationsGenerateRun(
  input: CartValidationsGenerateRunInput,
): CartValidationsGenerateRunResult {
  const config = input.validation.config?.jsonValue as Config | undefined;
  const errors: ValidationError[] = [];

  if (config?.locks?.length) {
    const customer = input.cart.buyerIdentity?.customer;
    const time = input.shop.localTime;
    const variants = input.cart.lines.flatMap((l) =>
      l.merchandise.__typename === "ProductVariant" ? [l.merchandise] : [],
    );
    const rate = Number(input.presentmentCurrencyRate) || 1;
    const purchased = customer?.purchased?.jsonValue;

    const buyer: Buyer = {
      signedIn: Boolean(customer),
      email: (customer?.email ?? "").toLowerCase(),
      tags: new Set(
        (customer?.hasTags ?? []).filter((t) => t.hasTag).map((t) => t.tag.toLowerCase()),
      ),
      orders: customer?.numberOfOrders ?? 0,
      purchased: new Set(Array.isArray(purchased) ? purchased.map(String) : []),
      country: String(input.localization.country.isoCode).toLowerCase(),
      unlocked: unlockedConditions(input.cart.tokens?.value, config.secret ?? "", time.date),
      cartProducts: new Set(variants.map((v) => legacy(v.product.id))),
      cartVariants: new Set(variants.map((v) => legacy(v.id))),
      subtotal: Number(input.cart.cost.subtotalAmount.amount) / rate,
      weekday: ((new Date(`${time.date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1,
      dateSlots: [time.d0, time.d1],
      scheduleSlots: [time.w0, time.w1],
    };

    const openCache = new Map<string, boolean>();
    const isOpen = (lock: Lock) => {
      if (!openCache.has(lock.id)) openCache.set(lock.id, lockOpens(lock, buyer));
      return openCache.get(lock.id)!;
    };

    const reported = new Set<string>();
    for (const variant of variants) {
      const product = variant.product;
      if (reported.has(variant.id)) continue;

      const memberOf = new Set(
        product.inCollections.filter((m) => m.isMember).map((m) => m.collectionId),
      );
      const productTags = new Set(
        product.productTags.filter((t) => t.hasTag).map((t) => t.tag.toLowerCase()),
      );
      const vendor = (product.vendor ?? "").toLowerCase();

      const denied = config.locks.some((lock) => {
        let applies = false;
        switch (lock.type) {
          case "store":
            applies = true;
            break;
          case "product":
            applies = lock.ids.includes(product.id);
            break;
          case "variant":
            applies = lock.ids.includes(variant.id);
            break;
          case "collection":
            applies = lock.ids.some((id) => memberOf.has(id));
            break;
          case "vendor":
            applies = lock.ids.includes(vendor);
            break;
          case "product_tag":
            applies = lock.ids.some((t) => productTags.has(t));
            break;
        }
        return applies && !isOpen(lock);
      });

      if (denied) {
        reported.add(variant.id);
        errors.push({
          message: (config.message || "{title} isn't available for your account.").replace(
            "{title}",
            product.title,
          ),
          target: "$.cart",
        });
      }
    }
  }

  return { operations: [{ validationAdd: { errors } }] };
}
