import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  clientIp,
  findCondition,
  isRateLimited,
  issueToken,
  json,
  matchPasscode,
  recordFailure,
  recordUnlock,
  shopForProxy,
} from "../lib/proxy.server";

// POST /apps/lockrules/unlock  { uid, value? } -> { ok, token?, redirect? }
// Unlocks passcode and confirm conditions.
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = await shopForProxy(url.searchParams.get("shop"));
  if (!shop) return json({ ok: false, error: "unavailable" }, 404);

  const body = (await request.json().catch(() => ({}))) as { uid?: string; value?: string };
  const condition = body.uid ? await findCondition(shop.id, { uid: String(body.uid) }) : null;
  if (!condition || !["passcode", "confirm"].includes(condition.type)) {
    return json({ ok: false, error: "unknown" }, 404);
  }

  const customerId = url.searchParams.get("logged_in_customer_id");
  let redirect: string | null = null;
  let value: string | null = null;

  if (condition.type === "passcode") {
    const limitKey = `${shop.id}:${clientIp(request)}`;
    if (isRateLimited(limitKey)) return json({ ok: false, error: "rate_limited" }, 429);
    const entered = String(body.value ?? "").slice(0, 200);
    const match = await matchPasscode(shop.id, condition, entered);
    if (!match) {
      recordFailure(limitKey);
      return json({ ok: false, error: "wrong" }, 200);
    }
    redirect = match.redirect;
    value = entered.trim();
  }

  await recordUnlock({
    shopId: shop.id,
    lockId: condition.lockId,
    conditionUid: condition.p.uid,
    kind: condition.type,
    value,
    customerId,
  });

  return json({
    ok: true,
    token: issueToken(shop.hmacSecret!, condition.p.uid, condition.p.minutes),
    redirect,
  });
};

export const loader = () => json({ ok: false }, 405);
