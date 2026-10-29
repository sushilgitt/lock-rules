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
import {
  createLock,
  deleteLock,
  ensureShop,
  getLock,
  toLockInput,
  updateLock,
} from "../models/lock.server";
import { syncShop } from "../lib/compile.server";
import {
  CONDITION_TYPES,
  DENIED_ACTIONS,
  RESOURCE_TYPES,
  STORE_EXCEPTIONS,
  conditionNeedsValues,
  emptyLock,
  splitList,
  validateLock,
  type ConditionInput,
  type LockInput,
  type LockResource,
  type ResourceType,
} from "../lib/locks";

type Option = LockResource;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  let lock: LockInput = emptyLock();
  if (params.id !== "new") {
    const existing = await getLock(shop.id, params.id!);
    if (!existing) throw new Response("Lock not found", { status: 404 });
    lock = toLockInput(existing);
  }

  // Pages, blogs and articles have no App Bridge picker, so list them here.
  const res = await admin.graphql(`#graphql
    query LockRulesContent {
      pages(first: 100, sortKey: TITLE) { nodes { id title handle } }
      blogs(first: 50) { nodes { id title handle } }
      articles(first: 100, sortKey: TITLE) { nodes { id title handle } }
    }`);
  const { data } = await res.json();

  return {
    isNew: params.id === "new",
    lock,
    content: {
      page: (data?.pages?.nodes ?? []) as Option[],
      blog: (data?.blogs?.nodes ?? []) as Option[],
      article: (data?.articles?.nodes ?? []) as Option[],
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = await request.json();

  if (body.intent === "delete") {
    await deleteLock(shop.id, params.id!);
    await syncShop(admin.graphql, session.shop);
    return redirect("/app/locks");
  }

  const lock = body.lock as LockInput;
  const errors = validateLock(lock);
  if (errors.length) return { ok: false as const, errors };

  const saved =
    params.id === "new"
      ? await createLock(shop.id, lock)
      : await updateLock(shop.id, params.id!, lock);
  const sync = await syncShop(admin.graphql, session.shop);

  return { ok: true as const, id: saved.id, created: params.id === "new", syncError: sync.syncError };
};

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: ConditionInput;
  onChange: (c: ConditionInput) => void;
  onRemove: () => void;
}) {
  const meta = CONDITION_TYPES.find((c) => c.value === condition.type);
  // Keep the raw text while typing so commas and newlines aren't swallowed.
  const [raw, setRaw] = useState(condition.values.join(", "));

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
          <s-select
            label="Condition"
            value={condition.type}
            onChange={(e) =>
              onChange({ ...condition, type: e.currentTarget.value as ConditionInput["type"] })
            }
          >
            {CONDITION_TYPES.map((c) => (
              <s-option key={c.value} value={c.value}>
                {c.label}
              </s-option>
            ))}
          </s-select>
          <s-button variant="tertiary" icon="delete" accessibilityLabel="Remove condition" onClick={onRemove} />
        </s-grid>
        {conditionNeedsValues(condition.type) && (
          <s-text-area
            label="Values"
            rows={2}
            value={raw}
            details={"help" in meta! ? meta.help : undefined}
            onInput={(e) => {
              setRaw(e.currentTarget.value);
              onChange({ ...condition, values: splitList(e.currentTarget.value) });
            }}
          />
        )}
        <s-checkbox
          label="Invert: pass when this is NOT true"
          checked={condition.inverted}
          onChange={(e) => onChange({ ...condition, inverted: e.currentTarget.checked })}
        />
      </s-stack>
    </s-box>
  );
}

