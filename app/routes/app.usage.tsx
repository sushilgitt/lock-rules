import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../models/lock.server";

const KINDS: Record<string, string> = {
  passcode: "Passcode",
  secret_link: "Secret link",
  confirm: "Confirmed prompt",
  ip: "IP address",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const url = new URL(request.url);
  const lockId = url.searchParams.get("lock") || undefined;
  const kind = url.searchParams.get("kind") || undefined;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const where = { shopId: shop.id, lockId, kind, createdAt: { gte: since } };
  const [events, locks, byValue] = await Promise.all([
    prisma.keyUsage.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.lock.findMany({ where: { shopId: shop.id }, select: { id: true, name: true } }),
    prisma.keyUsage.groupBy({
      by: ["value"],
      where: { ...where, kind: "passcode", value: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { value: "desc" } },
      take: 10,
    }),
  ]);
  const lockNames = Object.fromEntries(locks.map((l) => [l.id, l.name]));

  return {
    locks,
    filters: { lockId: lockId ?? "", kind: kind ?? "" },
    topPasscodes: byValue.map((r) => ({ value: r.value!, count: r._count._all })),
    events: events.map((e) => ({
      id: e.id,
      at: e.createdAt.toISOString(),
      lock: (e.lockId && lockNames[e.lockId]) || "Deleted lock",
      kind: KINDS[e.kind] ?? e.kind,
      value: e.value,
      customerId: e.customerId,
    })),
  };
};

export default function Usage() {
  const { locks, filters, topPasscodes, events } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    navigate(`?${next.toString()}`, { replace: true });
  };

  return (
    <s-page heading="Key usage">
      <s-section>
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-select label="Lock" value={filters.lockId} onChange={(e) => setFilter("lock", e.currentTarget.value)}>
            <s-option value="">All locks</s-option>
            {locks.map((l) => (
              <s-option key={l.id} value={l.id}>
                {l.name}
              </s-option>
            ))}
          </s-select>
          <s-select label="Unlocked by" value={filters.kind} onChange={(e) => setFilter("kind", e.currentTarget.value)}>
            <s-option value="">Anything</s-option>
            {Object.entries(KINDS).map(([value, label]) => (
              <s-option key={value} value={value}>
                {label}
              </s-option>
            ))}
          </s-select>
        </s-grid>
      </s-section>

      {topPasscodes.length > 0 && (
        <s-section heading="Most used passcodes (30 days)">
          <s-stack direction="inline" gap="small-200">
            {topPasscodes.map((p) => (
              <s-chip key={p.value}>
                {p.value}: {p.count}
              </s-chip>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section heading="Recent unlocks (30 days)" padding="none">
        {events.length === 0 ? (
          <s-box padding="base">
            <s-paragraph color="subdued">
              No unlocks yet. Passcodes, secret links, confirmations and IP unlocks show up
              here.
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Lock</s-table-header>
              <s-table-header>Unlocked by</s-table-header>
              <s-table-header>Value</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header listSlot="secondary">When</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {events.map((e) => (
                <s-table-row key={e.id}>
                  <s-table-cell>{e.lock}</s-table-cell>
                  <s-table-cell>{e.kind}</s-table-cell>
                  <s-table-cell>{e.value ?? "—"}</s-table-cell>
                  <s-table-cell>
                    {e.customerId ? (
                      <s-link
                        href={`shopify://admin/customers/${e.customerId}`}
                        target="_blank"
                      >
                        View customer
                      </s-link>
                    ) : (
                      "Guest"
                    )}
                  </s-table-cell>
                  <s-table-cell>{new Date(e.at).toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
