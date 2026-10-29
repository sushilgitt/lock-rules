import prisma from "../../db.server";
import type { LockWithKeys } from "../../models/lock.server";
import { readParams } from "../../models/lock.server";
import { gql, setMetafields, userErrors, type GraphQL } from "../compile.server";
import { legacyId } from "../locks";
import {
  findWarnings,
  injectLayout,
  injectLoops,
  isLayout,
  isScannable,
  stripAll,
} from "./patch";
import { SNIPPET_PREFIX, snippetFiles, type CustomRule } from "./templates.server";

/*
 * Secure mode writes LockRules into the published theme so locked content is
 * never rendered for visitors without a key:
 *   - layout/*.liquid: content_for_layout is wrapped in the lockrules page gate
 *   - sections/snippets/blocks: product, search and menu loops skip locked items
 *   - snippets/lockrules*.liquid: the gate plus copies of the embed's key checks
 * Config and the token secret are mirrored to app-owned shop metafields
 * (`$app:lockrules`), which theme code reads as `app--{appId}--lockrules`.
 *
 * Writing theme files needs write_themes plus an exemption from Shopify; without
 * it every write fails and the report says so.
 */

export const SHOP_NAMESPACE = "$app:lockrules";
const UPSERT_BATCH = 50;
const READ_BATCH = 50;

export interface SecureReport {
  at?: string;
  themeId?: string;
  themeName?: string;
  edited?: string[];
  loops?: number;
  warnings?: string[];
  error?: string;
  needsExemption?: boolean;
  dryRun?: boolean;
}

type ThemeFile = { filename: string; content: string };

export class ExemptionError extends Error {}

function isAccessError(message: string) {
  return /access denied|exemption|write_themes|not approved|ACCESS_DENIED/i.test(message);
}

export async function mainTheme(graphql: GraphQL) {
  const data = await gql(graphql, `#graphql
    query LockRulesMainThemeId { themes(first: 1, roles: [MAIN]) { nodes { id name } } }`);
  return (data.themes.nodes[0] ?? null) as { id: string; name: string } | null;
}

export async function appId(graphql: GraphQL) {
  const data = await gql(graphql, `#graphql
    query LockRulesAppId { currentAppInstallation { app { id } } }`);
  return legacyId(data.currentAppInstallation.app.id as string);
}

