import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { listLocks } from "../models/lock.server";
import { followPublishedTheme } from "../lib/secure/install.server";

// Secure mode lives in the published theme; when the merchant publishes another
// theme (including a theme update, which Shopify ships as a new theme), re-apply it.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, admin, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const theme = payload as { id?: number; role?: string };
  const record = await prisma.shop.findUnique({ where: { domain: shop } });
  if (admin && record?.secureEnabled && theme.role === "main" && theme.id) {
    // The payload's gid is gid://shopify/Theme/…; theme file APIs take OnlineStoreTheme ids.
    const report = await followPublishedTheme(
      admin.graphql,
      record,
      `gid://shopify/OnlineStoreTheme/${theme.id}`,
      await listLocks(record.id),
    );
    if (report?.error) console.error(`Secure mode on ${shop}: ${report.error}`);
  }
  return new Response();
};
