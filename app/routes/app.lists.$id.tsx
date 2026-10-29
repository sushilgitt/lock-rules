import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { requireFeature } from "../lib/gate.server";
import { UpgradeCard } from "../components/UpgradeCard";
import { ensureShop } from "../models/lock.server";
import {
  deleteInputList,
  getInputList,
  parseEntries,
  saveInputList,
  serializeEntries,
} from "../models/inputList.server";
import { MAX_ENTRIES, type ListEntry, type ListKind } from "../lib/lists";
import { syncShop } from "../lib/compile.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const gate = await requireFeature(admin.graphql, session.shop, "lists");
  if (gate) return { gate } as never;
  const shop = await ensureShop(session.shop);
  if (params.id === "new") {
    return { isNew: true, name: "", kind: "passcode" as ListKind, text: "" };
  }
  const list = await getInputList(shop.id, params.id!);
  if (!list) throw new Response("List not found", { status: 404 });
  return {
    isNew: false,
    name: list.name,
    kind: list.kind as ListKind,
    text: serializeEntries((list.entries ?? []) as ListEntry[]),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (await requireFeature(admin.graphql, session.shop, "lists")) {
    throw new Response("Upgrade required", { status: 402 });
  }
  const shop = await ensureShop(session.shop);
  const body = await request.json();

  if (body.intent === "delete") {
    await deleteInputList(shop.id, params.id!);
    await syncShop(admin.graphql, session.shop);
    return redirect("/app/lists");
  }

  const name = String(body.name ?? "").trim();
  const kind: ListKind = body.kind === "email" ? "email" : "passcode";
  if (!name) return { ok: false as const, errors: ["Give the list a name."] };
  const { entries, invalid, truncated } = parseEntries(kind, String(body.text ?? ""));
  if (!entries.length) return { ok: false as const, errors: ["Add at least one valid entry."] };

  const id = await saveInputList(shop.id, params.id === "new" ? null : params.id!, {
    name,
    kind,
    entries,
  });
  // Email lists are compiled into the storefront config; passcodes stay on the server.
  const sync =
    kind === "email" ? await syncShop(admin.graphql, session.shop) : { syncError: null };

  return {
    ok: true as const,
    id,
    created: params.id === "new",
    count: entries.length,
    skipped: invalid.slice(0, 10),
    skippedCount: invalid.length,
    truncated,
    syncError: sync.syncError,
  };
};

export default function InputListEditor() {
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
  const data = useLoaderData<typeof loader>();
  const [name, setName] = useState(data.name);
  const [kind, setKind] = useState<ListKind>(data.kind);
  const [text, setText] = useState(data.text);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const result = fetcher.data;
  const errors = result && !result.ok ? result.errors : [];

  useEffect(() => {
    if (!result?.ok) return;
    shopify.toast.show(`Saved ${result.count.toLocaleString()} entries`);
    if (result.created) navigate(`/app/lists/${result.id}`, { replace: true });
  }, [result, shopify, navigate]);

  const submit = (body: Record<string, unknown>) =>
    fetcher.submit(body as any, { method: "post", encType: "application/json" });

  const onFiles = async (files: readonly File[] | undefined) => {
    const file = files?.[0];
    if (file) setText(await file.text());
  };

  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;

  return (
    <s-page heading={data.isNew ? "New input list" : data.name} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app/lists">
        Input lists
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={fetcher.state !== "idle"}
        onClick={() => submit({ intent: "save", name, kind, text })}
      >
        Save
      </s-button>
      {!data.isNew && (
        <s-button
          slot="secondary-actions"
          tone="critical"
          onClick={() => {
            if (confirm(`Delete "${data.name}"?`)) submit({ intent: "delete" });
          }}
        >
          Delete
        </s-button>
      )}

      {errors.length > 0 && (
        <s-banner tone="critical" heading="Fix these before saving">
          {errors.join(" ")}
        </s-banner>
      )}
      {result?.ok && result.skippedCount > 0 && (
        <s-banner tone="warning" heading={`Skipped ${result.skippedCount} invalid entries`}>
          {result.skipped.join(", ")}
          {result.skippedCount > result.skipped.length ? ", …" : ""}
        </s-banner>
      )}
      {result?.ok && result.truncated && (
        <s-banner tone="warning">
          Only the first {MAX_ENTRIES.toLocaleString()} entries were kept.
        </s-banner>
      )}
      {result?.ok && result.syncError && (
        <s-banner tone="critical" heading="Saved, but sync had problems">
          {result.syncError}
        </s-banner>
      )}

      <s-section>
        <s-stack gap="base">
          <s-text-field
            label="List name"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <s-select
            label="Type"
            value={kind}
            disabled={!data.isNew}
            onChange={(e) => setKind(e.currentTarget.value as ListKind)}
          >
            <s-option value="passcode">Passcodes</s-option>
            <s-option value="email">Customer emails</s-option>
          </s-select>
          <s-drop-zone
            label="Upload CSV"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={(e) => onFiles(e.currentTarget.files)}
          />
          <s-text-area
            label={`Entries (${lines.toLocaleString()})`}
            rows={12}
            value={text}
            details={
              kind === "passcode"
                ? "One passcode per line. Add a second column to redirect after unlocking: SUMMER24,/collections/summer"
                : "One email per line."
            }
            onInput={(e) => setText(e.currentTarget.value)}
          />
          {kind === "email" && (
            <s-paragraph color="subdued">
              Email lists are checked in your theme, so keep them under a few thousand
              entries. For bigger groups, tag those customers and use “Customer has a tag”.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
