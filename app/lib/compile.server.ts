import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { listLocks, readParams, type LockWithKeys } from "../models/lock.server";
import {
  legacyId,
  NAMED_RESOURCE_TYPES,
  REMOTE_CONDITIONS,
  type ConditionType,
  type LockResource,
  type ResourceType,
} from "./locks";
import { getSettings, type Messages } from "./settings";
import { newSecret } from "./tokens.server";
import { localToEpoch } from "./time";
import { syncSeo } from "./seo.server";
import { syncPaymentRules } from "./payments.server";
import { refreshSnippets, writeShopConfig } from "./secure/install.server";
import { currentPlan } from "./billing.server";

/*
 * The compiler turns the locks stored in our database into two JSON documents:
 *
 * 1. Storefront config: an app-data metafield on the AppInstallation
 *    (`app.metafields.lockrules.config` in the theme app extension). The app
 *    embed evaluates it in Liquid on every page view, so no request ever
 *    reaches our server. The token secret sits next to it in
 *    `app.metafields.lockrules.secret`.
 * 2. Checkout config: `$app:config` + `$app:vars` metafields on the
 *    Validation that runs our cart & checkout validation function. `vars`
 *    feeds the input query variables (tags / collection ids to test).
 *
 * Remote conditions (passcode, secret_link, confirm, ip) only carry their uid:
 * their values stay on our server, which checks them through the app proxy and
 * hands out signed tokens (see tokens.server.ts).
 *
 * Keep condition codes in sync with the Liquid evaluator in
 * extensions/lockrules-embed/blocks/lock_embed.liquid and the function in
 * extensions/checkout-lock/src.
 */

export const CONFIG_NAMESPACE = "lockrules";
export const CONFIG_KEY = "config";
export const SECRET_KEY = "secret";
export const FUNCTION_HANDLE = "checkout-lock";
// Shopify rejects list variables with more than 100 elements.
const MAX_FUNCTION_LIST = 100;
// JSON metafields are capped at 128KB; leave headroom.
const MAX_CONFIG_BYTES = 120_000;

// Fixed input-query slots the checkout function uses for time conditions
// (shop.localTime.dateTimeAfter / timeBetween need literal arguments).
// Functions cap input query cost at 30, which leaves room for one of each.
export const DATE_SLOTS = 1;
export const SCHEDULE_SLOTS = 1;
// Functions don't receive metafields over 10,000 bytes.
const MAX_CHECKOUT_BYTES = 9_500;

// n: number (storefront: cents / order count / epoch; checkout: amount / order count)
// f/e: schedule window "HHMM" (storefront) or "HH:MM:00" (checkout)
// at: checkout local datetime; s: checkout time slot
type CompiledCondition = {
  t: string;
  v: string[];
  inv: boolean;
  id?: string;
  p?: string;
  n?: number;
  f?: string;
  e?: string;
  at?: string;
  s?: number;
  // checkout schedule that wraps past midnight: slot holds the reversed window
  o?: boolean;
  // checkout: values left out to fit the function's metafield limit; storefront-only
  x?: boolean;
};
type CompiledKey = { c: CompiledCondition[] };

export interface StorefrontLock {
  id: string;
  type: string;
  ids: string[]; // numeric ids as strings, matched against `product.id | append: ''`
  handles: string[];
  keys: CompiledKey[];
  hide: boolean;
  nav: boolean;
  act: string;
  msg: string;
  url: string;
  ex: string[];
  pm: string;
  // protect = sections: comma-joined CSS selector list
  sel: string;
}

export interface StorefrontConfig {
  v: 2;
  locks: StorefrontLock[];
  msg: Messages;
  msgs: Record<string, Partial<Messages>>;
}

export const CHECKOUT_TYPES = ["product", "collection", "store", "variant", "vendor", "product_tag"] as const;

export interface CheckoutLock {
  id: string;
  type: (typeof CHECKOUT_TYPES)[number];
  ids: string[]; // gids, or lowercased names for vendor / product_tag
  keys: CompiledKey[];
}

export interface CheckoutConfig {
  locks: CheckoutLock[];
  message: string;
  secret: string;
}

export type ListEntries = Map<string, { v: string; r?: string }[]>;

type Target = "storefront" | "checkout";

