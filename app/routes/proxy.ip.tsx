import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  clientIp,
  findCondition,
  ipMatches,
  issueToken,
  json,
  recordUnlock,
  shopForProxy,
} from "../lib/proxy.server";

// POST /apps/lockrules/ip  { uids: [...] } -> { ok, tokens: [...] }
// Issues a token for each IP condition the shopper's address satisfies.
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = await shopForProxy(url.searchParams.get("shop"));
  if (!shop) return json({ ok: false, error: "unavailable" }, 404);

  const body = (await request.json().catch(() => ({}))) as { uids?: unknown };
  const uids = Array.isArray(body.uids) ? body.uids.map(String).slice(0, 20) : [];
  const ip = clientIp(request);
  const tokens: string[] = [];

  for (const uid of uids) {
    const condition = await findCondition(shop.id, { uid });
    if (condition?.type !== "ip" || !ip) continue;
    if (!condition.p.values.some((rule) => ipMatches(ip, rule))) continue;
    // IP unlocks are short-lived so a shopper leaving the network loses access soon after.
    tokens.push(issueToken(shop.hmacSecret!, condition.p.uid, condition.p.minutes || 24 * 60));
    await recordUnlock({
      shopId: shop.id,
      lockId: condition.lockId,
      conditionUid: condition.p.uid,
      kind: "ip",
      customerId: url.searchParams.get("logged_in_customer_id"),
    });
  }

  return json({ ok: true, tokens });
};

export const loader = () => json({ ok: false }, 405);
