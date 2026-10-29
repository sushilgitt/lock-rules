import type { LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { listLocks } from "../models/lock.server";
import { compile, gql, loadListEntries } from "../lib/compile.server";
import { getSettings } from "../lib/settings";
import { legacyId, type LockResource } from "../lib/locks";
import { simulate, type Visitor } from "../lib/debug.server";

// GET /customer/access: the members-access customer account block asks which
// locked areas the signed-in customer can open. Customer keys only (tags, email,
// order history, B2B); passcodes and links unlock per browser, not per account.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);
  const domain = new URL(String(sessionToken.dest)).hostname;
  const customerGid = typeof sessionToken.sub === "string" ? sessionToken.sub : null;
  const shop = await prisma.shop.findUnique({ where: { domain } });
  if (!shop || shop.uninstalledAt || !customerGid) return cors(Response.json({ areas: [] }));

  const { admin } = await unauthenticated.admin(domain);
  const data = await gql(
    admin.graphql,
    `#graphql
    query LockRulesMemberAccess($id: ID!) {
      shop { primaryDomain { url } ianaTimezone }
      customer(id: $id) {
        tags
        numberOfOrders
        defaultEmailAddress { emailAddress }
        purchased: metafield(namespace: "$app:lockrules", key: "purchased") { jsonValue }
      }
    }`,
    { id: customerGid },
  ).catch(() => null);
  if (!data?.customer) return cors(Response.json({ areas: [] }));

  const [locks, lists] = await Promise.all([listLocks(shop.id), loadListEntries(shop.id)]);
  const { storefront } = compile(locks, getSettings(shop.settings), lists, shop.hmacSecret ?? "", data.shop.ianaTimezone);
  const purchased = data.customer.purchased?.jsonValue;
  const visitor: Visitor = {
    signedIn: true,
    email: data.customer.defaultEmailAddress?.emailAddress ?? "",
    tags: data.customer.tags,
    orders: Number(data.customer.numberOfOrders) || 0,
    purchased: Array.isArray(purchased) ? purchased.map(String) : [],
    country: "",
    market: "",
    host: "",
    subtotalCents: 0,
    cartProducts: [],
    now: Math.floor(Date.now() / 1000),
    weekday: ((new Date().getUTCDay() + 6) % 7) + 1,
    hm: 0,
    unlockedRemote: false,
    customLiquid: false,
  };
  const open = new Set(simulate(storefront, visitor, { template: "other" }).filter((r) => r.open).map((r) => r.id));

  const base = String(data.shop.primaryDomain.url).replace(/\/$/, "");
  const paths: Record<string, string> = { product: "products", collection: "collections", page: "pages", blog: "blogs" };
  const areas = locks
    .filter((l) => l.enabled && open.has(l.id) && (paths[l.resourceType] || l.resourceType === "store"))
    // Locks anyone can open aren't "members" areas.
    .filter((l) => !l.keys.every((k) => k.conditions.some((c) => c.type === "always" && !c.inverted)))
    .map((l) => ({
      name: l.name,
      items:
        l.resourceType === "store"
          ? [{ title: "Store", url: base }]
          : ((l.resources ?? []) as unknown as LockResource[]).slice(0, 20).map((r) => ({
              title: r.title,
              url: `${base}/${paths[l.resourceType]}/${r.handle || legacyId(r.id)}`,
            })),
    }));

  return cors(Response.json({ areas }));
};
