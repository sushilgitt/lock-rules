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
import { ensureShop } from "../models/lock.server";
import { syncShop } from "../lib/compile.server";
import {
  applyBackfill,
  currentBackfill,
  startPurchaseBackfill,
  updateSettings,
} from "../lib/customers.server";
import { MESSAGE_FIELDS, getSettings, type Messages, type ShopSettings } from "../lib/settings";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const res = await admin.graphql(`#graphql
    query LockRulesLocales { shopLocales { locale name primary published } }`);
  const { data } = await res.json();
  const locales = ((data?.shopLocales ?? []) as { locale: string; name: string; primary: boolean }[])
    .filter((l) => !l.primary)
    .map((l) => ({ locale: l.locale.toLowerCase(), name: l.name }));
  const backfill = await currentBackfill(admin.graphql).catch(() => null);
  return {
    settings: getSettings(shop.settings),
    locales,
    backfill: backfill && { status: backfill.status, completedAt: backfill.completedAt, ready: Boolean(backfill.url) },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();

  if (body.intent === "backfill-start") {
    try {
      await startPurchaseBackfill(admin.graphql);
      return { ok: true, message: "Purchase history sync started. Check back in a few minutes." };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  if (body.intent === "backfill-apply") {
    const op = await currentBackfill(admin.graphql);
    if (op?.status !== "COMPLETED" || !op.url) {
      return { ok: false, message: "The sync hasn't finished yet." };
    }
    const customers = await applyBackfill(admin.graphql, op.url);
    return { ok: true, message: `Updated purchase history for ${customers} customers.` };
  }

  // Only messages live on this page; other settings are saved by their own pages.
  const { messages, translations } = getSettings(body);
  await updateSettings(session.shop, { messages, translations });
  const sync = await syncShop(admin.graphql, session.shop);
  return { ok: sync.ok, message: sync.ok ? "Settings saved" : "Saved, but sync had problems" };
};

function MessageFields({
  values,
  placeholders,
  onChange,
}: {
  values: Partial<Messages>;
  placeholders?: Messages;
  onChange: (key: keyof Messages, value: string) => void;
}) {
  return (
    <s-stack gap="base">
      {MESSAGE_FIELDS.map((f) =>
        f.multiline ? (
          <s-text-area
            key={f.key}
            label={f.label}
            rows={2}
            value={values[f.key] ?? ""}
            placeholder={placeholders?.[f.key]}
            onInput={(e) => onChange(f.key, e.currentTarget.value)}
          />
        ) : (
          <s-text-field
            key={f.key}
            label={f.label}
            value={values[f.key] ?? ""}
            placeholder={placeholders?.[f.key]}
            onInput={(e) => onChange(f.key, e.currentTarget.value)}
          />
        ),
      )}
    </s-stack>
  );
}

export default function Settings() {
  const { settings: initial, locales, backfill } = useLoaderData<typeof loader>();
  const [settings, setSettings] = useState<ShopSettings>(initial);
  const [locale, setLocale] = useState(locales[0]?.locale ?? "");
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  const setMessage = (key: keyof Messages, value: string) =>
    setSettings((s) => ({ ...s, messages: { ...s.messages, [key]: value } }));

  const setTranslation = (key: keyof Messages, value: string) =>
    setSettings((s) => ({
      ...s,
      translations: {
        ...s.translations,
        [locale]: { ...(s.translations[locale] ?? {}), [key]: value },
      },
    }));

  return (
    <s-page heading="Settings" inlineSize="base">
      <s-button
        slot="primary-action"
        variant="primary"
        loading={fetcher.state !== "idle"}
        onClick={() =>
          fetcher.submit(settings as any, { method: "post", encType: "application/json" })
        }
      >
        Save
      </s-button>

      <s-section heading="Messages">
        <s-paragraph color="subdued">
          Shown on locked pages and at checkout. A lock&apos;s own message takes priority over
          these defaults.
        </s-paragraph>
        <MessageFields values={settings.messages} onChange={setMessage} />
      </s-section>

      <s-section heading="Purchase history">
        <s-stack gap="base">
          <s-paragraph>
            “Customer has purchased a product” keys use each customer&apos;s order history. New
            orders are added automatically; sync once to load past orders.
          </s-paragraph>
          {backfill && (
            <s-paragraph color="subdued">
              Last sync: {backfill.status.toLowerCase()}
              {backfill.completedAt ? ` (${new Date(backfill.completedAt).toLocaleString()})` : ""}
            </s-paragraph>
          )}
          <s-stack direction="inline" gap="small-200">
            <s-button
              disabled={fetcher.state !== "idle" || backfill?.status === "RUNNING"}
              onClick={() =>
                fetcher.submit({ intent: "backfill-start" } as any, { method: "post", encType: "application/json" })
              }
            >
              Sync purchase history
            </s-button>
            {backfill?.status === "COMPLETED" && backfill.ready && (
              <s-button
                variant="primary"
                disabled={fetcher.state !== "idle"}
                onClick={() =>
                  fetcher.submit({ intent: "backfill-apply" } as any, { method: "post", encType: "application/json" })
                }
              >
                Apply finished sync
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Translations">
        {locales.length === 0 ? (
          <s-paragraph color="subdued">
            Publish another language in Settings › Languages to translate these messages.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-select label="Language" value={locale} onChange={(e) => setLocale(e.currentTarget.value)}>
              {locales.map((l) => (
                <s-option key={l.locale} value={l.locale}>
                  {l.name}
                </s-option>
              ))}
            </s-select>
            <s-paragraph color="subdued">Leave a field empty to use the default message.</s-paragraph>
            <MessageFields
              key={locale}
              values={settings.translations[locale] ?? {}}
              placeholders={settings.messages}
              onChange={setTranslation}
            />
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
