import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { clientIp, isRateLimited, json, recordFailure, shopForProxy } from "../lib/proxy.server";

// POST /apps/lockrules/event  { ids: [lockId, ...] }
// Counts unique denied sessions per lock per day for Analytics. The storefront
// sends at most one beacon per lock per browsing session; no visitor data is kept.
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = await shopForProxy(url.searchParams.get("shop"));
  if (!shop) return json({ ok: false }, 404);

  const limitKey = `event:${shop.id}:${clientIp(request)}`;
  if (isRateLimited(limitKey)) return json({ ok: false }, 429);
  recordFailure(limitKey); // counts requests; caps one visitor at 10 beacons per 10 minutes

  // sendBeacon posts text/plain, so parse the body ourselves.
  let ids: string[] = [];
  try {
    const body = JSON.parse(await request.text());
    ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 10) : [];
  } catch {
    return json({ ok: false }, 400);
  }

  const owned = await prisma.lock.findMany({ where: { shopId: shop.id, id: { in: ids } }, select: { id: true } });
  const day = new Date(new Date().toISOString().slice(0, 10));
  for (const { id } of owned) {
    await prisma.lockStat.upsert({
      where: { shopId_lockId_day: { shopId: shop.id, lockId: id, day } },
      update: { denied: { increment: 1 } },
      create: { shopId: shop.id, lockId: id, day, denied: 1 },
    });
  }
  return json({ ok: true });
};

export const loader = () => json({ ok: false }, 405);
