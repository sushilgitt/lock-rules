import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop, listLocks } from "../models/lock.server";
import { compile, gql, loadListEntries } from "../lib/compile.server";
import { getSettings } from "../lib/settings";
import { legacyId, splitList } from "../lib/locks";
import { localToEpoch } from "../lib/time";
import { simulate, type PageContext, type Visitor } from "../lib/debug.server";
import { embedActivationUrl, isEmbedEnabled } from "../lib/theme.server";
import { currentPlan } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [locks, embed, plan] = await Promise.all([
    listLocks(shop.id),
    isEmbedEnabled(admin.graphql).catch(() => null),
    currentPlan(admin.graphql, session.shop),
  ]);
  const active = locks.filter((l) => l.enabled).length;
  return {
    checks: [
      {
        ok: embed === true,
        label: "App embed is on in your published theme",
        fix: embed === true ? null : embedActivationUrl(session.shop, process.env.SHOPIFY_API_KEY || ""),
      },
      { ok: !shop.syncError && Boolean(shop.lastSyncedAt), label: "Locks synced to Shopify", fix: shop.syncError },
      { ok: active <= plan.maxLocks, label: `${active} active locks within the ${plan.name} plan`, fix: null },
    ],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const b = await request.json();

  const data = await gql(admin.graphql, `#graphql
    query LockRulesDebugShop { shop { ianaTimezone } }`);
  const timeZone = data.shop.ianaTimezone || "UTC";
  const [locks, lists] = await Promise.all([listLocks(shop.id), loadListEntries(shop.id)]);
  const { storefront } = compile(locks, getSettings(shop.settings), lists, shop.hmacSecret ?? "", timeZone);

  let page: PageContext = { template: b.template ?? "other" };
  if (b.productId) {
    const p = await gql(
      admin.graphql,
      `#graphql
      query LockRulesDebugProduct($id: ID!) {
        product(id: $id) {
          id title vendor tags
          collections(first: 100) { nodes { id } }
          variants(first: 100) { nodes { id } }
        }
      }`,
      { id: b.productId },
    );
    const product = p.product;
    if (product) {
      page = {
        template: "product",
        id: legacyId(product.id),
        title: product.title,
        vendor: product.vendor,
        tags: product.tags,
        collections: product.collections.nodes.map((c: { id: string }) => legacyId(c.id)),
        variants: product.variants.nodes.map((v: { id: string }) => legacyId(v.id)),
      };
    }
  }

  const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.at ?? "") ? b.at : null;
  const nowEpoch = at ? (localToEpoch(at, timeZone) ?? Date.now() / 1000) : Math.floor(Date.now() / 1000);
  const local = at ?? new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date()).replace(" ", "T");
  const day = new Date(`${local.slice(0, 10)}T12:00:00Z`).getUTCDay();

  const visitor: Visitor = {
    signedIn: Boolean(b.signedIn),
    email: String(b.email ?? ""),
    tags: splitList(String(b.tags ?? "")),
    orders: Number(b.orders) || 0,
    purchased: [],
    country: String(b.country ?? ""),
    market: String(b.market ?? ""),
    host: String(b.host ?? ""),
    subtotalCents: Math.round((Number(b.subtotal) || 0) * 100),
    cartProducts: [],
    now: nowEpoch,
    weekday: ((day + 6) % 7) + 1,
    hm: Number(local.slice(11, 16).replace(":", "")),
    unlockedRemote: Boolean(b.unlockedRemote),
    customLiquid: Boolean(b.customLiquid),
  };

  const names = Object.fromEntries(locks.map((l) => [l.id, l.name]));
  return {
    page,
    results: simulate(storefront, visitor, page).map((r) => ({ ...r, name: names[r.id] ?? r.id })),
  };
};

