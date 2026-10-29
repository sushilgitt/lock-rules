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
import { getSettings, type ApprovalSettings } from "../lib/settings";
import { retagCustomer, updateSettings } from "../lib/customers.server";

type Pending = { id: string; name: string; email: string; createdAt: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const { approval } = getSettings(shop.settings);

  let pending: Pending[] = [];
  let error: string | null = null;
  try {
    const res = await admin.graphql(
      `#graphql
      query LockRulesPending($query: String!) {
        customers(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
          nodes { id displayName defaultEmailAddress { emailAddress } createdAt tags }
        }
      }`,
      { variables: { query: `tag:'${approval.pendingTag.replace(/'/g, "")}'` } },
    );
    const json = await res.json();
    if ((json as any).errors) throw new Error(JSON.stringify((json as any).errors));
    pending = (json.data?.customers?.nodes ?? []).map((c: any) => ({
      id: c.id,
      name: c.displayName,
      email: c.defaultEmailAddress?.emailAddress ?? "",
      createdAt: c.createdAt,
    }));
  } catch (e) {
    error =
      "LockRules couldn't read customers. Make sure the app has protected customer data access (name and email) in the Partner Dashboard.";
    console.error(e);
  }

  return { approval, pending, error };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();
  const shop = await ensureShop(session.shop);
  const { approval } = getSettings(shop.settings);

  if (body.intent === "settings") {
    const next = await updateSettings(session.shop, { approval: body.approval as ApprovalSettings });
    return { ok: true, message: next.approval.enabled ? "Approval turned on" : "Settings saved" };
  }

  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const approve = body.intent === "approve";
  for (const id of ids) {
    await retagCustomer(
      admin.graphql,
      id,
      [approve ? approval.approvedTag : approval.rejectedTag],
      [approval.pendingTag],
    );
  }
  return { ok: true, message: `${ids.length} customer${ids.length === 1 ? "" : "s"} ${approve ? "approved" : "rejected"}` };
};

export default function Approvals() {
  const { approval: initial, pending, error } = useLoaderData<typeof loader>();
  const [approval, setApproval] = useState(initial);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data, shopify]);

  const submit = (body: Record<string, unknown>) =>
    fetcher.submit(body as any, { method: "post", encType: "application/json" });
  const set = (key: keyof ApprovalSettings, value: string | boolean) =>
    setApproval((a) => ({ ...a, [key]: value }));

  return (
    <s-page heading="Customer approval">
      <s-section heading={`Waiting for approval (${pending.length})`} padding="none">
        {error ? (
          <s-box padding="base">
            <s-banner tone="warning">{error}</s-banner>
          </s-box>
        ) : pending.length === 0 ? (
          <s-box padding="base">
            <s-paragraph color="subdued">
              {approval.enabled
                ? "No one is waiting. New sign-ups appear here."
                : "Turn on approval below to review new sign-ups here."}
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Customer</s-table-header>
              <s-table-header>Email</s-table-header>
              <s-table-header>Signed up</s-table-header>
              <s-table-header listSlot="secondary">Review</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {pending.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>{c.name}</s-table-cell>
                  <s-table-cell>{c.email}</s-table-cell>
                  <s-table-cell>{new Date(c.createdAt).toLocaleDateString()}</s-table-cell>
                  <s-table-cell>
                    <s-button-group>
                      <s-button
                        variant="primary"
                        disabled={busy}
                        onClick={() => submit({ intent: "approve", ids: [c.id] })}
                      >
                        Approve
                      </s-button>
                      <s-button
                        tone="critical"
                        disabled={busy}
                        onClick={() => submit({ intent: "reject", ids: [c.id] })}
                      >
                        Reject
                      </s-button>
                    </s-button-group>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
      {pending.length > 1 && !error && (
        <s-section>
          <s-button
            disabled={busy}
            onClick={() => submit({ intent: "approve", ids: pending.map((c) => c.id) })}
          >
            Approve all {pending.length}
          </s-button>
        </s-section>
      )}

      <s-section heading="Settings">
        <s-stack gap="base">
          <s-switch
            label="Require approval for new customer accounts"
            checked={approval.enabled}
            onChange={(e) => set("enabled", e.currentTarget.checked)}
          />
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <s-text-field
              label="Pending tag"
              value={approval.pendingTag}
              onInput={(e) => set("pendingTag", e.currentTarget.value)}
            />
            <s-text-field
              label="Approved tag"
              value={approval.approvedTag}
              onInput={(e) => set("approvedTag", e.currentTarget.value)}
            />
            <s-text-field
              label="Rejected tag"
              value={approval.rejectedTag}
              onInput={(e) => set("rejectedTag", e.currentTarget.value)}
            />
          </s-grid>
          <s-paragraph color="subdued">
            New sign-ups get the pending tag. To keep pending customers out, lock your store or
            products with the key “Customer has a tag: {approval.approvedTag}”.
          </s-paragraph>
          <s-stack direction="inline">
            <s-button loading={busy} onClick={() => submit({ intent: "settings", approval })}>
              Save settings
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
