import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import {
  newUid,
  type ConditionInput,
  type DeniedAction,
  type LockInput,
  type ProtectMode,
  type LockResource,
  type ResourceType,
} from "../lib/locks";

export type ConditionParams = Omit<ConditionInput, "type" | "inverted">;

/** Params as stored, filling in ids for rows saved before they existed. */
export function readParams(raw: unknown): ConditionParams {
  const p = (raw ?? {}) as Partial<ConditionParams>;
  return {
    uid: p.uid || newUid(),
    values: (p.values ?? []).map(String),
    ...(p.listId ? { listId: p.listId } : {}),
    ...(p.minutes ? { minutes: Number(p.minutes) } : {}),
    ...(p.prompt ? { prompt: p.prompt } : {}),
    ...(p.code ? { code: p.code } : {}),
    ...(p.titles?.length ? { titles: p.titles.map(String) } : {}),
    ...(p.amount !== undefined && p.amount !== null ? { amount: Number(p.amount) } : {}),
    ...(p.at ? { at: String(p.at) } : {}),
    ...(p.days?.length ? { days: p.days.map(Number).filter((d) => d >= 1 && d <= 7) } : {}),
    ...(p.from ? { from: String(p.from) } : {}),
    ...(p.to ? { to: String(p.to) } : {}),
    ...(p.liquid ? { liquid: String(p.liquid) } : {}),
    ...(p.provider === "klaviyo" || p.provider === "mailchimp" ? { provider: p.provider } : {}),
    ...(p.audience ? { audience: String(p.audience) } : {}),
    ...(p.audienceKind === "segment" || p.audienceKind === "list" ? { audienceKind: p.audienceKind } : {}),
  };
}

const lockInclude = {
  keys: {
    orderBy: { position: "asc" },
    include: { conditions: { orderBy: { position: "asc" } } },
  },
} satisfies Prisma.LockInclude;

export type LockWithKeys = Prisma.LockGetPayload<{ include: typeof lockInclude }>;

export async function ensureShop(domain: string) {
  return prisma.shop.upsert({
    where: { domain },
    update: { uninstalledAt: null },
    create: { domain },
  });
}

export async function listLocks(shopId: string) {
  return prisma.lock.findMany({
    where: { shopId },
    orderBy: { createdAt: "asc" },
    include: lockInclude,
  });
}

export async function getLock(shopId: string, id: string) {
  return prisma.lock.findFirst({ where: { id, shopId }, include: lockInclude });
}

function keysCreate(input: LockInput) {
  const seen = new Set<string>();
  return {
    create: input.keys.map((key, k) => ({
      position: k,
      conditions: {
        create: key.conditions.map((c, i) => {
          // Copy-pasted conditions must not share a uid, or one token would open both.
          let uid = c.uid || newUid();
          if (seen.has(uid)) uid = newUid();
          seen.add(uid);
          const params = readParams({
            uid,
            values: c.values,
            listId: c.listId,
            minutes: c.minutes,
            prompt: c.prompt?.trim(),
            code: c.type === "secret_link" ? c.code || newUid() : undefined,
            titles: c.titles,
            amount: c.amount,
            at: c.at,
            days: c.days,
            from: c.from,
            to: c.to,
            liquid: c.type === "liquid" ? c.liquid : undefined,
            provider: c.type === "klaviyo_member" ? "klaviyo" : c.provider,
            audience: c.audience,
            audienceKind: c.audienceKind,
          });
          return {
            position: i,
            type: c.type,
            params: params as unknown as Prisma.InputJsonValue,
            inverted: c.inverted,
          };
        }),
      },
    })),
  };
}

function lockData(input: LockInput) {
  return {
    name: input.name.trim(),
    resourceType: input.resourceType,
    resources: (input.resourceType === "store" ? [] : input.resources) as unknown as Prisma.InputJsonValue,
    enabled: input.enabled,
    hideFromLists: input.hideFromLists,
    hideNavLinks: input.hideNavLinks,
    protect: input.protect,
    seoHidden: input.seoHidden,
    liquidCode: input.resourceType === "liquid" ? input.liquidCode : null,
    deniedAction: input.deniedAction,
    deniedMessage: input.deniedMessage.trim() || null,
    redirectUrl: input.redirectUrl.trim() || null,
    storeExceptions: input.storeExceptions,
  };
}

export async function createLock(shopId: string, input: LockInput) {
  return prisma.lock.create({
    data: { shopId, ...lockData(input), keys: keysCreate(input) },
  });
}

export async function updateLock(shopId: string, id: string, input: LockInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.lock.findFirst({ where: { id, shopId } });
    if (!existing) throw new Response("Not found", { status: 404 });
    await tx.lockKey.deleteMany({ where: { lockId: id } });
    return tx.lock.update({
      where: { id },
      data: { ...lockData(input), keys: keysCreate(input) },
    });
  });
}

export async function setLockEnabled(shopId: string, id: string, enabled: boolean) {
  return prisma.lock.updateMany({ where: { id, shopId }, data: { enabled } });
}

export async function deleteLock(shopId: string, id: string) {
  return prisma.lock.deleteMany({ where: { id, shopId } });
}

export function toLockInput(lock: LockWithKeys): LockInput {
  return {
    name: lock.name,
    resourceType: lock.resourceType as ResourceType,
    resources: (lock.resources ?? []) as unknown as LockResource[],
    enabled: lock.enabled,
    hideFromLists: lock.hideFromLists,
    hideNavLinks: lock.hideNavLinks,
    protect: lock.protect as ProtectMode,
    seoHidden: lock.seoHidden,
    liquidCode: lock.liquidCode ?? "",
    deniedAction: lock.deniedAction as DeniedAction,
    deniedMessage: lock.deniedMessage ?? "",
    redirectUrl: lock.redirectUrl ?? "",
    storeExceptions: (lock.storeExceptions ?? []) as string[],
    keys: lock.keys.map((key) => ({
      conditions: key.conditions.map(
        (c): ConditionInput => ({
          ...readParams(c.params),
          type: c.type as ConditionInput["type"],
          inverted: c.inverted,
        }),
      ),
    })),
  };
}
