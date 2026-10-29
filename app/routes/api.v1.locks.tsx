import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createLock, getLock, listLocks } from "../models/lock.server";
import {
  apiError,
  authenticateApi,
  normalizeLock,
  readJson,
  serializeLock,
  syncFromApi,
} from "../lib/api.server";

// GET /api/v1/locks
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await authenticateApi(request);
  const locks = await listLocks(shop.id);
  return Response.json({ locks: locks.map(serializeLock) });
};

// POST /api/v1/locks
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return apiError(405, "Use POST to create a lock.");
  const shop = await authenticateApi(request);
  const input = normalizeLock(await readJson(request));
  const created = await createLock(shop.id, input);
  const sync = await syncFromApi(shop.domain);
  const lock = await getLock(shop.id, created.id);
  return Response.json({ lock: serializeLock(lock!), syncError: sync.syncError }, { status: 201 });
};
