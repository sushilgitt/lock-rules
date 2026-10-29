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
import prisma from "../db.server";
import { ensureShop } from "../models/lock.server";
import { syncShop } from "../lib/compile.server";
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
  return { settings: getSettings(shop.settings), locales };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = getSettings(await request.json());
  await prisma.shop.update({
    where: { domain: session.shop },
    data: { settings: settings as any },
  });
  return syncShop(admin.graphql, session.shop);
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
  const { settings: initial, locales } = useLoaderData<typeof loader>();
  const [settings, setSettings] = useState<ShopSettings>(initial);
  const [locale, setLocale] = useState(locales[0]?.locale ?? "");
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Settings saved");
    else if (fetcher.data) shopify.toast.show("Saved, but sync had problems", { isError: true });
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
