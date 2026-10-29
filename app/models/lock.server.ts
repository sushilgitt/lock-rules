import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import type {
  ConditionInput,
  DeniedAction,
  LockInput,
  LockResource,
  ResourceType,
} from "../lib/locks";

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
  return {
    create: input.keys.map((key, k) => ({
      position: k,
      conditions: {
        create: key.conditions.map((c, i) => ({
          position: i,
          type: c.type,
          params: { values: c.values },
          inverted: c.inverted,
        })),
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
    deniedAction: lock.deniedAction as DeniedAction,
    deniedMessage: lock.deniedMessage ?? "",
    redirectUrl: lock.redirectUrl ?? "",
    storeExceptions: (lock.storeExceptions ?? []) as string[],
    keys: lock.keys.map((key) => ({
      conditions: key.conditions.map(
        (c): ConditionInput => ({
          type: c.type as ConditionInput["type"],
          values: ((c.params as { values?: string[] })?.values ?? []).map(String),
          inverted: c.inverted,
        }),
      ),
    })),
  };
}
