import { useEffect } from "react";
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
import { embedActivationUrl, isEmbedEnabled } from "../lib/theme.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [lockCount, enabledCount, embedEnabled] = await Promise.all([
    prisma.lock.count({ where: { shopId: shop.id } }),
    prisma.lock.count({ where: { shopId: shop.id, enabled: true } }),
    isEmbedEnabled(admin.graphql).catch(() => null),
  ]);

  return {
    lockCount,
    enabledCount,
    embedEnabled,
    embedUrl: embedActivationUrl(session.shop, process.env.SHOPIFY_API_KEY || ""),
    lastSyncedAt: shop.lastSyncedAt?.toISOString() ?? null,
    syncError: shop.syncError,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  return syncShop(admin.graphql, session.shop);
};

export default function Index() {
  const { lockCount, enabledCount, embedEnabled, embedUrl, lastSyncedAt, syncError } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const syncing = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Locks synced to your store");
    else if (fetcher.data) shopify.toast.show("Sync finished with problems", { isError: true });
  }, [fetcher.data, shopify]);

  const setupDone = embedEnabled === true && lockCount > 0;

  return (
    <s-page heading="LockRules">
      <s-button slot="primary-action" variant="primary" href="/app/locks/new">
        Create lock
      </s-button>

      {!setupDone && (
        <s-section heading="Get started">
          <s-ordered-list>
            <s-list-item>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">Turn on the LockRules app embed in your theme.</s-text>
                {embedEnabled === true ? (
                  <s-badge tone="success">Done</s-badge>
                ) : (
                  <s-link href={embedUrl} target="_blank">
                    Open theme editor
                  </s-link>
                )}
              </s-stack>
            </s-list-item>
            <s-list-item>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">Create your first lock.</s-text>
                {lockCount > 0 ? (
                  <s-badge tone="success">Done</s-badge>
                ) : (
                  <s-link href="/app/locks/new">Create lock</s-link>
                )}
              </s-stack>
            </s-list-item>
          </s-ordered-list>
        </s-section>
      )}

      <s-section heading="Status">
        <s-stack gap="base">
          <s-paragraph>
            {enabledCount} of {lockCount} locks active.{" "}
            <s-link href="/app/locks">Manage locks</s-link>
          </s-paragraph>
          {embedEnabled === false && (
            <s-banner tone="warning" heading="App embed is off">
              Locks won't apply to your storefront until you turn on the LockRules app
              embed. Checkout protection still blocks locked products from being bought.
            </s-banner>
          )}
          {syncError ? (
            <s-banner tone="critical" heading="Last sync had problems">
              <s-paragraph>{syncError}</s-paragraph>
            </s-banner>
          ) : (
            <s-paragraph color="subdued">
              {lastSyncedAt
                ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}.`
                : "Not synced yet."}
            </s-paragraph>
          )}
          <s-stack direction="inline">
            <s-button
              onClick={() => fetcher.submit({}, { method: "post" })}
              loading={syncing}
            >
              Sync now
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How locks work">
        <s-paragraph>
          A lock hides products, collections, pages or your whole store. Keys decide who
          gets in: any key opens the lock, and every condition inside a key must pass.
        </s-paragraph>
        <s-paragraph>
          Storefront locks run in your theme. Checkout protection also stops locked
          products from being bought by anyone who doesn't have a key.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
