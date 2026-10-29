import { parseEntries } from "../models/inputList.server";
import type { ListEntry, ListKind } from "./lists";

/** API list bodies carry entries as [{ v, r? }] / ["CODE"], or CSV/plain text in `text`. */
export function entriesFrom(kind: ListKind, body: { entries?: unknown; text?: unknown }) {
  const text = Array.isArray(body.entries)
    ? (body.entries as (ListEntry | string)[])
        .map((e) => (typeof e === "string" ? e : e?.r ? `${e.v},${e.r}` : e?.v))
        .filter(Boolean)
        .join("\n")
    : String(body.text ?? "");
  return parseEntries(kind, text);
}
