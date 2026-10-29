import type {
  CartValidationsGenerateRunInput,
  CartValidationsGenerateRunResult,
  ValidationError,
} from "../generated/api";

// Mirrors CheckoutConfig in app/lib/compile.server.ts.
type Condition = { t: string; v: string[]; inv: boolean };
type Key = { c: Condition[] };
type Lock = { id: string; type: "product" | "collection" | "store"; ids: string[]; keys: Key[] };
type Config = { locks: Lock[]; message: string };

type Buyer = { signedIn: boolean; email: string; tags: Set<string> };

function conditionPasses(c: Condition, buyer: Buyer): boolean {
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
    default:
      // Conditions checkout can't evaluate (passcodes, geo, ...) never open a lock here.
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
    const buyer: Buyer = {
      signedIn: Boolean(customer),
      email: (customer?.email ?? "").toLowerCase(),
      tags: new Set(
        (customer?.hasTags ?? []).filter((t) => t.hasTag).map((t) => t.tag.toLowerCase()),
      ),
    };

    const openCache = new Map<string, boolean>();
    const isOpen = (lock: Lock) => {
      if (!openCache.has(lock.id)) openCache.set(lock.id, lockOpens(lock, buyer));
      return openCache.get(lock.id)!;
    };

    const reported = new Set<string>();
    for (const line of input.cart.lines) {
      if (line.merchandise.__typename !== "ProductVariant") continue;
      const product = line.merchandise.product;
      if (reported.has(product.id)) continue;

      const memberOf = new Set(
        product.inCollections.filter((m) => m.isMember).map((m) => m.collectionId),
      );
      const denied = config.locks.some((lock) => {
        const applies =
          lock.type === "store" ||
          (lock.type === "product" && lock.ids.includes(product.id)) ||
          (lock.type === "collection" && lock.ids.some((id) => memberOf.has(id)));
        return applies && !isOpen(lock);
      });

      if (denied) {
        reported.add(product.id);
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
