import prisma from "../db.server";
import { gql, setMetafields, userErrors, type GraphQL } from "./compile.server";
import { getSettings, type ShopSettings } from "./settings";
import { legacyId } from "./locks";

/*
 * Customer-side data for Phase 3 keys:
 *  - "has purchased X": product ids a customer bought, kept in the customer
 *    metafield `$app:lockrules.purchased` (read by snippets/lr_open.liquid and
 *    the checkout function). Updated by the orders/paid webhook; backfilled with
 *    a bulk operation from Settings.
 *  - Registration approval: customers/create tags new customers as pending.
 */

export const PURCHASED_NAMESPACE = "$app:lockrules";
export const PURCHASED_KEY = "purchased";
// Keep the metafield small; the oldest purchases fall off first.
const MAX_PURCHASED = 500;

export async function updateSettings(domain: string, patch: Partial<ShopSettings>) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { domain } });
  const settings = getSettings({ ...getSettings(shop.settings), ...patch });
  await prisma.shop.update({ where: { id: shop.id }, data: { settings: settings as any } });
  return settings;
}

export async function addPurchases(graphql: GraphQL, customerGid: string, productIds: string[]) {
  const data = await gql(
    graphql,
    `#graphql
    query LockRulesPurchased($id: ID!) {
      customer(id: $id) {
        purchased: metafield(namespace: "$app:lockrules", key: "purchased") { jsonValue }
      }
    }`,
    { id: customerGid },
  );
  const existing = data.customer?.purchased?.jsonValue;
  const merged = [...new Set([...(Array.isArray(existing) ? existing.map(String) : []), ...productIds])];
  if (Array.isArray(existing) && merged.length === existing.length) return;
  const errors = await setMetafields(graphql, [
    {
      ownerId: customerGid,
      namespace: PURCHASED_NAMESPACE,
      key: PURCHASED_KEY,
      value: JSON.stringify(merged.slice(-MAX_PURCHASED)),
    },
  ]);
  userErrors(errors, "Purchase history");
}

export async function startPurchaseBackfill(graphql: GraphQL) {
  const data = await gql(
    graphql,
    `#graphql
    mutation LockRulesBackfill($query: String!) {
      bulkOperationRunQuery(query: $query) {
        bulkOperation { id status }
        userErrors { field message }
      }
    }`,
    {
      query: `{
        orders(query: "financial_status:paid OR financial_status:partially_refunded") {
          edges { node { id customer { id } lineItems { edges { node { product { id } } } } } }
        }
      }`,
    },
  );
  userErrors(data.bulkOperationRunQuery.userErrors, "Purchase history sync");
  return data.bulkOperationRunQuery.bulkOperation;
}

export async function currentBackfill(graphql: GraphQL) {
  const data = await gql(
    graphql,
    `#graphql
    query LockRulesBackfillStatus {
      # LockRules only runs bulk queries, so the newest operation is ours.
      bulkOperations(first: 1, sortKey: CREATED_AT, reverse: true) {
        nodes { id status objectCount url errorCode completedAt }
      }
    }`,
  );
  return (data.bulkOperations.nodes[0] ?? null) as null | {
    id: string;
    status: string;
    objectCount: string;
    url: string | null;
    errorCode: string | null;
    completedAt: string | null;
  };
}

/** Reads a finished bulk operation's JSONL and writes every customer's purchased products. */
export async function applyBackfill(graphql: GraphQL, url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download purchase history (${res.status})`);
  const text = await res.text();

  const orderCustomer = new Map<string, string>();
  const byCustomer = new Map<string, Set<string>>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.id?.includes("/Order/")) {
      if (row.customer?.id) orderCustomer.set(row.id, row.customer.id);
    } else if (row.__parentId && row.product?.id) {
      const customer = orderCustomer.get(row.__parentId);
      if (!customer) continue;
      if (!byCustomer.has(customer)) byCustomer.set(customer, new Set());
      byCustomer.get(customer)!.add(legacyId(row.product.id));
    }
  }

  const entries = [...byCustomer.entries()];
  for (let i = 0; i < entries.length; i += 25) {
    const errors = await setMetafields(
      graphql,
      entries.slice(i, i + 25).map(([ownerId, ids]) => ({
        ownerId,
        namespace: PURCHASED_NAMESPACE,
        key: PURCHASED_KEY,
        value: JSON.stringify([...ids].slice(-MAX_PURCHASED)),
      })),
    );
    userErrors(errors, "Purchase history");
  }
  return entries.length;
}

export async function retagCustomer(
  graphql: GraphQL,
  customerGid: string,
  add: string[],
  remove: string[],
) {
  const data = await gql(
    graphql,
    `#graphql
    mutation LockRulesRetag($id: ID!, $add: [String!]!, $remove: [String!]!) {
      tagsAdd(id: $id, tags: $add) { userErrors { message } }
      tagsRemove(id: $id, tags: $remove) { userErrors { message } }
    }`,
    { id: customerGid, add, remove },
  );
  userErrors([...data.tagsAdd.userErrors, ...data.tagsRemove.userErrors], "Customer tags");
}
