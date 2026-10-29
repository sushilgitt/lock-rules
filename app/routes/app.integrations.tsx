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
import {
  connect,
  disconnect,
  listIntegrations,
  type Provider,
} from "../lib/integrations.server";

const PROVIDERS: { id: Provider; name: string; keyHelp: string }[] = [
  {
    id: "klaviyo",
    name: "Klaviyo",
    keyHelp:
      "A private API key with lists, segments and profiles read access, plus subscriptions write access (Settings › API keys).",
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    keyHelp: "An API key from Profile › Extras › API keys. It ends with your data center, like -us21.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return { connected: await listIntegrations(shop.id) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = await request.json();
  const provider: Provider = body.provider === "mailchimp" ? "mailchimp" : "klaviyo";

  if (body.intent === "disconnect") {
    await disconnect(shop.id, provider);
    return { ok: true, message: "Disconnected" };
  }
  try {
    const audiences = await connect(shop.id, provider, String(body.apiKey ?? ""), {
      doubleOptIn: Boolean(body.doubleOptIn),
    });
    return { ok: true, message: `Connected. Found ${audiences.length} lists.` };
  } catch (e) {
    return {
      ok: false,
      message: `Couldn't connect: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
    };
  }
};

function ProviderCard({
  provider,
  connectedAt,
  doubleOptIn: initialDoubleOptIn,
}: {
  provider: (typeof PROVIDERS)[number];
  connectedAt?: string;
  doubleOptIn?: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [apiKey, setApiKey] = useState("");
  const [doubleOptIn, setDoubleOptIn] = useState(Boolean(initialDoubleOptIn));
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    if (fetcher.data?.ok) setApiKey("");
  }, [fetcher.data, shopify]);

  const submit = (body: Record<string, unknown>) =>
    fetcher.submit({ provider: provider.id, ...body } as any, { method: "post", encType: "application/json" });

  return (
    <s-section heading={provider.name}>
      <s-stack gap="base">
        {connectedAt ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone="success">Connected</s-badge>
            <s-text color="subdued">since {new Date(connectedAt).toLocaleDateString()}</s-text>
          </s-stack>
        ) : (
          <s-badge>Not connected</s-badge>
        )}
        <s-password-field
          label={connectedAt ? "Replace API key" : "API key"}
          value={apiKey}
          autocomplete="off"
          details={provider.keyHelp}
          onInput={(e) => setApiKey(e.currentTarget.value)}
        />
        {provider.id === "mailchimp" && (
          <s-checkbox
            label="Double opt-in: send Mailchimp's confirmation email (unlocks immediately either way)"
            checked={doubleOptIn}
            onChange={(e) => setDoubleOptIn(e.currentTarget.checked)}
          />
        )}
        <s-stack direction="inline" gap="small-200">
          <s-button
            variant="primary"
            loading={busy}
            disabled={!apiKey.trim()}
            onClick={() => submit({ intent: "connect", apiKey, doubleOptIn })}
          >
            {connectedAt ? "Update" : "Connect"}
          </s-button>
          {connectedAt && (
            <s-button tone="critical" disabled={busy} onClick={() => submit({ intent: "disconnect" })}>
              Disconnect
            </s-button>
          )}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export default function Integrations() {
  const { connected } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Integrations" inlineSize="base">
      <s-section>
        <s-paragraph>
          Connect your email platform to unlock content when visitors subscribe, or for
          customers already on a Klaviyo list or segment. Keys are stored encrypted and
          only used to subscribe visitors and check membership.
        </s-paragraph>
      </s-section>
      {PROVIDERS.map((p) => {
        const c = connected.find((x) => x.provider === p.id);
        return (
          <ProviderCard
            key={p.id}
            provider={p}
            connectedAt={c?.connectedAt}
            doubleOptIn={c?.settings.doubleOptIn}
          />
        );
      })}
      <s-section heading="Subscription apps">
        <s-paragraph>
          ReCharge, Seal, Appstle and most subscription apps tag customers with an active
          subscription. Find that tag in your subscription app&apos;s settings, then lock
          members-only products or pages with the key “Customer has a tag”. Tags update when
          a subscription starts or ends, so access follows automatically.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
