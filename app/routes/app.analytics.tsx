import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../models/lock.server";

const DAYS = 30;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const lockId = new URL(request.url).searchParams.get("lock") || undefined;

  const today = new Date(new Date().toISOString().slice(0, 10));
  const since = new Date(today.getTime() - (DAYS - 1) * 86_400_000);
  const [locks, stats, unlocks] = await Promise.all([
    prisma.lock.findMany({ where: { shopId: shop.id }, select: { id: true, name: true, enabled: true } }),
    prisma.lockStat.findMany({ where: { shopId: shop.id, day: { gte: since } } }),
    prisma.keyUsage.groupBy({
      by: ["lockId"],
      where: { shopId: shop.id, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const denied = stats
      .filter((s) => s.day.toISOString().slice(0, 10) === d && (!lockId || s.lockId === lockId))
      .reduce((sum, s) => sum + s.denied, 0);
    return { day: d, denied };
  });

  const unlocksBy = Object.fromEntries(unlocks.map((u) => [u.lockId ?? "", u._count._all]));
  const rows = locks
    .map((l) => {
      const denied = stats.filter((s) => s.lockId === l.id).reduce((sum, s) => sum + s.denied, 0);
      const unlocked = unlocksBy[l.id] ?? 0;
      return { ...l, denied, unlocked, rate: denied ? unlocked / denied : null };
    })
    .sort((a, b) => b.denied - a.denied);

  return { days, rows, lockId: lockId ?? "" };
};

const BLUE = "#2a78d6"; // categorical slot 1 (dataviz reference palette); one series, no legend

function DeniedChart({ days }: { days: { day: string; denied: number }[] }) {
  const W = 720, H = 200, PAD_L = 36, PAD_B = 24, PAD_T = 8;
  const max = Math.max(1, ...days.map((d) => d.denied));
  // Round the axis top to a friendly number.
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  const band = (W - PAD_L) / days.length;
  const barW = Math.min(24, band - 2); // 2px surface gap between neighbours
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / top);
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Locked page views per day, last 30 days">
      {[0, top / 2, top].map((v) => (
        <g key={v}>
          <line x1={PAD_L} x2={W} y1={y(v)} y2={y(v)} stroke="#e3e3e3" strokeWidth={1} />
          <text x={PAD_L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#616161">
            {v}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const x = PAD_L + i * band + (band - barW) / 2;
        const h = H - PAD_B - y(d.denied);
        const r = Math.min(4, h, barW / 2);
        // Rounded data end, square at the baseline.
        const path = h > 0
          ? `M${x},${H - PAD_B} V${y(d.denied) + r} Q${x},${y(d.denied)} ${x + r},${y(d.denied)} H${x + barW - r} Q${x + barW},${y(d.denied)} ${x + barW},${y(d.denied) + r} V${H - PAD_B} Z`
          : "";
        return (
          <g key={d.day} tabIndex={0}>
            <title>{`${fmt(d.day)}: ${d.denied} locked view${d.denied === 1 ? "" : "s"}`}</title>
            {/* Hit target spans the whole band so thin or empty bars still get a tooltip. */}
            <rect x={PAD_L + i * band} y={PAD_T} width={band} height={H - PAD_T - PAD_B} fill="transparent" />
            {path && <path d={path} fill={BLUE} />}
          </g>
        );
      })}
      {[0, Math.floor(days.length / 2), days.length - 1].map((i, n) => (
        <text
          key={i}
          x={n === 0 ? PAD_L + (band - barW) / 2 : n === 2 ? W - (band - barW) / 2 : PAD_L + i * band + band / 2}
          y={H - 6}
          textAnchor={n === 0 ? "start" : n === 2 ? "end" : "middle"}
          fontSize={11}
          fill="#616161"
        >
          {fmt(days[i].day)}
        </text>
      ))}
    </svg>
  );
}

export default function Analytics() {
  const { days, rows, lockId } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const total = days.reduce((s, d) => s + d.denied, 0);
  const unlocks = rows.filter((r) => !lockId || r.id === lockId).reduce((s, r) => s + r.unlocked, 0);

  const setLock = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("lock", id);
    else next.delete("lock");
    navigate(`?${next.toString()}`, { replace: true });
  };

  return (
    <s-page heading="Analytics">
      <s-section>
        <s-grid gridTemplateColumns="2fr 1fr 1fr" gap="base" alignItems="end">
          <s-select label="Lock" value={lockId} onChange={(e) => setLock(e.currentTarget.value)}>
            <s-option value="">All locks</s-option>
            {rows.map((r) => (
              <s-option key={r.id} value={r.id}>
                {r.name}
              </s-option>
            ))}
          </s-select>
          <s-stack gap="small-100">
            <s-text color="subdued">Locked views (30 days)</s-text>
            <s-heading>{total.toLocaleString()}</s-heading>
          </s-stack>
          <s-stack gap="small-100">
            <s-text color="subdued">Unlocks (30 days)</s-text>
            <s-heading>{unlocks.toLocaleString()}</s-heading>
          </s-stack>
        </s-grid>
      </s-section>

      <s-section heading="Locked page views per day">
        {total === 0 ? (
          <s-paragraph color="subdued">
            No locked views yet. Counts appear when visitors without a key reach a locked page,
            once per lock per browsing session.
          </s-paragraph>
        ) : (
          <DeniedChart days={days} />
        )}
      </s-section>

      <s-section heading="By lock" padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Lock</s-table-header>
            <s-table-header format="numeric">Locked views</s-table-header>
            <s-table-header format="numeric">Unlocks</s-table-header>
            <s-table-header listSlot="secondary" format="numeric">
              Unlock rate
            </s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>
                  <s-link href={`/app/locks/${r.id}`}>{r.name}</s-link>
                  {!r.enabled && " (off)"}
                </s-table-cell>
                <s-table-cell>{r.denied.toLocaleString()}</s-table-cell>
                <s-table-cell>{r.unlocked.toLocaleString()}</s-table-cell>
                <s-table-cell>{r.rate === null ? "—" : `${Math.round(r.rate * 100)}%`}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
      <s-section>
        <s-paragraph color="subdued">
          Locked views count browsing sessions that reached a locked page without a key.
          Unlocks count passcodes, secret links, confirmations, IP and newsletter unlocks; tag
          and sign-in keys open silently and aren&apos;t counted. Turn counting off in the app
          embed settings.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
