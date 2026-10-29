import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop, listLocks } from "../models/lock.server";
import { RESOURCE_TYPES, type LockResource } from "../lib/locks";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const locks = await listLocks(shop.id);

  return {
    locks: locks.map((lock) => {
      const resources = (lock.resources ?? []) as unknown as LockResource[];
      return {
        id: lock.id,
        name: lock.name,
        enabled: lock.enabled,
        type: RESOURCE_TYPES.find((r) => r.value === lock.resourceType)?.label ?? lock.resourceType,
        target:
          lock.resourceType === "store"
            ? "Entire store"
            : resources.length === 1
              ? resources[0].title
              : `${resources.length} items`,
        keys: lock.keys.length,
      };
    }),
  };
};

export default function Locks() {
  const { locks } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Locks">
      <s-button slot="primary-action" variant="primary" href="/app/locks/new">
        Create lock
      </s-button>

      {locks.length === 0 ? (
        <s-section>
          <s-stack gap="base" alignItems="center" padding="large">
            <s-heading>Lock your first product, collection or page</s-heading>
            <s-paragraph>
              Decide who can see it: signed-in customers, customers with a tag, or a list of
              emails.
            </s-paragraph>
            <s-button variant="primary" href="/app/locks/new">
              Create lock
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Name</s-table-header>
              <s-table-header>Locks</s-table-header>
              <s-table-header>Keys</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {locks.map((lock) => (
                <s-table-row key={lock.id} clickDelegate={`lock-${lock.id}`}>
                  <s-table-cell>
                    <s-link id={`lock-${lock.id}`} href={`/app/locks/${lock.id}`}>
                      {lock.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    {lock.type}: {lock.target}
                  </s-table-cell>
                  <s-table-cell>{lock.keys === 0 ? "No keys (nobody)" : lock.keys}</s-table-cell>
                  <s-table-cell>
                    {lock.enabled ? (
                      <s-badge tone="success">Active</s-badge>
                    ) : (
                      <s-badge>Off</s-badge>
                    )}
                  </s-table-cell>
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