async function listFilenames(graphql: GraphQL, themeId: string) {
  const names: string[] = [];
  let after: string | null = null;
  do {
    const data: any = await gql(
      graphql,
      `#graphql
      query LockRulesThemeFiles($id: ID!, $after: String) {
        theme(id: $id) {
          files(first: 250, after: $after) {
            nodes { filename }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: themeId, after },
    );
    const files = data.theme.files;
    names.push(...files.nodes.map((n: { filename: string }) => n.filename));
    after = files.pageInfo.hasNextPage ? files.pageInfo.endCursor : null;
  } while (after);
  return names;
}

async function readFiles(graphql: GraphQL, themeId: string, filenames: string[]) {
  const out: ThemeFile[] = [];
  for (let i = 0; i < filenames.length; i += READ_BATCH) {
    const data = await gql(
      graphql,
      `#graphql
      query LockRulesThemeFileBodies($id: ID!, $names: [String!]!) {
        theme(id: $id) {
          files(filenames: $names, first: 50) {
            nodes {
              filename
              body { ... on OnlineStoreThemeFileBodyText { content } }
            }
          }
        }
      }`,
      { id: themeId, names: filenames.slice(i, i + READ_BATCH) },
    );
    for (const node of data.theme.files.nodes) {
      if (typeof node.body?.content === "string") out.push({ filename: node.filename, content: node.body.content });
    }
  }
  return out;
}

async function writeFiles(graphql: GraphQL, themeId: string, files: ThemeFile[]) {
  for (let i = 0; i < files.length; i += UPSERT_BATCH) {
    try {
      const data = await gql(
        graphql,
        `#graphql
        mutation LockRulesWriteTheme($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
          themeFilesUpsert(themeId: $themeId, files: $files) {
            upsertedThemeFiles { filename }
            userErrors { field message }
          }
        }`,
        {
          themeId,
          files: files.slice(i, i + UPSERT_BATCH).map((f) => ({
            filename: f.filename,
            body: { type: "TEXT", value: f.content },
          })),
        },
      );
      userErrors(data.themeFilesUpsert.userErrors, "Theme update");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isAccessError(message)) throw new ExemptionError(message);
      throw e;
    }
  }
}

async function deleteFiles(graphql: GraphQL, themeId: string, filenames: string[]) {
  if (!filenames.length) return;
  try {
    const data = await gql(
      graphql,
      `#graphql
      mutation LockRulesDeleteThemeFiles($themeId: ID!, $files: [String!]!) {
        themeFilesDelete(themeId: $themeId, files: $files) {
          deletedThemeFiles { filename }
          userErrors { field message }
        }
      }`,
      { themeId, files: filenames },
    );
    userErrors(data.themeFilesDelete.userErrors, "Theme cleanup");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isAccessError(message)) throw new ExemptionError(message);
    throw e;
  }
}

export function customRules(locks: LockWithKeys[]): CustomRule[] {
  const rules: CustomRule[] = [];
  for (const lock of locks) {
    if (!lock.enabled) continue;
    if (lock.resourceType === "liquid" && lock.liquidCode) {
      rules.push({ kind: "lock", id: lock.id, liquid: lock.liquidCode });
    }
    for (const key of lock.keys) {
      for (const c of key.conditions) {
        const p = readParams(c.params);
        if (c.type === "liquid" && p.liquid) rules.push({ kind: "cond", id: p.uid, liquid: p.liquid });
      }
    }
  }
  return rules;
}

/** Plans every edit for a theme without writing anything (needs only read_themes). */
async function plan(graphql: GraphQL, themeId: string, excluded: string[], locks: LockWithKeys[]) {
  const names = await listFilenames(graphql, themeId);
  const targets = names.filter((n) => (isLayout(n) || isScannable(n)) && !excluded.includes(n));
  const files = await readFiles(graphql, themeId, targets);

  const changes: ThemeFile[] = [];
  let loops = 0;
  let gated = false;
  for (const f of files) {
    let content = f.content;
    if (isLayout(f.filename)) {
      const r = injectLayout(content);
      content = r.content;
      gated ||= r.found;
    } else {
      const r = injectLoops(content);
      content = r.content;
      loops += r.count;
    }
    if (content !== f.content) changes.push({ filename: f.filename, content });
  }

  const snippets = Object.entries(snippetFiles(await appId(graphql), customRules(locks))).map(
    ([filename, content]) => ({ filename, content }),
  );
  const warnings = findWarnings(files);
  if (!gated) warnings.unshift("Secure mode couldn't find content_for_layout in your layouts.");
  return { changes, snippets, loops, warnings };
}

async function saveReport(shopId: string, report: SecureReport, extra: Record<string, unknown> = {}) {
  await prisma.shop.update({
    where: { id: shopId },
    data: { secureReport: { ...report, at: new Date().toISOString() } as any, ...extra },
  });
}

/** Mirrors the storefront config and secret where theme code can read them. */
export async function writeShopConfig(graphql: GraphQL, config: unknown, secret: string) {
  const data = await gql(graphql, `#graphql
    query LockRulesShopId { shop { id } }`);
  const errors = await setMetafields(graphql, [
    { ownerId: data.shop.id, namespace: SHOP_NAMESPACE, key: "config", value: JSON.stringify(config) },
    {
      ownerId: data.shop.id,
      namespace: SHOP_NAMESPACE,
      key: "secret",
      value: secret,
      type: "single_line_text_field",
    },
  ]);
  userErrors(errors, "Secure mode config");
}

export async function previewSecure(graphql: GraphQL, shopId: string, excluded: string[], locks: LockWithKeys[]) {
  const theme = await mainTheme(graphql);
  if (!theme) return { error: "Your store has no published theme." } satisfies SecureReport;
  const { changes, snippets, loops, warnings } = await plan(graphql, theme.id, excluded, locks);
  const report: SecureReport = {
    dryRun: true,
    themeId: theme.id,
    themeName: theme.name,
    edited: [...changes.map((c) => c.filename), ...snippets.map((s) => s.filename)],
    loops,
    warnings,
  };
  await saveReport(shopId, report);
  return report;
}

export async function installSecure(
  graphql: GraphQL,
  shop: { id: string; secureExcluded: unknown },
  locks: LockWithKeys[],
  themeId?: string,
) {
  const excluded = (shop.secureExcluded ?? []) as string[];
  const theme = themeId ? { id: themeId, name: "" } : await mainTheme(graphql);
  if (!theme) {
    const report: SecureReport = { error: "Your store has no published theme." };
    await saveReport(shop.id, report);
    return report;
  }

  try {
    const { changes, snippets, loops, warnings } = await plan(graphql, theme.id, excluded, locks);
    // Snippets first so the layout never renders a gate that doesn't exist yet.
    await writeFiles(graphql, theme.id, snippets);
    await writeFiles(graphql, theme.id, changes);
    const report: SecureReport = {
      themeId: theme.id,
      themeName: theme.name || (await mainTheme(graphql))?.name,
      edited: [...snippets.map((s) => s.filename), ...changes.map((c) => c.filename)],
      loops,
      warnings,
    };
    await saveReport(shop.id, report, { secureEnabled: true, secureThemeId: theme.id });
    return report;
  } catch (e) {
    const exemption = e instanceof ExemptionError;
    const report: SecureReport = {
      themeId: theme.id,
      themeName: theme.name,
      needsExemption: exemption,
      error: exemption
        ? "Shopify hasn't granted LockRules permission to edit theme files yet."
        : e instanceof Error
          ? e.message
          : String(e),
    };
    await saveReport(shop.id, report);
    return report;
  }
}

/** Rewrites only our snippets (after lock edits change custom Liquid). */
export async function refreshSnippets(graphql: GraphQL, themeId: string, locks: LockWithKeys[]) {
  const files = Object.entries(snippetFiles(await appId(graphql), customRules(locks))).map(
    ([filename, content]) => ({ filename, content }),
  );
  await writeFiles(graphql, themeId, files);
}

/** Removes everything secure mode added and restores the original theme files. */
export async function uninstallSecure(graphql: GraphQL, shop: { id: string; secureThemeId: string | null }) {
  const themeId = shop.secureThemeId;
  if (!themeId) {
    await prisma.shop.update({ where: { id: shop.id }, data: { secureEnabled: false } });
    return { ok: true };
  }
  try {
    const names = await listFilenames(graphql, themeId);
    const files = await readFiles(graphql, themeId, names.filter((n) => isLayout(n) || isScannable(n)));
    const restored = files
      .map((f) => ({ filename: f.filename, content: stripAll(f.content) }))
      .filter((f, i) => f.content !== files[i].content);
    // Unwrap layouts first so nothing renders a missing gate.
    await writeFiles(graphql, themeId, restored);
    await deleteFiles(graphql, themeId, names.filter((n) => n.startsWith(SNIPPET_PREFIX)));
    await prisma.shop.update({
      where: { id: shop.id },
      data: { secureEnabled: false, secureThemeId: null, secureReport: {} },
    });
    return { ok: true, restored: restored.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** themes/publish: move secure mode to the newly published theme. */
export async function followPublishedTheme(
  graphql: GraphQL,
  shop: { id: string; secureEnabled: boolean; secureExcluded: unknown; secureThemeId: string | null },
  themeId: string,
  locks: LockWithKeys[],
) {
  if (!shop.secureEnabled || shop.secureThemeId === themeId) return null;
  return installSecure(graphql, shop, locks, themeId);
}
