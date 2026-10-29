import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { deleteLock, getLock, toLockInput, updateLock } from "../models/lock.server";
import {
  apiError,
  authenticateApi,
  normalizeLock,
  readJson,
  serializeLock,
  syncFromApi,
} from "../lib/api.server";

// GET /api/v1/locks/:id
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const shop = await authenticateApi(request);
  const lock = await getLock(shop.id, params.id!);
  if (!lock) return apiError(404, "Lock not found.");
  return Response.json({ lock: serializeLock(lock) });
};

// PUT replaces the lock, PATCH merges top-level fields, DELETE removes it.
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const shop = await authenticateApi(request);
  const existing = await getLock(shop.id, params.id!);
  if (!existing) return apiError(404, "Lock not found.");

  if (request.method === "DELETE") {
    await deleteLock(shop.id, existing.id);
    const sync = await syncFromApi(shop.domain);
    return Response.json({ deleted: true, syncError: sync.syncError });
  }
  if (request.method !== "PUT" && request.method !== "PATCH") {
    return apiError(405, "Use PUT, PATCH or DELETE.");
  }

  const body = await readJson(request);
  const input = normalizeLock(body, request.method === "PATCH" ? toLockInput(existing) : undefined);
  await updateLock(shop.id, existing.id, input);
  const sync = await syncFromApi(shop.domain);
  const lock = await getLock(shop.id, existing.id);
  return Response.json({ lock: serializeLock(lock!), syncError: sync.syncError });
};