export default function LockEditor() {
  const { isNew, lock: initial, content } = useLoaderData<typeof loader>();
  const [lock, setLock] = useState<LockInput>(initial);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const saving = fetcher.state !== "idle";
  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.errors : [];

  useEffect(() => setLock(initial), [initial]);

  useEffect(() => {
    const data = fetcher.data;
    if (!data?.ok) return;
    if (data.syncError) shopify.toast.show("Saved, but sync had problems. See Home.", { isError: true });
    else shopify.toast.show("Lock saved");
    if (data.created) navigate(`/app/locks/${data.id}`, { replace: true });
  }, [fetcher.data, shopify, navigate]);

  const set = <K extends keyof LockInput>(key: K, value: LockInput[K]) =>
    setLock((l) => ({ ...l, [key]: value }));

  const save = () =>
    fetcher.submit({ intent: "save", lock } as any, { method: "post", encType: "application/json" });

  const remove = () => {
    if (confirm(`Delete "${lock.name || "this lock"}"?`)) {
      fetcher.submit({ intent: "delete" }, { method: "post", encType: "application/json" });
    }
  };

  const pickResources = async () => {
    const type = lock.resourceType as "product" | "collection";
    const selected = await shopify.resourcePicker({
      type,
      multiple: true,
      action: "select",
      selectionIds: lock.resources.map((r) => ({ id: r.id })),
    });
    if (selected) {
      set(
        "resources",
        selected.map((r: any) => ({ id: r.id, handle: r.handle, title: r.title })),
      );
    }
  };

  const updateKey = (k: number, conditions: ConditionInput[]) =>
    set(
      "keys",
      lock.keys.map((key, i) => (i === k ? { conditions } : key)),
    );

  const usesPicker = lock.resourceType === "product" || lock.resourceType === "collection";
  const contentOptions =
    lock.resourceType === "page" || lock.resourceType === "blog" || lock.resourceType === "article"
      ? content[lock.resourceType]
      : [];

  return (
    <s-page heading={isNew ? "New lock" : lock.name || "Edit lock"} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app/locks">
        Locks
      </s-link>
      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving}>
        Save
      </s-button>
      {!isNew && (
        <s-button slot="secondary-actions" tone="critical" onClick={remove}>
          Delete
        </s-button>
      )}

      {errors.length > 0 && (
        <s-banner tone="critical" heading="Fix these before saving">
          <s-unordered-list>
            {errors.map((e) => (
              <s-list-item key={e}>{e}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      <s-section heading="What to lock">
        <s-stack gap="base">
          <s-text-field
            label="Lock name"
            value={lock.name}
            placeholder="Wholesale collection"
            onInput={(e) => set("name", e.currentTarget.value)}
          />
          <s-select
            label="Lock type"
            value={lock.resourceType}
            onChange={(e) =>
              setLock((l) => ({
                ...l,
                resourceType: e.currentTarget.value as ResourceType,
                resources: [],
              }))
            }
          >
            {RESOURCE_TYPES.map((r) => (
              <s-option key={r.value} value={r.value}>
                {r.label}
              </s-option>
            ))}
          </s-select>

          {usesPicker && (
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small-200">
                {lock.resources.map((r) => (
                  <s-chip key={r.id}>{r.title}</s-chip>
                ))}
              </s-stack>
              <s-stack direction="inline">
                <s-button onClick={pickResources}>
                  {lock.resources.length ? "Change selection" : `Select ${lock.resourceType}s`}
                </s-button>
              </s-stack>
              {lock.resourceType === "collection" && (
                <s-paragraph color="subdued">
                  Products in a locked collection are locked too.
                </s-paragraph>
              )}
            </s-stack>
          )}

          {contentOptions.length > 0 && (
            <s-choice-list
              label="Choose items"
              multiple
              values={lock.resources.map((r) => r.id)}
              onChange={(e) => {
                const ids = new Set(e.currentTarget.values);
                set(
                  "resources",
                  contentOptions.filter((o) => ids.has(o.id)),
                );
              }}
            >
              {contentOptions.map((o) => (
                <s-choice key={o.id} value={o.id}>
                  {o.title}
                </s-choice>
              ))}
            </s-choice-list>
          )}
          {!usesPicker && lock.resourceType !== "store" && contentOptions.length === 0 && (
            <s-paragraph color="subdued">Nothing to choose yet. Create some first.</s-paragraph>
          )}

          {lock.resourceType === "store" && (
            <s-choice-list
              label="Leave these open"
              multiple
              values={lock.storeExceptions}
              details="Account, sign-in and password pages always stay open."
              onChange={(e) => set("storeExceptions", [...e.currentTarget.values])}
            >
              {STORE_EXCEPTIONS.map((x) => (
                <s-choice key={x.value} value={x.value}>
                  {x.label}
                </s-choice>
              ))}
            </s-choice-list>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Keys">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Any key opens the lock. All conditions in a key must pass. A lock with no keys
            stays closed for everyone.
          </s-paragraph>
          {lock.keys.map((key, k) => (
            <s-box key={k} padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small-200">
                <s-grid gridTemplateColumns="1fr auto" alignItems="center">
                  <s-heading>{k === 0 ? "Key 1" : `Or key ${k + 1}`}</s-heading>
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    onClick={() => set("keys", lock.keys.filter((_, i) => i !== k))}
                  >
                    Remove key
                  </s-button>
                </s-grid>
                {key.conditions.map((c, i) => (
                  <ConditionRow
                    key={`${k}-${i}-${c.type}`}
                    condition={c}
                    onChange={(next) =>
                      updateKey(
                        k,
                        key.conditions.map((x, j) => (j === i ? next : x)),
                      )
                    }
                    onRemove={() =>
                      updateKey(
                        k,
                        key.conditions.filter((_, j) => j !== i),
                      )
                    }
                  />
                ))}
                <s-stack direction="inline">
                  <s-button
                    variant="tertiary"
                    icon="plus"
                    onClick={() =>
                      updateKey(k, [
                        ...key.conditions,
                        { type: "tag", values: [], inverted: false },
                      ])
                    }
                  >
                    And condition
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>
          ))}
          <s-stack direction="inline">
            <s-button
              icon="plus"
              onClick={() =>
                set("keys", [
                  ...lock.keys,
                  { conditions: [{ type: "signed_in", values: [], inverted: false }] },
                ])
              }
            >
              Add key
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Status">
        <s-switch
          label="Lock is active"
          checked={lock.enabled}
          onChange={(e) => set("enabled", e.currentTarget.checked)}
        />
      </s-section>

      <s-section slot="aside" heading="When access is denied">
        <s-stack gap="base">
          <s-select
            label="Action"
            value={lock.deniedAction}
            onChange={(e) => set("deniedAction", e.currentTarget.value as LockInput["deniedAction"])}
          >
            {DENIED_ACTIONS.map((a) => (
              <s-option key={a.value} value={a.value}>
                {a.label}
              </s-option>
            ))}
          </s-select>
          {lock.deniedAction === "redirect" ? (
            <s-url-field
              label="Redirect to"
              value={lock.redirectUrl}
              placeholder="/pages/wholesale-application"
              onInput={(e) => set("redirectUrl", e.currentTarget.value)}
            />
          ) : (
            <s-text-area
              label="Message"
              rows={3}
              value={lock.deniedMessage}
              details="Leave empty to use the default from Settings."
              onInput={(e) => set("deniedMessage", e.currentTarget.value)}
            />
          )}
        </s-stack>
      </s-section>

      {lock.resourceType !== "store" && (
        <s-section slot="aside" heading="Visibility">
          <s-stack gap="small-200">
            <s-checkbox
              label="Hide from collections and search"
              checked={lock.hideFromLists}
              onChange={(e) => set("hideFromLists", e.currentTarget.checked)}
            />
            <s-checkbox
              label="Hide navigation links"
              checked={lock.hideNavLinks}
              onChange={(e) => set("hideNavLinks", e.currentTarget.checked)}
            />
            <s-paragraph color="subdued">
              Hidden for visitors who don't have a key.
            </s-paragraph>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