function compileKeys(
  lock: LockWithKeys,
  lists: ListEntries,
  timeZone: string,
  target: Target,
): CompiledKey[] {
  return lock.keys.map((key) => ({
    c: key.conditions.map((c) => {
      const type = c.type as ConditionType;
      const params = readParams(c.params);
      const compiled: CompiledCondition = { t: type, v: [], inv: c.inverted };
      const hhmm = (t?: string) => (target === "checkout" ? `${t}:00` : (t ?? "").replace(":", ""));

      if (type === "liquid") {
        compiled.id = params.uid;
        return compiled;
      }

      if (REMOTE_CONDITIONS.includes(type)) {
        compiled.id = params.uid;
        if ((type === "confirm" || type === "newsletter") && params.prompt && target === "storefront") {
          compiled.p = params.prompt;
        }
        return compiled;
      }

      switch (type) {
        case "b2b":
          compiled.v = params.values.map((id) => (target === "checkout" ? id : legacyId(id)));
          return compiled;
        case "cart_product":
        case "purchased":
        case "cart_variant":
          compiled.v = params.values.map(legacyId);
          return compiled;
        case "order_count":
          compiled.n = Math.max(0, Math.floor(params.amount ?? 1));
          return compiled;
        case "cart_subtotal":
          compiled.n =
            target === "checkout" ? (params.amount ?? 0) : Math.round((params.amount ?? 0) * 100);
          return compiled;
        case "date_after":
        case "date_before":
          if (target === "checkout") compiled.at = `${params.at}:00`;
          else compiled.n = localToEpoch(params.at ?? "", timeZone) ?? 0;
          return compiled;
        case "schedule":
          compiled.v = (params.days ?? []).map(String);
          compiled.f = hhmm(params.from);
          compiled.e = hhmm(params.to);
          return compiled;
      }

      let values = params.values;
      if (type === "email_in" && params.listId) {
        values = values.concat((lists.get(params.listId) ?? []).map((e) => e.v));
      }
      // Everything compares case-insensitively; Liquid and the function downcase their side.
      compiled.v = [...new Set(values.map((s) => s.trim().toLowerCase()).filter(Boolean))];
      return compiled;
    }),
  }));
}

function lockIds(lock: LockWithKeys, target: Target) {
  const resources = (lock.resources ?? []) as unknown as LockResource[];
  if (NAMED_RESOURCE_TYPES.includes(lock.resourceType as ResourceType)) {
    return resources.map((r) => r.title.trim().toLowerCase());
  }
  return resources.map((r) => (target === "checkout" ? r.id : legacyId(r.id)));
}

