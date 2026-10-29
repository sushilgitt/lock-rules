import crypto from "node:crypto";
import prisma from "../db.server";
import { decrypt, encrypt } from "./crypto.server";

/*
 * Klaviyo and Mailchimp clients for the "subscribes to a newsletter" and
 * "is on a Klaviyo list or segment" keys. Credentials are stored encrypted.
 */

export type Provider = "klaviyo" | "mailchimp";
export type Audience = { id: string; name: string; kind: "list" | "segment" };

const KLAVIYO = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2026-10-15";
const TIMEOUT_MS = 8000;

export class IntegrationError extends Error {}

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new IntegrationError(`${res.status} ${text.slice(0, 300)}`);
  }
  return res.status === 202 || res.status === 204 ? null : res.json();
}

// --- Klaviyo ----------------------------------------------------------------

const klaviyoHeaders = (apiKey: string) => ({
  Authorization: `Klaviyo-API-Key ${apiKey}`,
  revision: KLAVIYO_REVISION,
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
});

async function klaviyoAudiences(apiKey: string): Promise<Audience[]> {
  const out: Audience[] = [];
  for (const kind of ["list", "segment"] as const) {
    let url: string | null = `${KLAVIYO}/${kind}s?fields[${kind}]=name`;
    while (url && out.length < 500) {
      const page: any = await call(url, { headers: klaviyoHeaders(apiKey) });
      for (const d of page.data ?? []) out.push({ id: d.id, name: d.attributes?.name ?? d.id, kind });
      url = page.links?.next ?? null;
    }
  }
  return out;
}

async function klaviyoSubscribe(apiKey: string, listId: string, email: string) {
  await call(`${KLAVIYO}/profile-subscription-bulk-create-jobs`, {
    method: "POST",
    headers: klaviyoHeaders(apiKey),
    body: JSON.stringify({
      data: {
        type: "profile-subscription-bulk-create-job",
        attributes: {
          custom_source: "LockRules",
          profiles: {
            data: [
              {
                type: "profile",
                attributes: { email, subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } } },
              },
            ],
          },
        },
        relationships: { list: { data: { type: "list", id: listId } } },
      },
    }),
  });
}

async function klaviyoIsMember(apiKey: string, audience: { id: string; kind: "list" | "segment" }, email: string) {
  // Matches Klaviyo's documented form: equals(email,['person@example.com'])
  const filter = encodeURIComponent(`equals(email,['${email.replace(/['"\\]/g, "")}'])`);
  const page: any = await call(`${KLAVIYO}/${audience.kind}s/${encodeURIComponent(audience.id)}/profiles?filter=${filter}`, {
    headers: klaviyoHeaders(apiKey),
  });
  return Array.isArray(page.data) && page.data.length > 0;
}

// --- Mailchimp ----------------------------------------------------------------

function mailchimpBase(apiKey: string) {
  const dc = apiKey.split("-").pop();
  if (!dc || !/^[a-z]+\d+$/.test(dc)) throw new IntegrationError("Mailchimp API keys end with a data center, like -us21.");
  return `https://${dc}.api.mailchimp.com/3.0`;
}

const mailchimpHeaders = (apiKey: string) => ({
  Authorization: `Basic ${Buffer.from(`lockrules:${apiKey}`).toString("base64")}`,
  "Content-Type": "application/json",
});

async function mailchimpAudiences(apiKey: string): Promise<Audience[]> {
  const data: any = await call(`${mailchimpBase(apiKey)}/lists?count=100&fields=lists.id,lists.name`, {
    headers: mailchimpHeaders(apiKey),
  });
  return (data.lists ?? []).map((l: any) => ({ id: l.id, name: l.name, kind: "list" as const }));
}

async function mailchimpSubscribe(apiKey: string, listId: string, email: string, doubleOptIn: boolean) {
  const hash = crypto.createHash("md5").update(email.toLowerCase()).digest("hex");
  await call(`${mailchimpBase(apiKey)}/lists/${encodeURIComponent(listId)}/members/${hash}`, {
    method: "PUT",
    headers: mailchimpHeaders(apiKey),
    body: JSON.stringify({ email_address: email, status_if_new: doubleOptIn ? "pending" : "subscribed" }),
  });
}

// --- storage + dispatch ---------------------------------------------------------

export async function getIntegration(shopId: string, provider: Provider) {
  const row = await prisma.integration.findUnique({ where: { shopId_provider: { shopId, provider } } });
  if (!row) return null;
  const { apiKey } = JSON.parse(decrypt(row.credentials)) as { apiKey: string };
  return { apiKey, settings: (row.settings ?? {}) as { doubleOptIn?: boolean } };
}

export async function listIntegrations(shopId: string) {
  const rows = await prisma.integration.findMany({ where: { shopId } });
  return rows.map((r) => ({
    provider: r.provider as Provider,
    settings: (r.settings ?? {}) as { doubleOptIn?: boolean },
    connectedAt: r.createdAt.toISOString(),
  }));
}

/** Verifies the key by listing audiences, then stores it. */
export async function connect(shopId: string, provider: Provider, apiKey: string, settings: Record<string, unknown>) {
  const audiences = await audiencesFor(provider, apiKey.trim());
  const credentials = encrypt(JSON.stringify({ apiKey: apiKey.trim() }));
  await prisma.integration.upsert({
    where: { shopId_provider: { shopId, provider } },
    update: { credentials, settings: settings as any },
    create: { shopId, provider, credentials, settings: settings as any },
  });
  return audiences;
}

export async function disconnect(shopId: string, provider: Provider) {
  await prisma.integration.deleteMany({ where: { shopId, provider } });
}

function audiencesFor(provider: Provider, apiKey: string) {
  return provider === "klaviyo" ? klaviyoAudiences(apiKey) : mailchimpAudiences(apiKey);
}

/** Every audience across connected providers, for the lock editor. Failures yield an empty list. */
export async function allAudiences(shopId: string) {
  const out: Record<Provider, Audience[]> = { klaviyo: [], mailchimp: [] };
  for (const provider of ["klaviyo", "mailchimp"] as const) {
    const integration = await getIntegration(shopId, provider).catch(() => null);
    if (!integration) continue;
    out[provider] = await audiencesFor(provider, integration.apiKey).catch(() => []);
  }
  return out;
}

export async function subscribe(shopId: string, provider: Provider, listId: string, email: string) {
  const integration = await getIntegration(shopId, provider);
  if (!integration) throw new IntegrationError(`${provider} isn't connected.`);
  if (provider === "klaviyo") return klaviyoSubscribe(integration.apiKey, listId, email);
  return mailchimpSubscribe(integration.apiKey, listId, email, Boolean(integration.settings.doubleOptIn));
}

export async function isKlaviyoMember(shopId: string, audience: { id: string; kind: "list" | "segment" }, email: string) {
  const integration = await getIntegration(shopId, "klaviyo");
  if (!integration) throw new IntegrationError("Klaviyo isn't connected.");
  return klaviyoIsMember(integration.apiKey, audience, email);
}
