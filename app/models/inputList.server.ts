import prisma from "../db.server";
import { MAX_ENTRIES, type ListEntry, type ListKind } from "../lib/lists";

export { MAX_ENTRIES, type ListEntry, type ListKind };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parses pasted text or a CSV upload. One entry per line; for passcodes an
 * optional second column (or "CODE -> /path") is the redirect after unlocking.
 * A header row ("passcode,redirect" / "email") is skipped.
 */
export function parseEntries(kind: ListKind, raw: string) {
  const entries: ListEntry[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  raw.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const [first, second] = trimmed.includes("->")
      ? trimmed.split("->")
      : trimmed.split(/[,;\t]/);
    const v = (first ?? "").trim().replace(/^"|"$/g, "");
    const r = (second ?? "").trim().replace(/^"|"$/g, "");
    if (i === 0 && /^(passcode|code|email|e-mail)s?$/i.test(v)) return;

    if (kind === "email") {
      const email = v.toLowerCase();
      if (!EMAIL.test(email)) return void invalid.push(v);
      if (seen.has(email)) return;
      seen.add(email);
      entries.push({ v: email });
    } else {
      if (!v || v.length > 200) return void invalid.push(v);
      const key = v.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      entries.push(r && /^\/(?![\/\\])/.test(r) ? { v, r } : { v });
    }
  });

  return { entries: entries.slice(0, MAX_ENTRIES), invalid, truncated: entries.length > MAX_ENTRIES };
}

export function serializeEntries(entries: ListEntry[]) {
  return entries.map((e) => (e.r ? `${e.v},${e.r}` : e.v)).join("\n");
}

export async function listInputLists(shopId: string) {
  const lists = await prisma.inputList.findMany({ where: { shopId }, orderBy: { name: "asc" } });
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind as ListKind,
    count: ((l.entries ?? []) as ListEntry[]).length,
    updatedAt: l.updatedAt.toISOString(),
  }));
}

export async function getInputList(shopId: string, id: string) {
  return prisma.inputList.findFirst({ where: { id, shopId } });
}

export async function saveInputList(
  shopId: string,
  id: string | null,
  data: { name: string; kind: ListKind; entries: ListEntry[] },
) {
  if (id) {
    const res = await prisma.inputList.updateMany({
      where: { id, shopId },
      // A list's kind can't change once conditions point at it.
      data: { name: data.name, entries: data.entries },
    });
    if (!res.count) throw new Response("Not found", { status: 404 });
    return id;
  }
  const created = await prisma.inputList.create({ data: { shopId, ...data } });
  return created.id;
}

export async function deleteInputList(shopId: string, id: string) {
  await prisma.inputList.deleteMany({ where: { id, shopId } });
}
