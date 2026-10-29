import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { listLocks, type LockWithKeys } from "../models/lock.server";
import { legacyId, type LockResource } from "./locks";
import { getSettings, type ShopSettings } from "./settings";

/*
 * The compiler turns the locks stored in our database into two JSON documents:
 *
 * 1. Storefront config: an app-data metafield on the AppInstallation
 *    (`app.metafields.lockrules.config` in the theme app extension). The app
 *    embed evaluates it in Liquid on every page view, so no request ever
 *    reaches our server.
 * 2. Checkout config: `$app:config` + `$app:vars` metafields on the
 *    Validation that runs our cart & checkout validation function. `vars`
 *    feeds the input query variables (tags / collection ids to test).
 *
 * Keep condition codes in sync with the Liquid evaluator in
 * extensions/lockrules-embed/blocks/lock_embed.liquid and the function in
 * extensions/checkout-lock/src.
 */

export const CONFIG_NAMESPACE = "lockrules";
export const CONFIG_KEY = "config";
export const FUNCTION_HANDLE = "checkout-lock";
// Shopify rejects list variables with more than 100 elements.
const MAX_FUNCTION_LIST = 100;

type CompiledCondition = { t: string; v: string[]; inv: boolean };
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
}

export interface StorefrontConfig {
  v: 1;
  locks: StorefrontLock[];
  msg: ShopSettings["messages"];
}

export interface CheckoutLock {
  id: string;
  type: "product" | "collection" | "store";
  ids: string[]; // gids
  keys: CompiledKey[];
}

export interface CheckoutConfig {
  locks: CheckoutLock[];
  message: string;
}

function compileKeys(lock: LockWithKeys): CompiledKey[] {
  return lock.keys.map((key) => ({
    c: key.conditions.map((c) => {
      const raw = ((c.params as { values?: string[] })?.values ?? []).map(String);
      // Tags and emails compare case-insensitively everywhere.
      const v = raw.map((s) => s.trim().toLowerCase()).filter(Boolean);
      return { t: c.type, v, inv: c.inverted };
    }),
  }));
}

export function compile(locks: LockWithKeys[], settings: ShopSettings) {
  const enabled = locks.filter((l) => l.enabled);

  const storefront: StorefrontConfig = {
    v: 1,
    msg: settings.messages,
    locks: enabled.map((lock) => {
      const resources = (lock.resources ?? []) as unknown as LockResource[];
      return {
        id: lock.id,
        type: lock.resourceType,
        ids: resources.map((r) => legacyId(r.id)),
        handles: resources.map((r) => r.handle),
        keys: compileKeys(lock),
        hide: lock.hideFromLists,
        nav: lock.hideNavLinks,
        act: lock.deniedAction,
        msg: lock.deniedMessage ?? "",
        url: lock.redirectUrl ?? "",
        ex: (lock.storeExceptions ?? []) as string[],
      };
    }),
  };

  const checkoutLocks: CheckoutLock[] = enabled
    .filter((l) => ["product", "collection", "store"].includes(l.resourceType))
    .map((lock) => ({
      id: lock.id,
      type: lock.resourceType as CheckoutLock["type"],
      ids: ((lock.resources ?? []) as unknown as LockResource[]).map((r) => r.id),
      keys: compileKeys(lock),
    }));

  const tags = new Set<string>();
  const collectionIds = new Set<string>();
  for (const lock of checkoutLocks) {
    if (lock.type === "collection") lock.ids.forEach((id) => collectionIds.add(id));
    for (const key of lock.keys) {
      for (const c of key.c) if (c.t === "tag") c.v.forEach((t) => tags.add(t));
    }
  }

  const warnings: string[] = [];
  if (tags.size > MAX_FUNCTION_LIST) {
    warnings.push(`Checkout protection only checks the first ${MAX_FUNCTION_LIST} customer tags.`);
  }
  if (collectionIds.size > MAX_FUNCTION_LIST) {
    warnings.push(`Checkout protection only checks the first ${MAX_FUNCTION_LIST} locked collections.`);
  }

  return {
    storefront,
    checkout: { locks: checkoutLocks, message: settings.messages.checkout } as CheckoutConfig,
    vars: {
      tags: [...tags].slice(0, MAX_FUNCTION_LIST),
      collectionIds: [...collectionIds].slice(0, MAX_FUNCTION_LIST),
    },
    warnings,
  };
}

type GraphQL = AdminApiContext["graphql"];

async function gql<T = any>(graphql: GraphQL, query: string, variables?: Record<string, unknown>) {
  const res = await graphql(query, { variables });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

function userErrors(errors: { message: string }[] | undefined, what: string) {
  if (errors?.length) throw new Error(`${what}: ${errors.map((e) => e.message).join("; ")}`);
}

async function setMetafields(
  graphql: GraphQL,
  metafields: { ownerId: string; namespace: string; key: string; value: string }[],
) {
  const data = await gql(
    graphql,
    `#graphql
    mutation LockRulesSetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message code }
      }
    }`,
    { metafields: metafields.map((m) => ({ ...m, type: "json" })) },
  );
  return data.metafieldsSet.userErrors as { message: string; code?: string }[];
}

async function syncValidation(
  graphql: GraphQL,
  shop: { id: string; validationId: string | null },
  checkout: CheckoutConfig,
  vars: Record<string, unknown>,
) {
  const metafields = (ownerId?: string) => [
    { ...(ownerId ? { ownerId } : {}), namespace: "$app", key: "config", value: JSON.stringify(checkout) },
    { ...(ownerId ? { ownerId } : {}), namespace: "$app", key: "vars", value: JSON.stringify(vars) },
  ];

  if (shop.validationId) {
    const errors = await setMetafields(graphql, metafields(shop.validationId) as any);
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
        metafields: metafields().map((m) => ({ ...m, type: "json" })),
      },
    },
  );
  userErrors(data.validationCreate.userErrors, "Checkout protection");
  const id = data.validationCreate.validation.id as string;
  await prisma.shop.update({ where: { id: shop.id }, data: { validationId: id } });
  return id;
}

/** Recompiles every lock for the shop and pushes the result to Shopify. */
export async function syncShop(graphql: GraphQL, domain: string) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { domain } });
  const locks = await listLocks(shop.id);
  const { storefront, checkout, vars, warnings } = compile(locks, getSettings(shop.settings));
  const problems: string[] = [...warnings];

  try {
    const data = await gql(graphql, `#graphql
      query LockRulesInstallation { currentAppInstallation { id } }`);
    const errors = await setMetafields(graphql, [
      {
        ownerId: data.currentAppInstallation.id,
        namespace: CONFIG_NAMESPACE,
        key: CONFIG_KEY,
        value: JSON.stringify(storefront),
      },
    ]);
    userErrors(errors, "Storefront config");
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }

  try {
    await syncValidation(graphql, shop, checkout, vars);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }

  const syncError = problems.length ? problems.join("\n") : null;
  await prisma.shop.update({
    where: { id: shop.id },
    data: { lastSyncedAt: new Date(), syncError },
  });
  return { ok: !syncError, syncError };
}
