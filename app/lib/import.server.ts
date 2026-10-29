import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { gql, userErrors } from "./compile.server";
import { MAX_IMPORT_ROWS } from "./lists";

/*
 * Bulk customer import: a CSV of emails (plus optional names and tags) becomes
 * Shopify customers with those tags, so tag-based keys work for them right away.
 * Runs in the background with the shop's offline session and resumes after a
 * server restart (the page re-kicks stalled jobs).
 */

export type ImportRow = { email: string; tags: string[]; firstName?: string; lastName?: string };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STALL_MS = 2 * 60 * 1000;
const running = new Set<string>();

/** Minimal RFC 4180 parsing: quoted fields, escaped quotes, CRLF. */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/**
 * Columns (header row required, any order): email, tags, first_name, last_name.
 * Tags within a cell are separated by commas, semicolons or pipes.
 */
export function parseCustomerCsv(text: string, extraTags: string[] = []) {
  const [header, ...lines] = parseCsv(text);
  const cols = (header ?? []).map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const at = (name: string[]) => cols.findIndex((c) => name.includes(c));
  const iEmail = at(["email", "email_address", "e_mail"]);
  const iTags = at(["tags", "tag"]);
  const iFirst = at(["first_name", "firstname", "first"]);
  const iLast = at(["last_name", "lastname", "last"]);
  if (iEmail < 0) return { rows: [], invalid: [], error: "The first row must be a header with an email column." };

  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  const invalid: string[] = [];
  for (const line of lines) {
    const email = (line[iEmail] ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) {
      invalid.push(email || "(blank)");
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    const tags = [
      ...new Set([...(iTags >= 0 ? (line[iTags] ?? "").split(/[,;|]/) : []), ...extraTags].map((t) => t.trim()).filter(Boolean)),
    ];
    rows.push({
      email,
      tags,
      ...(iFirst >= 0 && line[iFirst]?.trim() ? { firstName: line[iFirst].trim() } : {}),
      ...(iLast >= 0 && line[iLast]?.trim() ? { lastName: line[iLast].trim() } : {}),
    });
  }
  return { rows: rows.slice(0, MAX_IMPORT_ROWS), invalid, truncated: rows.length > MAX_IMPORT_ROWS, error: null };
}

async function importOne(graphql: any, row: ImportRow) {
  // Upsert by email without tags (customerSet replaces tags), then add ours.
  const data = await gql(
    graphql,
    `#graphql
    mutation LockRulesImportCustomer($input: CustomerSetInput!, $identifier: CustomerSetIdentifiers) {
      customerSet(input: $input, identifier: $identifier) {
        customer { id tags }
        userErrors { field message code }
      }
    }`,
    {
      identifier: { email: row.email },
      input: {
        email: row.email,
        ...(row.firstName ? { firstName: row.firstName } : {}),
        ...(row.lastName ? { lastName: row.lastName } : {}),
      },
    },
  );
  userErrors(data.customerSet.userErrors, row.email);
  const customer = data.customerSet.customer as { id: string; tags: string[] };
  const missing = row.tags.filter((t) => !customer.tags.map((x) => x.toLowerCase()).includes(t.toLowerCase()));
  if (missing.length) {
    const tagged = await gql(
      graphql,
      `#graphql
      mutation LockRulesImportTags($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) { userErrors { message } }
      }`,
      { id: customer.id, tags: missing },
    );
    userErrors(tagged.tagsAdd.userErrors, row.email);
  }
}

export async function runImport(jobId: string) {
  if (running.has(jobId)) return;
  running.add(jobId);
  try {
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId }, include: { shop: true } });
    const rows = job.rows as ImportRow[];
    const errors = [...((job.errors ?? []) as string[])];
    const { admin } = await unauthenticated.admin(job.shop.domain);
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "running" } });

    let processed = job.processed;
    let done = job.updated;
    for (let i = processed; i < rows.length; i++) {
      try {
        await importOne(admin.graphql, rows[i]);
        done++;
      } catch (e) {
        if (errors.length < 100) errors.push(e instanceof Error ? e.message.slice(0, 200) : String(e));
      }
      processed = i + 1;
      if (processed % 10 === 0 || processed === rows.length) {
        await prisma.importJob.update({ where: { id: jobId }, data: { processed, updated: done, errors } });
      }
    }
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: errors.length && !done ? "failed" : "done", rows: [], processed, updated: done, errors },
    });
  } catch (e) {
    console.error(`Import ${jobId} failed:`, e);
    await prisma.importJob
      .update({ where: { id: jobId }, data: { status: "failed", errors: [e instanceof Error ? e.message : String(e)] } })
      .catch(() => {});
  } finally {
    running.delete(jobId);
  }
}

export async function startImport(shopId: string, rows: ImportRow[]) {
  const job = await prisma.importJob.create({ data: { shopId, rows, total: rows.length } });
  void runImport(job.id);
  return job.id;
}

/** Restarts jobs whose worker died (server restart mid-import). */
export async function resumeStalled(shopId: string) {
  const stalled = await prisma.importJob.findMany({
    where: {
      shopId,
      status: { in: ["queued", "running"] },
      updatedAt: { lt: new Date(Date.now() - STALL_MS) },
    },
  });
  for (const job of stalled) void runImport(job.id);
}
