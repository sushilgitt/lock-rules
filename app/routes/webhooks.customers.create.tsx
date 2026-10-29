import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/settings";
import { retagCustomer } from "../lib/customers.server";

// Registration approval: tag new customers as pending until the merchant reviews them.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, admin, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const record = await prisma.shop.findUnique({ where: { domain: shop } });
  const { approval } = getSettings(record?.settings);
  const customer = payload as { id?: number; tags?: string };
  const tags = (customer.tags ?? "").split(",").map((t) => t.trim().toLowerCase());
  const alreadyReviewed = [approval.approvedTag, approval.rejectedTag].some((t) =>
    tags.includes(t.toLowerCase()),
  );

  if (admin && approval.enabled && customer.id && !alreadyReviewed) {
    await retagCustomer(admin.graphql, `gid://shopify/Customer/${customer.id}`, [approval.pendingTag], []);
  }
  return new Response();
};
