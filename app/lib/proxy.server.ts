import prisma from "../db.server";
import { readParams } from "../models/lock.server";
import { parsePasscode } from "./locks";
import { signToken } from "./tokens.server";

/*
 * Shared helpers for the app proxy routes (app/routes/proxy.*). Shopify
 * forwards https://{shop}/apps/lockrules/* to https://{app}/proxy/* with a
 * signed query string, which authenticate.public.appProxy verifies.
 */

export async function shopForProxy(domain: string | null) {
  if (!domain) return null;
  const shop = await prisma.shop.findUnique({ where: { domain } });
  return shop?.hmacSecret && !shop.uninstalledAt ? shop : null;
}

export async function findCondition(shopId: string, where: { uid?: string; code?: string }) {
  const path = where.uid ? ["uid"] : ["code"];
  const value = where.uid ?? where.code;
  if (!value) return null;
  const condition = await prisma.condition.findFirst({
    where: {
      params: { path, equals: value },
      key: { lock: { shopId, enabled: true } },
    },
    include: { key: { select: { lockId: true } } },
  });
  if (!condition) return null;
  return { ...condition, lockId: condition.key.lockId, p: readParams(condition.params) };
}

/** Matches an entered passcode against the condition's values and input list. Returns the redirect if any. */
export async function matchPasscode(
  shopId: string,
  condition: NonNullable<Awaited<ReturnType<typeof findCondition>>>,
  entered: string,
) {
  const needle = entered.trim().toLowerCase();
  if (!needle) return null;
  const candidates = condition.p.values.map(parsePasscode);
  if (condition.p.listId) {
    const list = await prisma.inputList.findFirst({
      where: { id: condition.p.listId, shopId, kind: "passcode" },
    });
    for (const e of (list?.entries ?? []) as { v: string; r?: string }[]) {
      candidates.push({ code: e.v, redirect: e.r });
    }
  }
  const hit = candidates.find((c) => c.code.toLowerCase() === needle);
  return hit ? { redirect: hit.redirect ?? null } : null;
}

export async function recordUnlock(args: {
  shopId: string;
  lockId: string;
  conditionUid: string;
  kind: string;
  value?: string | null;
  customerId?: string | null;
}) {
  await prisma.keyUsage.create({
    data: {
      shopId: args.shopId,
      lockId: args.lockId,
      conditionId: args.conditionUid,
      kind: args.kind,
      value: args.value ?? null,
      customerId: args.customerId || null,
    },
  });
}

export function issueToken(secret: string, uid: string, minutes?: number) {
  return signToken(secret, uid, minutes);
}

// --- rate limiting (single instance, in memory) ---------------------------

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10;

export function isRateLimited(key: string) {
  const entry = attempts.get(key);
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES);
}

export function recordFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
  }
}

// --- client IP + CIDR matching ---------------------------------------------

/** Shopify puts the shopper's IP first in X-Forwarded-For; proxies after it append their own. */
export function clientIp(request: Request) {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  return xff.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
}

function ipToBigInt(ip: string): { v: bigint; bits: number } | null {
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { v: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n), bits: 32 };
  }
  if (!ip.includes(":")) return null;
  const [head, tail] = ip.split("::");
  if (ip.split("::").length > 2) return null;
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { v: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n), bits: 128 };
}

export function ipMatches(ip: string, rule: string) {
  const [base, prefix] = rule.trim().split("/");
  const a = ipToBigInt(ip);
  const b = ipToBigInt(base);
  if (!a || !b || a.bits !== b.bits) return false;
  const len = prefix === undefined ? a.bits : Number(prefix);
  if (!(len >= 0 && len <= a.bits)) return false;
  const shift = BigInt(a.bits - len);
  return a.v >> shift === b.v >> shift;
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
