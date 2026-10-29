import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhooks. LockRules stores no customer personal data in its
// own database (customer conditions are evaluated by Shopify in Liquid and in
// the checkout function), so data requests and customer redactions have
// nothing to return or delete. shop/redact removes everything for the shop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "SHOP_REDACT":
      await db.shop.deleteMany({ where: { domain: shop } });
      await db.session.deleteMany({ where: { shop } });
      break;
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      break;
  }

  return new Response();
};
