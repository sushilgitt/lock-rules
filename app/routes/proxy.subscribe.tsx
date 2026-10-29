import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  clientIp,
  findCondition,
  isRateLimited,
  issueToken,
  json,
  recordFailure,
  recordUnlock,
  shopForProxy,
} from "../lib/proxy.server";
import { subscribe } from "../lib/integrations.server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// POST /apps/lockrules/subscribe  { uid, email } -> { ok, token? }
// Newsletter keys: subscribe the visitor, then unlock.
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = await shopForProxy(url.searchParams.get("shop"));
  if (!shop) return json({ ok: false, error: "unavailable" }, 404);

  const body = (await request.json().catch(() => ({}))) as { uid?: string; email?: string };
  const condition = body.uid ? await findCondition(shop.id, { uid: String(body.uid) }) : null;
  if (condition?.type !== "newsletter" || !condition.p.audience || !condition.p.provider) {
    return json({ ok: false, error: "unknown" }, 404);
  }

  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
  if (!EMAIL.test(email)) return json({ ok: false, error: "invalid_email" }, 200);

  // Guards the merchant's list from being flooded from one address.
  const limitKey = `subscribe:${shop.id}:${clientIp(request)}`;
  if (isRateLimited(limitKey)) return json({ ok: false, error: "rate_limited" }, 429);
  recordFailure(limitKey);

  try {
    await subscribe(shop.id, condition.p.provider, condition.p.audience, email);
  } catch (e) {
    console.error(`Newsletter subscribe failed for ${shop.domain}:`, e);
    return json({ ok: false, error: "provider" }, 502);
  }

  // The email lives with the merchant's email provider; usage only records that it happened.
  await recordUnlock({
    shopId: shop.id,
    lockId: condition.lockId,
    conditionUid: condition.p.uid,
    kind: "newsletter",
    customerId: url.searchParams.get("logged_in_customer_id"),
  });
  return json({ ok: true, token: issueToken(shop.hmacSecret!, condition.p.uid, condition.p.minutes) });
};

export const loader = () => json({ ok: false }, 405);