export function compile(
  locks: LockWithKeys[],
  settings: ReturnType<typeof getSettings>,
  lists: ListEntries,
  secret: string,
  timeZone = "UTC",
) {
  const enabled = locks.filter((l) => l.enabled);

  const storefront: StorefrontConfig = {
    v: 2,
    msg: settings.messages,
    msgs: settings.translations,
    locks: enabled.map((lock) => {
      const resources = (lock.resources ?? []) as unknown as LockResource[];
      return {
        id: lock.id,
        type: lock.resourceType,
        ids: lockIds(lock, "storefront"),
        // Only handle-addressable types can be hidden from lists and menus.
        handles: ["product", "collection", "page", "blog"].includes(lock.resourceType)
          ? resources.map((r) => r.handle)
          : [],
        keys: compileKeys(lock, lists, timeZone, "storefront"),
        hide: lock.hideFromLists,
        nav: lock.hideNavLinks,
        act: lock.deniedAction,
        msg: lock.deniedMessage ?? "",
        url: lock.redirectUrl ?? "",
        ex: (lock.storeExceptions ?? []) as string[],
        pm: lock.protect,
        sel:
          lock.protect === "sections"
            ? (lock.sectionSelectors ?? "")
                .split(/\r?\n/)
                .map((s) => s.trim().replace(/[<>{}]/g, ""))
                .filter(Boolean)
                .join(", ")
            : "",
      };
    }),
  };

  const checkoutLocks: CheckoutLock[] = enabled
    .filter((l) => (CHECKOUT_TYPES as readonly string[]).includes(l.resourceType))
    .map((lock) => ({
      id: lock.id,
      type: lock.resourceType as CheckoutLock["type"],
      ids: lockIds(lock, "checkout"),
      keys: compileKeys(lock, lists, timeZone, "checkout"),
    }));

  const tags = new Set<string>();
  const productTags = new Set<string>();
  const collectionIds = new Set<string>();
  const dateSlots: string[] = [];
  const scheduleSlots: { f: string; e: string }[] = [];
  let slotsFull = false;
  for (const lock of checkoutLocks) {
    if (lock.type === "collection") lock.ids.forEach((id) => collectionIds.add(id));
    if (lock.type === "product_tag") lock.ids.forEach((t) => productTags.add(t));
    for (const key of lock.keys) {
      for (const c of key.c) {
        if (c.t === "tag") c.v.forEach((t) => tags.add(t));
        if ((c.t === "date_after" || c.t === "date_before") && c.at) {
          let slot = dateSlots.indexOf(c.at);
          if (slot < 0 && dateSlots.length < DATE_SLOTS) slot = dateSlots.push(c.at) - 1;
          if (slot >= 0) c.s = slot;
          else slotsFull = true;
        }
        if (c.t === "schedule" && c.f && c.e) {
          // timeBetween needs start < end, so overnight windows are stored reversed.
          const w = c.f > c.e ? { f: c.e, e: c.f } : { f: c.f, e: c.e };
          if (c.f > c.e) c.o = true;
          let slot = scheduleSlots.findIndex((x) => x.f === w.f && x.e === w.e);
          if (slot < 0 && scheduleSlots.length < SCHEDULE_SLOTS) {
            slot = scheduleSlots.push(w) - 1;
          }
          if (slot >= 0) c.s = slot;
          else slotsFull = true;
        }
      }
    }
  }

  const warnings: string[] = [];
  if (slotsFull) {
    warnings.push(
      `Checkout checks up to ${DATE_SLOTS} different dates and ${SCHEDULE_SLOTS} schedule windows. Extra time conditions only apply on the storefront.`,
    );
  }
  if (tags.size > MAX_FUNCTION_LIST) {
    warnings.push(`Checkout protection only checks the first ${MAX_FUNCTION_LIST} customer tags.`);
  }
  if (collectionIds.size > MAX_FUNCTION_LIST) {
    warnings.push(`Checkout protection only checks the first ${MAX_FUNCTION_LIST} locked collections.`);
  }
  const size = Buffer.byteLength(JSON.stringify(storefront));
  if (size > MAX_CONFIG_BYTES) {
    warnings.push(
      `Your locks compile to ${Math.round(size / 1024)}KB, over the 120KB storefront limit. Use shorter email lists or customer tags instead.`,
    );
  }

  const checkout: CheckoutConfig = { locks: checkoutLocks, message: settings.messages.checkout, secret };
  if (Buffer.byteLength(JSON.stringify(checkout)) > MAX_CHECKOUT_BYTES) {
    // Email lists are the usual culprit: enforce them on the storefront only.
    for (const lock of checkout.locks) {
      for (const key of lock.keys) {
        for (const c of key.c) {
          if (c.t === "email_in" && c.v.length) {
            c.v = [];
            c.x = true;
          }
        }
      }
    }
    warnings.push(
      Buffer.byteLength(JSON.stringify(checkout)) > MAX_CHECKOUT_BYTES
        ? "Your locks are too large for checkout protection, so checkout isn't enforcing them. Reduce the number of locks or values."
        : "Email lists are too long to check at checkout, so they only apply on the storefront. Use customer tags for checkout protection.",
    );
  }

  return {
    storefront,
    checkout,
    vars: {
      tags: [...tags].slice(0, MAX_FUNCTION_LIST),
      productTags: [...productTags].slice(0, MAX_FUNCTION_LIST),
      collectionIds: [...collectionIds].slice(0, MAX_FUNCTION_LIST),
      ...Object.fromEntries(dateSlots.map((at, i) => [`d${i}`, at])),
      ...Object.fromEntries(
        scheduleSlots.flatMap((w, i) => [
          [`w${i}s`, w.f],
          [`w${i}e`, w.e],
        ]),
      ),
    },
    warnings,
    tooLarge: size > MAX_CONFIG_BYTES,
  };
}

export type GraphQL = AdminApiContext["graphql"];

