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
import { getSettings, type ShopSettings } from "../lib/settings";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return { settings: getSettings(shop.settings) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = (await request.json()) as ShopSettings;
  const settings = getSettings(body);
  await prisma.shop.update({
    where: { domain: session.shop },
    data: { settings: settings as any },
  });
  return syncShop(admin.graphql, session.shop);
};

export default function Settings() {
  const { settings: initial } = useLoaderData<typeof loader>();
  const [settings, setSettings] = useState(initial);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Settings saved");
    else if (fetcher.data) shopify.toast.show("Saved, but sync had problems", { isError: true });
  }, [fetcher.data, shopify]);

  const setMessage = (key: keyof ShopSettings["messages"], value: string) =>
    setSettings((s) => ({ ...s, messages: { ...s.messages, [key]: value } }));

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

      <s-section heading="Storefront messages">
        <s-stack gap="base">
          <s-text-area
            label="Sign-in prompt"
            rows={2}
            value={settings.messages.login}
            details="Shown to guests when a lock uses “Ask guests to sign in”."
            onInput={(e) => setMessage("login", e.currentTarget.value)}
          />
          <s-text-field
            label="Sign-in button label"
            value={settings.messages.loginButton}
            onInput={(e) => setMessage("loginButton", e.currentTarget.value)}
          />
          <s-text-area
            label="Access denied message"
            rows={2}
            value={settings.messages.denied}
            details="Default for locks without their own message."
            onInput={(e) => setMessage("denied", e.currentTarget.value)}
          />
        </s-stack>
      </s-section>

      <s-section heading="Checkout">
        <s-text-field
          label="Checkout error"
          value={settings.messages.checkout}
          details="Shown when a cart has a locked product. {title} is replaced with the product name."
          onInput={(e) => setMessage("checkout", e.currentTarget.value)}
        />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
