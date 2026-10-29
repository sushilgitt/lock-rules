import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { requireFeature } from "../lib/gate.server";
import { UpgradeCard } from "../components/UpgradeCard";
import { ensureShop } from "../models/lock.server";
import { listInputLists } from "../models/inputList.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const gate = await requireFeature(admin.graphql, session.shop, "lists");
  if (gate) return { gate } as never;
  const shop = await ensureShop(session.shop);
  return { lists: await listInputLists(shop.id) };
};

export default function InputLists() {
  const gated = useLoaderData() as { gate?: string };
  if (gated?.gate) {
    return (
      <s-page heading="Input lists">
        <UpgradeCard feature="Input lists" plan={gated.gate} />
      </s-page>
    );
  }
  return <Page />;
}

function Page() {
  const { lists } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Input lists">
      <s-button slot="primary-action" variant="primary" href="/app/lists/new">
        Create list
      </s-button>
      {lists.length === 0 ? (
        <s-section>
          <s-stack gap="base" alignItems="center" padding="large">
            <s-heading>Manage passcodes and emails in bulk</s-heading>
            <s-paragraph>
              Upload a CSV of passcodes or customer emails, then use the list in any lock&apos;s
              passcode or email-list condition.
            </s-paragraph>
            <s-button variant="primary" href="/app/lists/new">
              Create list
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Name</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header listSlot="secondary" format="numeric">
                Entries
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {lists.map((list) => (
                <s-table-row key={list.id} clickDelegate={`list-${list.id}`}>
                  <s-table-cell>
                    <s-link id={`list-${list.id}`} href={`/app/lists/${list.id}`}>
                      {list.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{list.kind === "email" ? "Emails" : "Passcodes"}</s-table-cell>
                  <s-table-cell>{list.count.toLocaleString()}</s-table-cell>
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
