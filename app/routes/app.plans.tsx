import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../models/lock.server";
import { billingEnabled, currentPlan, planSelectionUrl } from "../lib/billing.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const url = new URL(request.url);
  // Shopify appends plan_handle when the merchant comes back from the plan selection page.
  const plan = await currentPlan(admin.graphql, session.shop, url.searchParams.has("plan_handle"));
  const fresh = await prisma.shop.findUnique({ where: { id: shop.id } });
  return {
    billing: billingEnabled(),
    current: plan.handle,
    trialEndsAt: fresh?.trialEndsAt?.toISOString() ?? null,
    lockCount: await prisma.lock.count({ where: { shopId: shop.id } }),
    plans: PLANS.map((p) => ({ ...p, maxLocks: Number.isFinite(p.maxLocks) ? p.maxLocks : null })),
    welcome: url.searchParams.has("plan_handle"),
  };
};

// Plan changes happen on Shopify's hosted plan selection page.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  return redirect(planSelectionUrl(session.shop), { target: "_top" });
};

export default function Plans() {
  const { billing, current, trialEndsAt, lockCount, plans, welcome } = useLoaderData<typeof loader>();
  const active = plans.find((p) => p.handle === current)!;
  const trialDays = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : 0;

  return (
    <s-page heading="Plans">
      {welcome && (
        <s-banner tone="success" heading={`You're on ${active.name}`}>
          Thanks! Your plan is active and its features are unlocked.
        </s-banner>
      )}
      {!billing && (
        <s-banner tone="info" heading="Billing isn't configured">
          Every feature is available because this server has no Partner API credentials. Set
          PARTNER_ID and PARTNER_API_TOKEN to turn on plans.
        </s-banner>
      )}

      <s-section heading="Current plan">
        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-heading>{active.name}</s-heading>
            {trialDays > 0 && <s-badge tone="info">Trial: {trialDays} days left</s-badge>}
          </s-stack>
          <s-paragraph>
            {lockCount} lock{lockCount === 1 ? "" : "s"} used
            {active.maxLocks ? ` of ${active.maxLocks}` : ""}.
          </s-paragraph>
          {billing && (
            <Form method="post">
              <s-button type="submit">Change plan</s-button>
            </Form>
          )}
        </s-stack>
      </s-section>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(14rem, 1fr))" gap="base">
        {plans.map((p) => (
          <s-section key={p.handle} heading={p.name}>
            <s-stack gap="base">
              <s-text type="strong">{p.price}</s-text>
              <s-unordered-list>
                {p.highlights.map((h) => (
                  <s-list-item key={h}>{h}</s-list-item>
                ))}
              </s-unordered-list>
              {p.handle === current ? (
                <s-badge tone="success">Current plan</s-badge>
              ) : (
                billing && (
                  <Form method="post">
                    <s-button type="submit" variant={p.handle === "pro" ? "primary" : "secondary"}>
                      {plans.findIndex((x) => x.handle === p.handle) >
                      plans.findIndex((x) => x.handle === current)
                        ? `Upgrade to ${p.name}`
                        : `Switch to ${p.name}`}
                    </s-button>
                  </Form>
                )
              )}
            </s-stack>
          </s-section>
        ))}
      </s-grid>
      <s-section>
        <s-paragraph color="subdued">
          Paid plans include a free trial. Charges appear on your Shopify bill, and you can
          upgrade, downgrade or cancel any time from this page.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
