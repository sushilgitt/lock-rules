import prisma from "../db.server";
import { gql, type GraphQL } from "./compile.server";
import { legacyId } from "./locks";
import { planFor, type Plan } from "./plans";

/*
 * Shopify App Pricing: plans, prices and trials live in the Partner Dashboard
 * and Shopify hosts the plan selection page. We only read the merchant's active
 * subscription (Partner API activeSubscription) and gate features by plan.
 *
 * Needs PARTNER_ID and PARTNER_API_TOKEN. Without them billing is off and every
 * shop gets Pro, which keeps development stores usable.
 */

const PARTNER_API_VERSION = "2026-07";
const CACHE_MS = 10 * 60 * 1000;
const APP_HANDLE = process.env.APP_HANDLE || "lockrules";

export function billingEnabled() {
  return Boolean(process.env.PARTNER_ID && process.env.PARTNER_API_TOKEN);
}

export function planSelectionUrl(shopDomain: string) {
  const store = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${store}/charges/${APP_HANDLE}/pricing_plans`;
}

async function activeSubscription(appGid: string, shopGid: string) {
  const res = await fetch(
    `https://partners.shopify.com/${process.env.PARTNER_ID}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.PARTNER_API_TOKEN!,
      },
      body: JSON.stringify({
        query: `query LockRulesActiveSubscription($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) {
            trialEndsAt
            cancelAtEndOfCycle
            items { handle }
          }
        }`,
        variables: { appId: appGid, shopId: shopGid },
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  const json = (await res.json()) as {
    data?: { activeSubscription: null | { trialEndsAt: string | null; items: { handle: string }[] } };
    errors?: unknown;
  };
  if (!res.ok || json.errors) throw new Error(`Partner API: ${res.status} ${JSON.stringify(json.errors ?? "")}`);
  return json.data?.activeSubscription ?? null;
}

/**
 * The shop's current plan, cached for a few minutes. Pass `refresh` after the
 * merchant returns from the plan selection page.
 */
export async function currentPlan(graphql: GraphQL, domain: string, refresh = false): Promise<Plan> {
  if (!billingEnabled()) return planFor("pro");

  const shop = await prisma.shop.findUniqueOrThrow({ where: { domain } });
  const fresh = shop.planCheckedAt && Date.now() - shop.planCheckedAt.getTime() < CACHE_MS;
  if (fresh && !refresh) return planFor(shop.planHandle);

  try {
    const data = await gql(graphql, `#graphql
      query LockRulesBillingIds { shop { id } currentAppInstallation { app { id } } }`);
    // The Partner API takes plain Shop/App gids.
    const sub = await activeSubscription(
      `gid://shopify/App/${legacyId(data.currentAppInstallation.app.id)}`,
      `gid://shopify/Shop/${legacyId(data.shop.id)}`,
    );
    const handle = sub?.items?.[0]?.handle ?? "free";
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        planHandle: handle,
        planCheckedAt: new Date(),
        trialEndsAt: sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null,
      },
    });
    return planFor(handle);
  } catch (e) {
    // Don't lock merchants out because the Partner API had a bad minute.
    console.error(`Plan check failed for ${domain}:`, e);
    return planFor(shop.planHandle ?? "free");
  }
}

/** Plan from the cache only, for places without an Admin API session (public API). */
export async function cachedPlan(shopId: string) {
  if (!billingEnabled()) return planFor("pro");
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  return planFor(shop?.planHandle);
}
