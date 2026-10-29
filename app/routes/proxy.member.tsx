import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { findCondition, issueToken, json, recordUnlock, shopForProxy } from "../lib/proxy.server";
import { isKlaviyoMember } from "../lib/integrations.server";

// POST /apps/lockrules/member  { uids: [...] } -> { ok, tokens: [...] }
// Klaviyo membership keys for the signed-in customer. Shopify tells us who is
// signed in (logged_in_customer_id); we look up their email ourselves so a
// visitor can't claim someone else's.
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = await shopForProxy(url.searchParams.get("shop"));
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!shop) return json({ ok: false, error: "unavailable" }, 404);
  if (!customerId) return json({ ok: true, tokens: [] });

  const body = (await request.json().catch(() => ({}))) as { uids?: unknown };
  const uids = Array.isArray(body.uids) ? body.uids.map(String).slice(0, 10) : [];
  if (!uids.length) return json({ ok: true, tokens: [] });

  let email = "";
  try {
    const { admin } = await unauthenticated.admin(shop.domain);
    const res = await admin.graphql(
      `#graphql
      query LockRulesCustomerEmail($id: ID!) {
        customer(id: $id) { defaultEmailAddress { emailAddress } }
      }`,
      { variables: { id: `gid://shopify/Customer/${customerId}` } },
    );
    const data = await res.json();
    email = (data.data?.customer?.defaultEmailAddress?.emailAddress ?? "").toLowerCase();
  } catch (e) {
    console.error(`Customer email lookup failed for ${shop.domain}:`, e);
    return json({ ok: false, error: "customer_data" }, 502);
  }
  if (!email) return json({ ok: true, tokens: [] });

  const tokens: string[] = [];
  for (const uid of uids) {
    const condition = await findCondition(shop.id, { uid });
    if (condition?.type !== "klaviyo_member" || !condition.p.audience) continue;
    const member = await isKlaviyoMember(
      shop.id,
      { id: condition.p.audience, kind: condition.p.audienceKind ?? "list" },
      email,
    ).catch((e) => {
      console.error(`Klaviyo lookup failed for ${shop.domain}:`, e);
      return false;
    });
    if (!member) continue;
    // Membership can lapse, so these unlocks are short by default.
    tokens.push(issueToken(shop.hmacSecret!, condition.p.uid, condition.p.minutes || 24 * 60));
    await recordUnlock({
      shopId: shop.id,
      lockId: condition.lockId,
      conditionUid: condition.p.uid,
      kind: "klaviyo_member",
      customerId,
    });
  }
  return json({ ok: true, tokens });
};

export const loader = () => json({ ok: false }, 405);
