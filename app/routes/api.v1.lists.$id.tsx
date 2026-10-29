import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { deleteInputList, getInputList, saveInputList } from "../models/inputList.server";
import { apiError, authenticateApi, readJson, syncFromApi } from "../lib/api.server";
import { entriesFrom } from "../lib/apiLists.server";
import type { ListEntry, ListKind } from "../lib/lists";

// GET /api/v1/lists/:id (includes entries)
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const shop = await authenticateApi(request);
  const list = await getInputList(shop.id, params.id!);
  if (!list) return apiError(404, "List not found.");
  return Response.json({
    list: { id: list.id, name: list.name, kind: list.kind, entries: list.entries as ListEntry[] },
  });
};

// PUT replaces the entries (and optionally the name); DELETE removes the list.
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const shop = await authenticateApi(request);
  const list = await getInputList(shop.id, params.id!);
  if (!list) return apiError(404, "List not found.");
  const kind = list.kind as ListKind;

  if (request.method === "DELETE") {
    await deleteInputList(shop.id, list.id);
    if (kind === "email") await syncFromApi(shop.domain);
    return Response.json({ deleted: true });
  }
  if (request.method !== "PUT") return apiError(405, "Use PUT or DELETE.");

  const body = await readJson(request);
  const { entries, invalid, truncated } = entriesFrom(kind, body);
  if (!entries.length) return apiError(422, "No valid entries.", { invalid: invalid.slice(0, 20) });
  await saveInputList(shop.id, list.id, { name: String(body.name ?? list.name).trim(), kind, entries });
  if (kind === "email") await syncFromApi(shop.domain);
  return Response.json({ id: list.id, count: entries.length, skipped: invalid.length, truncated });
};