export default function Debugger() {
  const { checks } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [v, setV] = useState({
    signedIn: false,
    email: "",
    tags: "",
    orders: "0",
    country: "US",
    market: "",
    host: "",
    subtotal: "0",
    at: "",
    unlockedRemote: false,
    customLiquid: false,
    template: "product",
    productId: "",
    productTitle: "",
  });
  const set = (k: keyof typeof v, value: string | boolean) => setV((x) => ({ ...x, [k]: value }));
  const results = fetcher.data?.results ?? [];
  const covering = results.filter((r) => r.applies);

  const pickProduct = async () => {
    const selected = await shopify.resourcePicker({ type: "product", multiple: false, action: "select" });
    if (selected?.[0]) {
      setV((x) => ({ ...x, productId: selected[0].id, productTitle: selected[0].title, template: "product" }));
    }
  };

  return (
    <s-page heading="Lock debugger">
      <s-section heading="Setup">
        <s-stack gap="small-200">
          {checks.map((c) => (
            <s-stack key={c.label} direction="inline" gap="small-200" alignItems="center">
              <s-badge tone={c.ok ? "success" : "critical"}>{c.ok ? "OK" : "Check"}</s-badge>
              <s-text>{c.label}</s-text>
              {!c.ok && c.fix?.startsWith("https://") && (
                <s-link href={c.fix} target="_blank">
                  Fix
                </s-link>
              )}
              {!c.ok && c.fix && !c.fix.startsWith("https://") && <s-text color="subdued">{c.fix}</s-text>}
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Test visitor">
        <s-stack gap="base">
          <s-switch label="Signed in" checked={v.signedIn} onChange={(e) => set("signedIn", e.currentTarget.checked)} />
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <s-email-field label="Email" value={v.email} disabled={!v.signedIn} onInput={(e) => set("email", e.currentTarget.value)} />
            <s-text-field label="Customer tags" value={v.tags} placeholder="wholesale, vip" disabled={!v.signedIn} onInput={(e) => set("tags", e.currentTarget.value)} />
            <s-number-field label="Orders placed" value={v.orders} min={0} disabled={!v.signedIn} onInput={(e) => set("orders", e.currentTarget.value)} />
          </s-grid>
          <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
            <s-text-field label="Country" value={v.country} placeholder="US" onInput={(e) => set("country", e.currentTarget.value)} />
            <s-text-field label="Market handle" value={v.market} onInput={(e) => set("market", e.currentTarget.value)} />
            <s-text-field label="Domain" value={v.host} placeholder="shop.example.com" onInput={(e) => set("host", e.currentTarget.value)} />
            <s-number-field label="Cart subtotal" value={v.subtotal} min={0} step={0.01} onInput={(e) => set("subtotal", e.currentTarget.value)} />
          </s-grid>
          <s-text-field
            label="Date and time (store time, optional)"
            value={v.at}
            placeholder="2026-12-01T09:00"
            details="Leave empty for now."
            onInput={(e) => set("at", e.currentTarget.value)}
          />
          <s-checkbox
            label="Visitor has entered the passcode / used the secret link / confirmed / subscribed"
            checked={v.unlockedRemote}
            onChange={(e) => set("unlockedRemote", e.currentTarget.checked)}
          />
          <s-checkbox
            label="Custom Liquid conditions pass"
            checked={v.customLiquid}
            onChange={(e) => set("customLiquid", e.currentTarget.checked)}
          />
        </s-stack>
      </s-section>

      <s-section heading="Page">
        <s-stack gap="base">
          <s-select label="Page type" value={v.template} onChange={(e) => set("template", e.currentTarget.value)}>
            <s-option value="product">Product</s-option>
            <s-option value="index">Home page</s-option>
            <s-option value="page">Online store page</s-option>
            <s-option value="other">Other page</s-option>
          </s-select>
          {v.template === "product" && (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-button onClick={pickProduct}>{v.productTitle ? "Change product" : "Choose product"}</s-button>
              {v.productTitle && <s-text>{v.productTitle}</s-text>}
            </s-stack>
          )}
          <s-stack direction="inline">
            <s-button
              variant="primary"
              loading={fetcher.state !== "idle"}
              onClick={() =>
                fetcher.submit(
                  { ...v, productId: v.template === "product" ? v.productId : "" } as any,
                  { method: "post", encType: "application/json" },
                )
              }
            >
              Run test
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {fetcher.data && (
        <s-section heading="Result">
          <s-stack gap="base">
            <s-banner tone={covering.every((r) => r.open) ? "success" : "warning"}>
              {covering.length === 0
                ? "No lock covers this page, so the visitor sees it."
                : covering.every((r) => r.open)
                  ? "Every lock on this page opens for this visitor."
                  : `Blocked by: ${covering.filter((r) => !r.open).map((r) => r.name).join(", ")}`}
            </s-banner>
            {results.map((r) => (
              <s-box key={r.id} padding="base" border="base" borderRadius="base">
                <s-stack gap="small-200">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text type="strong">{r.name}</s-text>
                    {!r.applies ? (
                      <s-badge>Doesn&apos;t cover this page</s-badge>
                    ) : r.open ? (
                      <s-badge tone="success">Opens</s-badge>
                    ) : (
                      <s-badge tone="critical">Stays locked</s-badge>
                    )}
                  </s-stack>
                  <s-text color="subdued">{r.appliesWhy}</s-text>
                  {r.keys.length === 0 && <s-text>No keys: locked for everyone.</s-text>}
                  {r.keys.map((k, i) => (
                    <s-stack key={i} gap="small-100">
                      <s-text type="strong">
                        Key {i + 1}: {k.pass ? "passes" : "fails"}
                      </s-text>
                      <s-unordered-list>
                        {k.conditions.map((c, j) => (
                          <s-list-item key={j}>
                            {c.pass ? "✓" : "✗"} {c.label}: {c.why}
                          </s-list-item>
                        ))}
                      </s-unordered-list>
                    </s-stack>
                  ))}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
