import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { addPurchases } from "../lib/customers.server";

// Keeps the "has purchased" customer metafield current.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, admin, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as {
    customer?: { id?: number } | null;
    line_items?: { product_id?: number | null }[];
  };
  const customerId = order.customer?.id;
  const productIds = [
    ...new Set((order.line_items ?? []).map((l) => l.product_id).filter(Boolean).map(String)),
  ];
  if (admin && customerId && productIds.length) {
    await addPurchases(admin.graphql, `gid://shopify/Customer/${customerId}`, productIds);
  }
  return new Response();
};
