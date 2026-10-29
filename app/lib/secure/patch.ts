// Pure theme-file rewrites for secure mode. Every edit is wrapped in LockRules
// markers so installing is idempotent and uninstalling restores the original.
import {
  ITEM_BEGIN,
  ITEM_END,
  MARK_BEGIN,
  MARK_END,
  SNIPPET_PREFIX,
  itemGuard,
  layoutWrap,
} from "./templates.server";

const CONTENT_FOR_LAYOUT = /\{\{-?\s*content_for_layout\s*-?\}\}/g;

// Tag-delimited for loops over product lists, search results and menus.
// Loops inside {% liquid %} blocks have no delimiters and aren't touched.
const FOR_LOOP =
  /\{%-?\s*for\s+(\w+)\s+in\s+([\w.[\]'"-]+?)(\s[^%]*?)?-?%\}/g;

function loopKind(expr: string): "product" | "search" | "link" | null {
  if (/(^|\.)links$/.test(expr)) return "link";
  if (/^search\.results$|^predictive_search\.resources\.(products|pages|articles)$/.test(expr)) {
    return "search";
  }
  if (/(^|\.)products$/.test(expr)) return "product";
  return null;
}

export function isLayout(filename: string) {
  return filename.startsWith("layout/") && filename.endsWith(".liquid") && filename !== "layout/password.liquid";
}

export function isScannable(filename: string) {
  return (
    (filename.startsWith("sections/") || filename.startsWith("snippets/") || filename.startsWith("blocks/")) &&
    filename.endsWith(".liquid") &&
    !filename.startsWith(SNIPPET_PREFIX)
  );
}

export function hasLayoutGate(content: string) {
  return content.includes(MARK_BEGIN);
}

export function injectLayout(content: string) {
  if (hasLayoutGate(content)) return { content, changed: false, found: true };
  let found = false;
  const next = content.replace(CONTENT_FOR_LAYOUT, (m) => {
    found = true;
    return layoutWrap(m);
  });
  return { content: next, changed: next !== content, found };
}

export function injectLoops(content: string) {
  let count = 0;
  const next = content.replace(FOR_LOOP, (tag, variable: string, expr: string, _rest, offset: number) => {
    const kind = loopKind(expr);
    if (!kind) return tag;
    // Already guarded (re-install).
    if (content.startsWith(ITEM_BEGIN, offset + tag.length)) return tag;
    count++;
    return tag + itemGuard(variable, kind);
  });
  return { content: next, count };
}

/** Removes everything LockRules added, restoring the original markup. */
export function stripAll(content: string) {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const layout = new RegExp(
    esc(MARK_BEGIN) + "[\\s\\S]*?\\{%- if lockrules_gate == blank -%\\}([\\s\\S]*?)\\{%- else -%\\}[\\s\\S]*?" + esc(MARK_END),
    "g",
  );
  const item = new RegExp(esc(ITEM_BEGIN) + "[\\s\\S]*?" + esc(ITEM_END), "g");
  return content.replace(layout, "$1").replace(item, "");
}

/** Things worth telling the merchant before or after installing. */
export function findWarnings(files: { filename: string; content: string }[]) {
  const warnings: string[] = [];
  const layouts = files.filter((f) => isLayout(f.filename));
  if (!layouts.some((f) => /content_for_layout/.test(f.content))) {
    warnings.push("No layout file outputs content_for_layout, so pages can't be gated on the server.");
  }
  for (const f of files) {
    if (/locksmith/i.test(f.content) && !f.filename.startsWith(SNIPPET_PREFIX)) {
      warnings.push(`${f.filename} contains Locksmith code. Remove it to avoid two apps gating the same content.`);
    }
    if (isScannable(f.filename) && /\{%-?\s*liquid\b[\s\S]*?\bfor\s+\w+\s+in\s+[\w.]*(products|links|results)\b/.test(f.content)) {
      warnings.push(`${f.filename} loops over products or links inside a {% liquid %} tag, which secure mode can't filter. Hidden items there are only hidden in the browser.`);
    }
  }
  return warnings;
}
