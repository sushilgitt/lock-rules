import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhooks. The only customer data LockRules keeps is the
// customer id on KeyUsage rows (who unlocked what). Customer conditions are
// evaluated by Shopify in Liquid and in the checkout function.
// shop/redact removes everything for the shop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "SHOP_REDACT":
      await db.shop.deleteMany({ where: { domain: shop } });
      await db.session.deleteMany({ where: { shop } });
      break;
    case "CUSTOMERS_REDACT": {
      const customerId = String((payload as { customer?: { id?: number } }).customer?.id ?? "");
      if (customerId) {
        await db.keyUsage.deleteMany({ where: { customerId, shop: { domain: shop } } });
      }
      break;
    }
    case "CUSTOMERS_DATA_REQUEST":
      // Usage rows are visible to the merchant under Key usage; nothing else to export.
      break;
  }

  return new Response();
};
