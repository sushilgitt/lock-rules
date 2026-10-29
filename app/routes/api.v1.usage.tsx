import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticateApi } from "../lib/api.server";

// GET /api/v1/usage?since=ISO-8601&lock=ID&limit=100
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await authenticateApi(request);
  const url = new URL(request.url);
  const since = new Date(url.searchParams.get("since") ?? Date.now() - 30 * 24 * 3600 * 1000);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 1000);
  const events = await prisma.keyUsage.findMany({
    where: {
      shopId: shop.id,
      lockId: url.searchParams.get("lock") || undefined,
      createdAt: Number.isNaN(since.getTime()) ? undefined : { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return Response.json({
    events: events.map((e) => ({
      lockId: e.lockId,
      conditionUid: e.conditionId,
      kind: e.kind,
      value: e.value,
      customerId: e.customerId,
      at: e.createdAt.toISOString(),
    })),
  });
};
