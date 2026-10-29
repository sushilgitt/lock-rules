import prisma from "../db.server";
import type { LockWithKeys } from "../models/lock.server";
import type { LockResource } from "./locks";
import { gql, userErrors, type GraphQL } from "./compile.server";

// Resource types that honour the seo.hidden metafield (noindex + left out of the sitemap).
const SEO_TYPES = ["product", "collection", "page", "article"];
const BATCH = 25;

/**
 * Keeps `seo.hidden = 1` on resources of enabled locks that ask for it, and
 * removes it from resources we hid before but no longer should. We only ever
 * remove values we set ourselves (tracked in Shop.seoHiddenIds).
 */
export async function syncSeo(
  graphql: GraphQL,
  shop: { id: string; seoHiddenIds: unknown },
  locks: LockWithKeys[],
) {
  const desired = new Set<string>();
  for (const lock of locks) {
    if (!lock.enabled || !lock.seoHidden || !SEO_TYPES.includes(lock.resourceType)) continue;
    for (const r of (lock.resources ?? []) as unknown as LockResource[]) desired.add(r.id);
  }
  const current = new Set(((shop.seoHiddenIds ?? []) as string[]).map(String));
  const add = [...desired].filter((id) => !current.has(id));
  const remove = [...current].filter((id) => !desired.has(id));
  if (!add.length && !remove.length) return;

  for (let i = 0; i < add.length; i += BATCH) {
    const data = await gql(
      graphql,
      `#graphql
      mutation LockRulesSeoHide($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { field message } }
      }`,
      {
        metafields: add.slice(i, i + BATCH).map((ownerId) => ({
          ownerId,
          namespace: "seo",
          key: "hidden",
          type: "number_integer",
          value: "1",
        })),
      },
    );
    userErrors(data.metafieldsSet.userErrors, "Hide from search engines");
  }

  for (let i = 0; i < remove.length; i += BATCH) {
    const data = await gql(
      graphql,
      `#graphql
      mutation LockRulesSeoShow($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { userErrors { field message } }
      }`,
      {
        metafields: remove
          .slice(i, i + BATCH)
          .map((ownerId) => ({ ownerId, namespace: "seo", key: "hidden" })),
      },
    );
    userErrors(data.metafieldsDelete.userErrors, "Show in search engines");
  }

  await prisma.shop.update({ where: { id: shop.id }, data: { seoHiddenIds: [...desired] } });
}
