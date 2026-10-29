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
import { listInputLists } from "../models/inputList.server";
import {
  CONDITION_TYPES,
  DENIED_ACTIONS,
  NAMED_RESOURCE_TYPES,
  PROTECT_MODES,
  RESOURCE_TYPES,
  WEEKDAYS,
  STORE_EXCEPTIONS,
  conditionMeta,
  conditionNeedsValues,
  emptyLock,
  newCondition,
  newUid,
  splitList,
  validateLock,
  type ConditionInput,
  type ConditionType,
  type LockInput,
  type LockResource,
  type ProtectMode,
  type ResourceType,
} from "../lib/locks";

const CONDITION_GROUPS = [...new Set(CONDITION_TYPES.map((c) => c.group))];

type InputListOption = { id: string; name: string; kind: string; count: number };

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
      shop { primaryDomain { url } }
      pages(first: 100, sortKey: TITLE) { nodes { id title handle } }
      blogs(first: 50) { nodes { id title handle } }
      articles(first: 100, sortKey: TITLE) { nodes { id title handle } }
    }`);
  const { data } = await res.json();

  return {
    isNew: params.id === "new",
    lockId: params.id === "new" ? null : params.id!,
    lock,
    storeUrl: (data?.shop?.primaryDomain?.url as string | undefined) ?? `https://${session.shop}`,
    inputLists: (await listInputLists(shop.id)) as InputListOption[],
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
  inputLists,
  storeUrl,
  onChange,
  onRemove,
}: {
  condition: ConditionInput;
  inputLists: InputListOption[];
  storeUrl: string;
  onChange: (c: ConditionInput) => void;
  onRemove: () => void;
}) {
  const meta = conditionMeta(condition.type);
  const shopify = useAppBridge();
  // Keep the raw text while typing so commas and newlines aren't swallowed.
  const [raw, setRaw] = useState(condition.values.join(", "));
  const lists = meta?.lists ? inputLists.filter((l) => l.kind === meta.lists) : [];
  const secretUrl = condition.code ? `${storeUrl.replace(/\/$/, "")}/apps/lockrules/s/${condition.code}` : "";

  const changeType = (type: ConditionType) => {
    const fresh = newCondition(type);
    // Keep the uid so existing unlock tokens survive a type change back and forth.
    onChange({ ...fresh, uid: condition.uid, inverted: condition.inverted });
    setRaw("");
  };

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
          <s-select
            label="Condition"
            value={condition.type}
            onChange={(e) => changeType(e.currentTarget.value as ConditionType)}
          >
            {CONDITION_GROUPS.map((group) => (
              <s-option-group key={group} label={group}>
                {CONDITION_TYPES.filter((c) => c.group === group).map((c) => (
                  <s-option key={c.value} value={c.value}>
                    {c.label}
                  </s-option>
                ))}
              </s-option-group>
            ))}
          </s-select>
          <s-button
            variant="tertiary"
            icon="delete"
            accessibilityLabel="Remove condition"
            onClick={onRemove}
          />
        </s-grid>

        {conditionNeedsValues(condition.type) && (
          <s-text-area
            label="Values"
            rows={2}
            value={raw}
            details={meta?.help}
            onInput={(e) => {
              setRaw(e.currentTarget.value);
              onChange({ ...condition, values: splitList(e.currentTarget.value) });
            }}
          />
        )}
        {!conditionNeedsValues(condition.type) && meta?.help && (
          <s-paragraph color="subdued">{meta.help}</s-paragraph>
        )}

        {(meta?.input === "products" || meta?.input === "variants") && (
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200">
              {(condition.titles ?? condition.values).map((t, i) => (
                <s-chip key={condition.values[i] ?? t}>{t}</s-chip>
              ))}
            </s-stack>
            <s-stack direction="inline">
              <s-button
                onClick={async () => {
                  const selected = await shopify.resourcePicker({
                    type: meta.input === "variants" ? "variant" : "product",
                    multiple: true,
                    action: "select",
                    selectionIds: condition.values.map((id) => ({ id })),
                  });
                  if (selected) {
                    onChange({
                      ...condition,
                      values: selected.map((r: any) => r.id),
                      titles: selected.map((r: any) =>
                        r.product?.title ? `${r.product.title} - ${r.title}` : r.title,
                      ),
                    });
                  }
                }}
              >
                {condition.values.length ? "Change selection" : meta.input === "variants" ? "Select variants" : "Select products"}
              </s-button>
            </s-stack>
          </s-stack>
        )}

        {(meta?.input === "amount" || meta?.input === "number") && (
          <s-number-field
            label={meta.input === "amount" ? "Amount" : "Orders"}
            min={0}
            step={meta.input === "amount" ? 0.01 : 1}
            value={String(condition.amount ?? 0)}
            onInput={(e) =>
              onChange({ ...condition, amount: Math.max(0, Number(e.currentTarget.value) || 0) })
            }
          />
        )}

        {meta?.input === "datetime" && (
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-date-field
              label="Date"
              value={(condition.at ?? "").slice(0, 10)}
              onChange={(e) =>
                onChange({
                  ...condition,
                  at: `${e.currentTarget.value}T${(condition.at ?? "").slice(11, 16) || "00:00"}`,
                })
              }
            />
            <s-text-field
              label="Time (24h)"
              placeholder="09:00"
              value={(condition.at ?? "").slice(11, 16)}
              onInput={(e) =>
                onChange({
                  ...condition,
                  at: `${(condition.at ?? "").slice(0, 10)}T${e.currentTarget.value}`,
                })
              }
            />
          </s-grid>
        )}

        {meta?.input === "schedule" && (
          <s-stack gap="small-200">
            <s-choice-list
              label="Days"
              multiple
              values={(condition.days ?? []).map(String)}
              onChange={(e) =>
                onChange({ ...condition, days: [...e.currentTarget.values].map(Number).sort() })
              }
            >
              {WEEKDAYS.map((d) => (
                <s-choice key={d.value} value={String(d.value)}>
                  {d.label}
                </s-choice>
              ))}
            </s-choice-list>
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-text-field
                label="From (24h)"
                placeholder="09:00"
                value={condition.from ?? ""}
                onInput={(e) => onChange({ ...condition, from: e.currentTarget.value })}
              />
              <s-text-field
                label="Until (24h)"
                placeholder="17:00"
                value={condition.to ?? ""}
                onInput={(e) => onChange({ ...condition, to: e.currentTarget.value })}
              />
            </s-grid>
          </s-stack>
        )}

        {meta?.input === "liquid" && (
          <s-text-area
            label="Liquid"
            rows={4}
            value={condition.liquid ?? ""}
            placeholder="{% if customer.accepts_marketing %}true{% endif %}"
            details="Output true when the condition passes. Runs only in secure mode."
            onInput={(e) => onChange({ ...condition, liquid: e.currentTarget.value })}
          />
        )}

        {meta?.lists && (
          <s-select
            label={meta.lists === "email" ? "Also use email list" : "Also use passcode list"}
            value={condition.listId ?? ""}
            onChange={(e) => onChange({ ...condition, listId: e.currentTarget.value || undefined })}
          >
            <s-option value="">None</s-option>
            {lists.map((l) => (
              <s-option key={l.id} value={l.id}>
                {l.name} ({l.count.toLocaleString()})
              </s-option>
            ))}
          </s-select>
        )}

        {condition.type === "confirm" && (
          <s-text-area
            label="Prompt"
            rows={2}
            value={condition.prompt ?? ""}
            placeholder="You must be 21 or older to view this page."
            onInput={(e) => onChange({ ...condition, prompt: e.currentTarget.value })}
          />
        )}

        {condition.type === "secret_link" && (
          <s-stack gap="small-200">
            <s-text-field label="Secret link" value={secretUrl} readOnly />
            <s-paragraph color="subdued">
              Add ?to=/products/handle to send visitors somewhere after unlocking. Save the
              lock before sharing the link.
            </s-paragraph>
            <s-stack direction="inline" gap="small-200">
              <s-button onClick={() => navigator.clipboard?.writeText(secretUrl)}>Copy link</s-button>
              <s-button
                variant="tertiary"
                onClick={() => onChange({ ...condition, code: newUid() })}
              >
                Generate new link
              </s-button>
            </s-stack>
          </s-stack>
        )}

        {meta?.remote && (
          <s-number-field
            label="Access lasts (minutes)"
            min={0}
            step={1}
            inputMode="numeric"
            value={String(condition.minutes ?? 0)}
            details={condition.type === "ip" ? "0 = 24 hours" : "0 = 30 days"}
            onInput={(e) =>
              onChange({ ...condition, minutes: Math.max(0, Number(e.currentTarget.value) || 0) })
            }
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
  const { isNew, lockId, lock: initial, content, inputLists, storeUrl } =
    useLoaderData<typeof loader>();
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
    const type = lock.resourceType as "product" | "collection" | "variant";
    const selected = await shopify.resourcePicker({
      type,
      multiple: true,
      action: "select",
      selectionIds: lock.resources.map((r) => ({ id: r.id })),
    });
    if (selected) {
      set(
        "resources",
        selected.map((r: any) => ({
          id: r.id,
          handle: r.handle ?? r.product?.handle ?? "",
          title: r.product?.title ? `${r.product.title} - ${r.title}` : r.title,
        })),
      );
    }
  };

  // Vendor and product tag locks name their targets instead of picking them.
  const [namedRaw, setNamedRaw] = useState(initial.resources.map((r) => r.title).join(", "));
  const setNamed = (raw: string) => {
    setNamedRaw(raw);
    set(
      "resources",
      splitList(raw).map((name) => ({ id: name.toLowerCase(), handle: "", title: name })),
    );
  };

  const updateKey = (k: number, conditions: ConditionInput[]) =>
    set(
      "keys",
      lock.keys.map((key, i) => (i === k ? { conditions } : key)),
    );

  const usesPicker = ["product", "collection", "variant"].includes(lock.resourceType);
  const named = NAMED_RESOURCE_TYPES.includes(lock.resourceType);
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
            onChange={(e) => {
              setNamedRaw("");
              setLock((l) => ({
                ...l,
                resourceType: e.currentTarget.value as ResourceType,
                resources: [],
              }));
            }}
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
              {lock.resourceType === "variant" && (
                <s-paragraph color="subdued">
                  Locked variants disappear from the variant picker and can&apos;t be bought.
                  Lock a wholesale variant for retail shoppers (and the retail variant for
                  wholesale, with an inverted key) to run price tiers.
                </s-paragraph>
              )}
            </s-stack>
          )}

          {lock.resourceType === "liquid" && (
            <s-stack gap="small-200">
              <s-text-area
                label="Lock pages where this Liquid outputs true"
                rows={5}
                value={lock.liquidCode}
                placeholder="{% if template.suffix == 'members' %}true{% endif %}"
                onInput={(e) => set("liquidCode", e.currentTarget.value)}
              />
              <s-paragraph color="subdued">
                For anything the other lock types don&apos;t cover, such as alternate templates or
                product types. Liquid locks only work with secure mode on.
              </s-paragraph>
            </s-stack>
          )}

          {named && (
            <s-text-area
              label={lock.resourceType === "vendor" ? "Vendors" : "Product tags"}
              rows={2}
              value={namedRaw}
              details="Comma-separated. Matches products with any of these, including products added later."
              onInput={(e) => setNamed(e.currentTarget.value)}
            />
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
          {!usesPicker && !named && !["store", "liquid"].includes(lock.resourceType) && contentOptions.length === 0 && (
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
                    key={`${c.uid}-${c.type}`}
                    condition={c}
                    inputLists={inputLists}
                    storeUrl={storeUrl}
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
                      updateKey(k, [...key.conditions, newCondition("tag")])
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
                set("keys", [...lock.keys, { conditions: [newCondition("signed_in")] }])
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

      {lock.resourceType !== "variant" && (
        <s-section slot="aside" heading="Protect">
          <s-stack gap="small-200">
            <s-select
              label="For visitors without a key"
              value={lock.protect}
              onChange={(e) => set("protect", e.currentTarget.value as ProtectMode)}
            >
              {PROTECT_MODES.map((m) => (
                <s-option key={m.value} value={m.value}>
                  {m.label}
                </s-option>
              ))}
            </s-select>
            {lock.protect === "manual" && (
              <s-stack gap="small-200">
                <s-paragraph color="subdued">
                  Add the Protected price, Protected add to cart or Protected content blocks
                  in your theme editor. For Protected content, use this lock ID:
                </s-paragraph>
                <s-text-field label="Lock ID" value={lockId ?? "Save the lock first"} readOnly />
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}

      {!["store", "variant", "vendor", "product_tag", "liquid"].includes(lock.resourceType) && (
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
            {["product", "collection", "page", "article"].includes(lock.resourceType) && (
              <s-checkbox
                label="Hide from search engines"
                details="Adds noindex and removes the pages from your sitemap and store search."
                checked={lock.seoHidden}
                onChange={(e) => set("seoHidden", e.currentTarget.checked)}
              />
            )}
            <s-paragraph color="subdued">
              Hidden for visitors who don&apos;t have a key.
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
