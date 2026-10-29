import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { listInputLists, saveInputList } from "../models/inputList.server";
import { apiError, authenticateApi, readJson, syncFromApi } from "../lib/api.server";
import { entriesFrom } from "../lib/apiLists.server";

// GET /api/v1/lists
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await authenticateApi(request);
  return Response.json({ lists: await listInputLists(shop.id) });
};

// POST /api/v1/lists { name, kind: "passcode" | "email", entries | text }
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return apiError(405, "Use POST to create a list.");
  const shop = await authenticateApi(request);
  const body = await readJson(request);
  const kind = body.kind === "email" ? "email" : body.kind === "passcode" ? "passcode" : null;
  if (!kind) return apiError(422, 'kind must be "passcode" or "email".');
  if (!String(body.name ?? "").trim()) return apiError(422, "name is required.");

  const { entries, invalid, truncated } = entriesFrom(kind, body);
  if (!entries.length) return apiError(422, "No valid entries.", { invalid: invalid.slice(0, 20) });
  const id = await saveInputList(shop.id, null, { name: String(body.name).trim(), kind, entries });
  // Email lists are compiled into the storefront config; passcodes stay on the server.
  if (kind === "email") await syncFromApi(shop.domain);
  return Response.json({ id, count: entries.length, skipped: invalid.length, truncated }, { status: 201 });
};
