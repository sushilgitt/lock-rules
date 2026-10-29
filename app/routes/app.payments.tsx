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
import { requireFeature } from "../lib/gate.server";
import { UpgradeCard } from "../components/UpgradeCard";
import { ensureShop } from "../models/lock.server";
import { getSettings, type PaymentRule } from "../lib/settings";
import { splitList } from "../lib/locks";
import { updateSettings } from "../lib/customers.server";
import { syncShop } from "../lib/compile.server";

type Draft = { methods: string; when: PaymentRule["when"]; tags: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const gate = await requireFeature(admin.graphql, session.shop, "payments");
  if (gate) return { gate } as never;
  const shop = await ensureShop(session.shop);
  return { rules: getSettings(shop.settings).paymentRules };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (await requireFeature(admin.graphql, session.shop, "payments")) {
    throw new Response("Upgrade required", { status: 402 });
  }
  const body = (await request.json()) as { rules: PaymentRule[] };
  const { paymentRules } = await updateSettings(session.shop, { paymentRules: body.rules });
  const sync = await syncShop(admin.graphql, session.shop);
  return { ok: sync.ok, count: paymentRules.length, syncError: sync.syncError };
};

const toDraft = (r: PaymentRule): Draft => ({
  methods: r.methods.join(", "),
  when: r.when,
  tags: r.tags.join(", "),
});

export default function PaymentRules() {
  const gated = useLoaderData() as { gate?: string };
  if (gated?.gate) {
    return (
      <s-page heading="Payment rules">
        <UpgradeCard feature="Payment rules" plan={gated.gate} />
      </s-page>
    );
  }
  return <Page />;
}

function Page() {
  const { rules } = useLoaderData<typeof loader>();
  const [drafts, setDrafts] = useState<Draft[]>(rules.map(toDraft));
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(`Saved ${fetcher.data.count} payment rules`);
    else shopify.toast.show("Saved, but sync had problems. See Home.", { isError: true });
  }, [fetcher.data, shopify]);

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = () =>
    fetcher.submit(
      {
        rules: drafts.map((d) => ({
          methods: splitList(d.methods),
          when: d.when,
          tags: splitList(d.tags),
        })),
      } as any,
      { method: "post", encType: "application/json" },
    );

  return (
    <s-page heading="Payment rules" inlineSize="base">
      <s-button slot="primary-action" variant="primary" loading={fetcher.state !== "idle"} onClick={save}>
        Save
      </s-button>

      <s-section>
        <s-paragraph>
          Hide payment methods at checkout based on customer tags. For example, show
          “Invoice (Net 30)” only to customers tagged “wholesale”.
        </s-paragraph>
      </s-section>

      {drafts.map((d, i) => (
        <s-section key={i} heading={`Rule ${i + 1}`}>
          <s-stack gap="base">
            <s-text-field
              label="Payment methods"
              value={d.methods}
              placeholder="Invoice, Cash on Delivery"
              details="Comma-separated. Matches any payment method whose name contains one of these."
              onInput={(e) => update(i, { methods: e.currentTarget.value })}
            />
            <s-select
              label="Hide them when"
              value={d.when}
              onChange={(e) => update(i, { when: e.currentTarget.value as PaymentRule["when"] })}
            >
              <s-option value="missing_tag">the customer has none of these tags</s-option>
              <s-option value="has_tag">the customer has any of these tags</s-option>
            </s-select>
            <s-text-field
              label="Customer tags"
              value={d.tags}
              placeholder="wholesale"
              onInput={(e) => update(i, { tags: e.currentTarget.value })}
            />
            <s-stack direction="inline">
              <s-button
                tone="critical"
                variant="tertiary"
                onClick={() => setDrafts((all) => all.filter((_, j) => j !== i))}
              >
                Remove rule
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ))}

      <s-section>
        <s-button
          icon="plus"
          onClick={() => setDrafts((d) => [...d, { methods: "", when: "missing_tag", tags: "" }])}
        >
          Add rule
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
