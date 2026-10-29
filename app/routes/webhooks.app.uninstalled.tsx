import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  // Keep locks for 48h in case the merchant reinstalls; shop/redact deletes them for good.
  // Shopify removes our metafields and validation along with the app.
  await db.shop.updateMany({
    where: { domain: shop },
    data: { uninstalledAt: new Date(), validationId: null },
  });

  return new Response();
};
