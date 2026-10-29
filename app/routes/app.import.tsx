import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { requireFeature } from "../lib/gate.server";
import { UpgradeCard } from "../components/UpgradeCard";
import prisma from "../db.server";
import { ensureShop } from "../models/lock.server";
import { splitList } from "../lib/locks";
import { parseCustomerCsv, resumeStalled, startImport } from "../lib/import.server";
import { MAX_IMPORT_ROWS } from "../lib/lists";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const gate = await requireFeature(admin.graphql, session.shop, "lists");
  if (gate) return { gate } as never;
  const shop = await ensureShop(session.shop);
  await resumeStalled(shop.id);
  const jobs = await prisma.importJob.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, status: true, total: true, processed: true, updated: true, errors: true, createdAt: true },
  });
  return {
    jobs: jobs.map((j) => ({ ...j, errors: (j.errors ?? []) as string[], createdAt: j.createdAt.toISOString() })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (await requireFeature(admin.graphql, session.shop, "lists")) {
    throw new Response("Upgrade required", { status: 402 });
  }
  const shop = await ensureShop(session.shop);
  const body = await request.json();
  const parsed = parseCustomerCsv(String(body.csv ?? ""), splitList(String(body.tags ?? "")));
  if (parsed.error) return { ok: false, message: parsed.error };
  if (!parsed.rows.length) return { ok: false, message: "No valid email addresses found." };
  await startImport(shop.id, parsed.rows);
  return {
    ok: true,
    message: `Importing ${parsed.rows.length} customers${parsed.invalid.length ? `, skipped ${parsed.invalid.length} invalid` : ""}${parsed.truncated ? ` (first ${MAX_IMPORT_ROWS} only)` : ""}.`,
  };
};

export default function Import() {
  const gated = useLoaderData() as { gate?: string };
  if (gated?.gate) {
    return (
      <s-page heading="Import customers">
        <UpgradeCard feature="Customer import" plan={gated.gate} />
      </s-page>
    );
  }
  return <Page />;
}

function Page() {
  const { jobs } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [tags, setTags] = useState("");
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    if (fetcher.data) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    if (fetcher.data?.ok) {
      setCsv("");
      setFileName("");
    }
  }, [fetcher.data, shopify]);

  // Poll while an import is running.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(t);
  }, [active, revalidator]);

  return (
    <s-page heading="Import customers" inlineSize="base">
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Upload a CSV with an <b>email</b> column, plus optional <b>tags</b>, <b>first_name</b> and{" "}
            <b>last_name</b>. New customers are created and existing ones keep their tags, with
            yours added, so “Customer has a tag” keys work for them right away.
          </s-paragraph>
          <s-drop-zone
            label="Customer CSV"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              if (file) {
                setCsv(await file.text());
                setFileName(file.name);
              }
            }}
          />
          {fileName && <s-text>Ready: {fileName}</s-text>}
          <s-text-field
            label="Also add these tags to everyone"
            value={tags}
            placeholder="wholesale"
            onInput={(e) => setTags(e.currentTarget.value)}
          />
          <s-stack direction="inline">
            <s-button
              variant="primary"
              disabled={!csv}
              loading={fetcher.state !== "idle"}
              onClick={() => fetcher.submit({ csv, tags } as any, { method: "post", encType: "application/json" })}
            >
              Import
            </s-button>
          </s-stack>
          <s-paragraph color="subdued">
            Up to {MAX_IMPORT_ROWS.toLocaleString()} customers per file. Creating customers
            needs LockRules&apos; customer data access approval.
          </s-paragraph>
        </s-stack>
      </s-section>

      {jobs.length > 0 && (
        <s-section heading="Recent imports" padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Started</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">Progress</s-table-header>
              <s-table-header listSlot="secondary">Problems</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {jobs.map((j) => (
                <s-table-row key={j.id}>
                  <s-table-cell>{new Date(j.createdAt).toLocaleString()}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={j.status === "done" ? "success" : j.status === "failed" ? "critical" : "info"}>
                      {j.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {j.processed.toLocaleString()} / {j.total.toLocaleString()} ({j.updated.toLocaleString()} imported)
                  </s-table-cell>
                  <s-table-cell>{j.errors.length ? j.errors.slice(0, 3).join("; ") : "—"}</s-table-cell>
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
