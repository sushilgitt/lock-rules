import { useEffect, useState } from "react";
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
import { createApiKey, listApiKeys, revokeApiKey } from "../lib/api.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const locks = await listLocks(shop.id);
  return {
    keys: await listApiKeys(shop.id),
    baseUrl: `${process.env.SHOPIFY_APP_URL ?? ""}/api/v1`,
    locks: locks.map((l) => ({ id: l.id, name: l.name })),
    secure: shop.secureEnabled,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = await request.json();
  if (body.intent === "revoke") {
    await revokeApiKey(shop.id, String(body.id));
    return { ok: true, message: "Key revoked", key: null };
  }
  const key = await createApiKey(shop.id, String(body.name ?? ""));
  return { ok: true, message: "Key created", key };
};

function Code({ children }: { children: string }) {
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13 }}>
        <code>{children}</code>
      </pre>
    </s-box>
  );
}

export default function Developers() {
  const { keys, baseUrl, locks, secure } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [name, setName] = useState("");
  const newKey = fetcher.data?.key;
  const lockId = locks[0]?.id ?? "LOCK_ID";

  useEffect(() => {
    if (fetcher.data) shopify.toast.show(fetcher.data.message);
    if (fetcher.data?.key) setName("");
  }, [fetcher.data, shopify]);

  const submit = (body: Record<string, unknown>) =>
    fetcher.submit(body as any, { method: "post", encType: "application/json" });

  return (
    <s-page heading="Developers">
      <s-section heading="API keys">
        <s-stack gap="base">
          {newKey && (
            <s-banner tone="success" heading="Copy your new key now">
              <s-stack gap="small-200">
                <s-paragraph>It won&apos;t be shown again.</s-paragraph>
                <Code>{newKey}</Code>
              </s-stack>
            </s-banner>
          )}
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
            <s-text-field
              label="Key name"
              value={name}
              placeholder="ERP sync"
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <s-button variant="primary" onClick={() => submit({ intent: "create", name })}>
              Create key
            </s-button>
          </s-grid>
          {keys.length > 0 && (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Name</s-table-header>
                <s-table-header>Key</s-table-header>
                <s-table-header>Last used</s-table-header>
                <s-table-header listSlot="secondary">Revoke</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {keys.map((k) => (
                  <s-table-row key={k.id}>
                    <s-table-cell>{k.name}</s-table-cell>
                    <s-table-cell>{k.prefix}…</s-table-cell>
                    <s-table-cell>
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}
                    </s-table-cell>
                    <s-table-cell>
                      <s-button
                        tone="critical"
                        variant="tertiary"
                        onClick={() => {
                          if (confirm(`Revoke "${k.name}"? Apps using it stop working.`)) {
                            submit({ intent: "revoke", id: k.id });
                          }
                        }}
                      >
                        Revoke
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      <s-section heading="REST API">
        <s-stack gap="base">
          <s-paragraph>
            Manage locks, input lists and key usage from your own systems. Send your key as a
            bearer token. Changes sync to your store immediately. Limit: 120 requests per
            minute per key.
          </s-paragraph>
          <s-unordered-list>
            <s-list-item>GET / POST {baseUrl}/locks</s-list-item>
            <s-list-item>GET / PUT / PATCH / DELETE {baseUrl}/locks/:id</s-list-item>
            <s-list-item>GET / POST {baseUrl}/lists</s-list-item>
            <s-list-item>GET / PUT / DELETE {baseUrl}/lists/:id</s-list-item>
            <s-list-item>GET {baseUrl}/usage?since=2026-10-01&amp;lock=:id&amp;limit=100</s-list-item>
          </s-unordered-list>
          <Code>{`curl -X POST ${baseUrl}/lists \\
  -H "Authorization: Bearer lr_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"VIP codes","kind":"passcode","entries":["SUMMER24",{"v":"GOLD","r":"/collections/gold"}]}'`}</Code>
          <Code>{`curl -X POST ${baseUrl}/locks \\
  -H "Authorization: Bearer lr_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Wholesale",
    "resourceType": "product_tag",
    "resources": [{ "id": "wholesale", "handle": "", "title": "wholesale" }],
    "protect": "commerce",
    "keys": [{ "conditions": [{ "type": "tag", "values": ["wholesale"] }] }]
  }'`}</Code>
          <s-paragraph color="subdued">
            Lock bodies use the same fields as the editor: name, resourceType, resources,
            enabled, protect, deniedAction, deniedMessage, redirectUrl, hideFromLists,
            hideNavLinks, seoHidden, storeExceptions and keys. PATCH merges top-level fields.
            Validation errors return 422 with details.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="JavaScript API">
        <s-stack gap="base">
          <s-paragraph>
            Turn on “Enable JavaScript API” in the LockRules app embed (theme editor › App
            embeds), then use it from your theme&apos;s scripts:
          </s-paragraph>
          <Code>{`document.addEventListener("lockrules:ready", () => {
  if (LockRules.accessGranted("${lockId}")) {
    document.querySelector(".members-banner")?.removeAttribute("hidden");
  }
});

// Send visitors without access somewhere else
LockRules.requireAccess("${lockId}", "/pages/join");`}</Code>
          <s-paragraph color="subdued">
            Browser checks are for presentation only; use secure mode or checkout protection
            to actually keep content and products private.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Liquid (secure mode)">
        <s-stack gap="base">
          <s-paragraph>
            With secure mode {secure ? "on" : "turned on"}, theme code can check any lock on
            the server:
          </s-paragraph>
          <Code>{`{%- capture access -%}{%- render 'lockrules-access', lock_id: '${lockId}' -%}{%- endcapture -%}
{%- if access == '1' -%}
  Members-only content
{%- else -%}
  <a href="{{ routes.account_login_url }}">Sign in to see this</a>
{%- endif -%}`}</Code>
        </s-stack>
      </s-section>

      {locks.length > 0 && (
        <s-section heading="Lock IDs">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Lock</s-table-header>
              <s-table-header listSlot="secondary">ID</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {locks.map((l) => (
                <s-table-row key={l.id}>
                  <s-table-cell>{l.name}</s-table-cell>
                  <s-table-cell>{l.id}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
