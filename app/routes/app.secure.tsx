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
import { ensureShop, listLocks } from "../models/lock.server";
import { syncShop } from "../lib/compile.server";
import { splitList } from "../lib/locks";
import {
  installSecure,
  previewSecure,
  uninstallSecure,
  type SecureReport,
} from "../lib/secure/install.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return {
    enabled: shop.secureEnabled,
    excluded: (shop.secureExcluded ?? []) as string[],
    report: (shop.secureReport ?? {}) as SecureReport,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = await request.json();
  const locks = await listLocks(shop.id);

  switch (body.intent) {
    case "exclude": {
      const files = splitList(String(body.files ?? "")).filter((f) => /^[\w./-]+\.liquid$/.test(f));
      await prisma.shop.update({ where: { id: shop.id }, data: { secureExcluded: files } });
      return { ok: true, message: "Excluded files saved. Reinstall to apply." };
    }
    case "preview": {
      const report = await previewSecure(admin.graphql, shop.id, (shop.secureExcluded ?? []) as string[], locks);
      return { ok: !report.error, message: report.error ?? "Preview ready" };
    }
    case "install": {
      const report = await installSecure(admin.graphql, shop, locks);
      if (report.error) return { ok: false, message: report.error };
      await syncShop(admin.graphql, session.shop);
      return { ok: true, message: `Secure mode is on for ${report.themeName ?? "your theme"}` };
    }
    case "uninstall": {
      const result = await uninstallSecure(admin.graphql, shop);
      return result.ok
        ? { ok: true, message: "Secure mode removed and theme files restored" }
        : { ok: false, message: result.error ?? "Couldn't remove secure mode" };
    }
  }
  return { ok: false, message: "Unknown action" };
};

export default function SecureMode() {
  const { enabled, excluded, report } = useLoaderData<typeof loader>();
  const [excludedText, setExcludedText] = useState(excluded.join("\n"));
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  const submit = (body: Record<string, unknown>) =>
    fetcher.submit(body as any, { method: "post", encType: "application/json" });

  return (
    <s-page heading="Secure mode" inlineSize="base">
      {enabled ? (
        <s-badge slot="title-metadata" tone="success">On</s-badge>
      ) : (
        <s-badge slot="title-metadata">Off</s-badge>
      )}

      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            By default LockRules hides locked content in the browser: the page still contains
            it, and checkout protection stops anyone buying what they can&apos;t access. Secure mode
            adds LockRules to your published theme so locked pages, and locked items in product
            lists, search and menus, are never sent to visitors without a key.
          </s-paragraph>
          <s-unordered-list>
            <s-list-item>Only LockRules&apos; own marked code is added, and removing secure mode restores your files exactly.</s-list-item>
            <s-list-item>Publishing another theme moves secure mode to it automatically.</s-list-item>
            <s-list-item>
              Product data stays readable at /products/handle.js and .json and through other sales
              channels. Checkout protection still blocks purchases.
            </s-list-item>
          </s-unordered-list>
        </s-stack>
      </s-section>

      {report.needsExemption && (
        <s-banner tone="warning" heading="Waiting for Shopify approval">
          Shopify only lets approved apps edit theme files. LockRules has requested this
          permission; until it&apos;s granted, secure mode can&apos;t be turned on. Your locks keep working in
          browser mode with checkout protection.
        </s-banner>
      )}
      {report.error && !report.needsExemption && (
        <s-banner tone="critical" heading="Last attempt failed">
          {report.error}
        </s-banner>
      )}

      <s-section heading={report.dryRun ? "Preview" : "Theme changes"}>
        {report.edited?.length ? (
          <s-stack gap="small-200">
            <s-paragraph>
              {report.dryRun ? "Turning on secure mode would change" : "Secure mode changed"}{" "}
              {report.edited.length} files in {report.themeName ?? "your theme"} and filter{" "}
              {report.loops ?? 0} product, search and menu loops.
            </s-paragraph>
            <s-unordered-list>
              {report.edited.map((f) => (
                <s-list-item key={f}>{f}</s-list-item>
              ))}
            </s-unordered-list>
            {report.at && (
              <s-paragraph color="subdued">{new Date(report.at).toLocaleString()}</s-paragraph>
            )}
          </s-stack>
        ) : (
          <s-paragraph color="subdued">Preview the changes to see what secure mode would do to your theme.</s-paragraph>
        )}
        {!!report.warnings?.length && (
          <s-banner tone="warning" heading="Check these">
            <s-unordered-list>
              {report.warnings.map((w) => (
                <s-list-item key={w}>{w}</s-list-item>
              ))}
            </s-unordered-list>
          </s-banner>
        )}
        <s-stack direction="inline" gap="small-200">
          <s-button disabled={busy} onClick={() => submit({ intent: "preview" })}>
            Preview changes
          </s-button>
          <s-button variant="primary" loading={busy} onClick={() => submit({ intent: "install" })}>
            {enabled ? "Repair / reinstall" : "Turn on secure mode"}
          </s-button>
          {enabled && (
            <s-button
              tone="critical"
              disabled={busy}
              onClick={() => {
                if (confirm("Remove LockRules from your theme? Locks fall back to browser mode.")) {
                  submit({ intent: "uninstall" });
                }
              }}
            >
              Turn off and restore theme
            </s-button>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Excluded theme files">
        <s-stack gap="base">
          <s-text-area
            label="Don't modify these files"
            rows={4}
            value={excludedText}
            placeholder="sections/main-collection-product-grid.liquid"
            details="One per line. Use this if a section breaks after secure mode is installed."
            onInput={(e) => setExcludedText(e.currentTarget.value)}
          />
          <s-stack direction="inline">
            <s-button disabled={busy} onClick={() => submit({ intent: "exclude", files: excludedText })}>
              Save excluded files
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