export async function gql<T = any>(graphql: GraphQL, query: string, variables?: Record<string, unknown>) {
  const res = await graphql(query, { variables });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

export function userErrors(errors: { message: string }[] | undefined, what: string) {
  if (errors?.length) throw new Error(`${what}: ${errors.map((e) => e.message).join("; ")}`);
}

export type MetafieldInput = { ownerId?: string; namespace: string; key: string; value: string; type?: string };

export async function setMetafields(graphql: GraphQL, metafields: MetafieldInput[]) {
  const data = await gql(
    graphql,
    `#graphql
    mutation LockRulesSetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message code }
      }
    }`,
    { metafields: metafields.map((m) => ({ type: "json", ...m })) },
  );
  return data.metafieldsSet.userErrors as { message: string; code?: string }[];
}

async function syncValidation(
  graphql: GraphQL,
  shop: { id: string; validationId: string | null },
  checkout: CheckoutConfig,
  vars: Record<string, unknown>,
) {
  const metafields = (ownerId?: string): MetafieldInput[] => [
    { ...(ownerId ? { ownerId } : {}), namespace: "$app", key: "config", value: JSON.stringify(checkout) },
    { ...(ownerId ? { ownerId } : {}), namespace: "$app", key: "vars", value: JSON.stringify(vars) },
  ];

  if (shop.validationId) {
    const errors = await setMetafields(graphql, metafields(shop.validationId));
    if (!errors.length) return shop.validationId;
    // The merchant may have deleted the validation in Settings > Checkout; recreate it below.
  }

  const data = await gql(
    graphql,
    `#graphql
    mutation LockRulesCreateValidation($validation: ValidationCreateInput!) {
      validationCreate(validation: $validation) {
        validation { id }
        userErrors { field message }
      }
    }`,
    {
      validation: {
        functionHandle: FUNCTION_HANDLE,
        title: "LockRules checkout protection",
        enable: true,
        blockOnFailure: false,
        metafields: metafields().map((m) => ({ type: "json", ...m })),
      },
    },
  );
  userErrors(data.validationCreate.userErrors, "Checkout protection");
  const id = data.validationCreate.validation.id as string;
  await prisma.shop.update({ where: { id: shop.id }, data: { validationId: id } });
  return id;
}

export async function loadListEntries(shopId: string): Promise<ListEntries> {
  const lists = await prisma.inputList.findMany({ where: { shopId } });
  return new Map(lists.map((l) => [l.id, (l.entries ?? []) as { v: string; r?: string }[]]));
}

/** Recompiles every lock for the shop and pushes the result to Shopify. */
export async function syncShop(graphql: GraphQL, domain: string) {
  let shop = await prisma.shop.findUniqueOrThrow({ where: { domain } });
  if (!shop.hmacSecret) {
    shop = await prisma.shop.update({ where: { id: shop.id }, data: { hmacSecret: newSecret() } });
  }
  const secret = shop.hmacSecret!;
  const [allLocks, lists] = await Promise.all([listLocks(shop.id), loadListEntries(shop.id)]);
  const plan = await currentPlan(graphql, domain);
  const enabledIds = allLocks.filter((l) => l.enabled).slice(0, plan.maxLocks).map((l) => l.id);
  const locks = allLocks.map((l) => (l.enabled && !enabledIds.includes(l.id) ? { ...l, enabled: false } : l));
  const overLimit = allLocks.filter((l) => l.enabled).length - enabledIds.length;
  const settings = getSettings(shop.settings);
  const problems: string[] = [];
  let timeZone = "UTC";
  try {
    const data = await gql(graphql, `#graphql
      query LockRulesShopTimezone { shop { ianaTimezone } }`);
    timeZone = data.shop.ianaTimezone || "UTC";
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
  const { storefront, checkout, vars, warnings, tooLarge } = compile(
    locks,
    settings,
    lists,
    secret,
    timeZone,
  );
  problems.push(...warnings);
  if (overLimit > 0) {
    problems.push(`${overLimit} active lock${overLimit === 1 ? " is" : "s are"} over your ${plan.name} plan's limit and not applied. Upgrade or turn some off.`);
  }

  if (!tooLarge) {
    try {
      const data = await gql(graphql, `#graphql
        query LockRulesInstallation { currentAppInstallation { id } }`);
      const ownerId = data.currentAppInstallation.id;
      const errors = await setMetafields(graphql, [
        { ownerId, namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, value: JSON.stringify(storefront) },
        { ownerId, namespace: CONFIG_NAMESPACE, key: SECRET_KEY, value: secret, type: "single_line_text_field" },
      ]);
      userErrors(errors, "Storefront config");
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }

  try {
    await syncValidation(graphql, shop, checkout, vars);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }

  const steps = [
    () => syncSeo(graphql, shop, locks),
    () => syncPaymentRules(graphql, shop, settings.paymentRules),
  ];
  if (shop.secureEnabled && !tooLarge) {
    // Theme code reads the config from a shop metafield, and custom Liquid lives in a snippet.
    steps.push(() => writeShopConfig(graphql, storefront, secret));
    if (shop.secureThemeId) steps.push(() => refreshSnippets(graphql, shop.secureThemeId!, locks));
  }
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }

  const syncError = problems.length ? problems.join("\n") : null;
  await prisma.shop.update({
    where: { id: shop.id },
    data: { lastSyncedAt: new Date(), syncError },
  });
  return { ok: !syncError, syncError };
}
