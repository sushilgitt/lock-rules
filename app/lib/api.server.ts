import crypto from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { sha256 } from "./crypto.server";
import { syncShop } from "./compile.server";
import { emptyLock, validateLock, type LockInput } from "./locks";
import type { LockWithKeys } from "../models/lock.server";
import { toLockInput } from "../models/lock.server";

/*
 * Public REST API (/api/v1/*) for managing locks, input lists and reading key
 * usage from merchants' own systems. Authenticated with per-shop API keys
 * created under Developers in the app. Only a SHA-256 hash of each key is kept.
 */

const KEY_PREFIX = "lr_live_";
const RATE_PER_MINUTE = 120;

export function apiError(status: number, error: string, details?: unknown) {
  return Response.json({ error, ...(details ? { details } : {}) }, { status });
}

export async function createApiKey(shopId: string, name: string) {
  const key = KEY_PREFIX + crypto.randomBytes(24).toString("base64url");
  await prisma.apiKey.create({
    data: { shopId, name: name.trim().slice(0, 80) || "API key", prefix: key.slice(0, 14), hash: sha256(key) },
  });
  return key;
}

export async function listApiKeys(shopId: string) {
  const keys = await prisma.apiKey.findMany({ where: { shopId }, orderBy: { createdAt: "desc" } });
  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function revokeApiKey(shopId: string, id: string) {
  await prisma.apiKey.deleteMany({ where: { id, shopId } });
}

const windows = new Map<string, { count: number; resetAt: number }>();

function rateLimited(keyId: string) {
  const now = Date.now();
  const w = windows.get(keyId);
  if (!w || w.resetAt <= now) {
    windows.set(keyId, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  return ++w.count > RATE_PER_MINUTE;
}

/** Resolves the shop for an API request, or throws a JSON error Response. */
export async function authenticateApi(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith(KEY_PREFIX)) throw apiError(401, "Missing or malformed API key. Send Authorization: Bearer lr_live_…");

  const key = await prisma.apiKey.findUnique({ where: { hash: sha256(token) }, include: { shop: true } });
  if (!key || key.shop.uninstalledAt) throw apiError(401, "Invalid API key.");
  if (rateLimited(key.id)) throw apiError(429, `Rate limit is ${RATE_PER_MINUTE} requests per minute.`);

  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 5 * 60_000) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  }
  return key.shop;
}

/** Recompiles and pushes locks after an API write, using the shop's offline session. */
export async function syncFromApi(domain: string) {
  const { admin } = await unauthenticated.admin(domain);
  return syncShop(admin.graphql, domain);
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw apiError(400, "Request body must be JSON.");
  }
}

/** Fills defaults so API clients can send only what they care about, then validates. */
export function normalizeLock(body: unknown, base: LockInput = emptyLock()): LockInput {
  if (!body || typeof body !== "object") throw apiError(400, "Expected a lock object.");
  const b = body as Partial<LockInput>;
  const lock: LockInput = {
    ...base,
    ...b,
    resources: Array.isArray(b.resources) ? b.resources : base.resources,
    storeExceptions: Array.isArray(b.storeExceptions) ? b.storeExceptions : base.storeExceptions,
    keys: Array.isArray(b.keys)
      ? b.keys.map((k) => ({
          conditions: (Array.isArray(k?.conditions) ? k.conditions : []).map((c) => ({
            ...c,
            uid: c.uid ?? "",
            values: Array.isArray(c.values) ? c.values.map(String) : [],
            inverted: Boolean(c.inverted),
          })),
        }))
      : base.keys,
  };
  const errors = validateLock(lock);
  if (errors.length) throw apiError(422, "Invalid lock.", errors);
  return lock;
}

export function serializeLock(lock: LockWithKeys) {
  return {
    id: lock.id,
    ...toLockInput(lock),
    createdAt: lock.createdAt.toISOString(),
    updatedAt: lock.updatedAt.toISOString(),
  };
}
