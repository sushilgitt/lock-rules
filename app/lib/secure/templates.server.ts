// Theme code that secure mode writes into the merchant's published theme.
//
// The key-check snippets are the app embed's own files, rewritten for theme
// code: the theme can't read the extension's `app.metafields` or `$app:`
// namespaces, so they read app-owned shop/customer metafields through the full
// `app--{appId}--lockrules` namespace instead.
import lrOpen from "../../../extensions/lockrules-embed/snippets/lr_open.liquid?raw";
import lrUnlocked from "../../../extensions/lockrules-embed/snippets/lr_unlocked.liquid?raw";
import lrApplies from "../../../extensions/lockrules-embed/snippets/lr_applies.liquid?raw";

export const SNIPPET_PREFIX = "snippets/lockrules";
export const GATE = "lockrules";
export const MARK_BEGIN = "{%- comment -%}lockrules:begin{%- endcomment -%}";
export const MARK_END = "{%- comment -%}lockrules:end{%- endcomment -%}";
export const ITEM_BEGIN = "{%- comment -%}lockrules:item{%- endcomment -%}";
export const ITEM_END = "{%- comment -%}/lockrules:item{%- endcomment -%}";

const HEADER =
  "{%- comment -%}\n  Managed by the LockRules app. Changes here are overwritten; edit locks in the app instead.\n{%- endcomment -%}\n";

const TEMPLATE_ARGS =
  "product: product, collection: collection, page: page, blog: blog, article: article";

export function namespaceFor(appId: string) {
  return `app--${appId}--lockrules`;
}

function forTheme(source: string, ns: string) {
  return (
    HEADER +
    source
      .replaceAll("render 'lr_open'", "render 'lockrules-open'")
      .replaceAll("render 'lr_unlocked'", "render 'lockrules-unlocked'")
      .replaceAll("render 'lr_applies'", "render 'lockrules-applies'")
      .replaceAll("render 'lr_custom'", "render 'lockrules-custom'")
      .replaceAll("app.metafields.lockrules.secret.value", `shop.metafields['${ns}'].secret.value`)
      .replaceAll("customer.metafields['$app:lockrules']", `customer.metafields['${ns}']`)
  );
}

/** Renders the locked-page placeholder instead of the page content. Output is empty when the visitor may see the page. */
function gateSnippet(ns: string) {
  return `${HEADER}{%- doc -%}
  Secure mode page gate. layout/theme.liquid renders this around content_for_layout
  and only outputs the page when this snippet renders nothing.

  @param {product} [product] - Current product, if any
  @param {collection} [collection] - Current collection, if any
  @param {page} [page] - Current page, if any
  @param {blog} [blog] - Current blog, if any
  @param {article} [article] - Current article, if any
{%- enddoc -%}
{%- liquid
  assign cfg = shop.metafields['${ns}'].config.value
  assign denied = false
  if cfg != blank
    capture unlocked
      render 'lockrules-unlocked'
    endcapture
    for lock in cfg.locks
      if lock.pm != 'page' or lock.type == 'variant'
        continue
      endif
      capture applies
        render 'lockrules-applies', lock: lock, ${TEMPLATE_ARGS}
      endcapture
      unless applies contains '1'
        continue
      endunless
      capture open
        render 'lockrules-open', lock: lock, unlocked: unlocked, ${TEMPLATE_ARGS}
      endcapture
      if open == blank
        assign denied = lock
        break
      endif
    endfor
  endif

  if denied
    assign loc = request.locale.iso_code | downcase
    assign tm = cfg.msgs[loc]
    assign msg = denied.msg
    assign show_login = false
    if denied.act == 'login' and customer == nil
      assign show_login = true
    endif
    if msg == blank
      if show_login
        assign msg = tm.login | default: cfg.msg.login
      else
        assign msg = tm.denied | default: cfg.msg.denied
      endif
    endif
    assign login_label = tm.loginButton | default: cfg.msg.loginButton
  endif
-%}
{%- if denied -%}
  <div class="lockrules-denied lockrules-secure" role="region" style="max-width:36rem;margin:4rem auto;padding:2rem 1rem;text-align:center">
    <p style="margin:0 0 1rem">{{ msg | escape | newline_to_br }}</p>
    {%- if show_login -%}
      <a class="button button--primary btn" href="{{ routes.account_login_url }}?return_url={{ request.path | url_encode }}">{{ login_label | escape }}</a>
    {%- endif -%}
  </div>
{%- endif -%}
`;
}

/** Outputs "1" when a list item (product card, search result or menu link) should be skipped. */
function itemSnippet(ns: string) {
  return `${HEADER}{%- doc -%}
  Secure mode list filter, rendered at the top of product, search and menu loops.

  @param {object} item - The loop item
  @param {string} kind - "product", "search" or "link"
{%- enddoc -%}
{%- liquid
  # No config (app removed or not synced yet): cfg.locks is empty and nothing is hidden.
  assign cfg = shop.metafields['${ns}'].config.value
  assign otype = kind
  if kind == 'search'
    assign otype = item.object_type
  endif

  assign path = ''
  if kind == 'link'
    assign path = item.url | split: '?' | first
  endif

  assign hit = false
  for lock in cfg.locks
    if kind == 'link'
      unless lock.nav
        continue
      endunless
      assign prefix = '/' | append: lock.type | append: 's/'
      for h in lock.handles
        assign target = prefix | append: h
        assign tail_len = target.size
        assign tail_start = 0 | minus: tail_len
        assign tail = path | slice: tail_start, tail_len
        if tail == target
          assign hit = true
          break
        endif
      endfor
    else
      unless lock.hide
        continue
      endunless
      assign iid = item.id | append: ''
      case lock.type
        when 'product'
          if otype == 'product' and lock.ids contains iid
            assign hit = true
          endif
        when 'collection'
          if otype == 'product'
            for col in item.collections
              assign cid = col.id | append: ''
              if lock.ids contains cid
                assign hit = true
                break
              endif
            endfor
          endif
        when 'page'
          if otype == 'page' and lock.ids contains iid
            assign hit = true
          endif
        when 'blog'
          if otype == 'article'
            assign bid = item.blog_id | append: ''
            if lock.ids contains bid
              assign hit = true
            endif
          endif
      endcase
    endif

    if hit
      capture unlocked
        render 'lockrules-unlocked'
      endcapture
      capture open
        render 'lockrules-open', lock: lock, unlocked: unlocked
      endcapture
      if open == blank
        echo '1'
        break
      endif
      assign hit = false
    endif
  endfor
-%}
`;
}

/** For theme developers: outputs "1" when the visitor holds a key to `lock_id`. */
function accessSnippet(ns: string) {
  // Nothing renders it until a developer does, so theme check reports it as orphaned.
  return `${HEADER}{%- doc -%}
  Outputs "1" when the visitor holds a key to the lock with this ID, or when the
  lock is turned off or deleted. Copy lock IDs from the LockRules app.

  @param {string} lock_id - The lock ID

  @example
  {%- capture access -%}{%- render 'lockrules-access', lock_id: 'clx123' -%}{%- endcapture -%}
  {%- if access == '1' -%}Members-only content{%- endif -%}
{%- enddoc -%}
{%- liquid
  assign cfg = shop.metafields['${ns}'].config.value
  assign found = false
  for lock in cfg.locks
    if lock.id == lock_id
      assign found = true
      capture unlocked
        render 'lockrules-unlocked'
      endcapture
      capture open
        render 'lockrules-open', lock: lock, unlocked: unlocked
      endcapture
      if open != blank
        echo '1'
      endif
      break
    endif
  endfor
  unless found
    echo '1'
  endunless
-%}
`;
}

export type CustomRule = { kind: "lock" | "cond"; id: string; liquid: string };

/** Merchant-written Liquid for Liquid locks and custom Liquid conditions. */
export function customSnippet(rules: CustomRule[]) {
  const branch = (kind: CustomRule["kind"]) => {
    const own = rules.filter((r) => r.kind === kind);
    if (!own.length) return "";
    return (
      `{%- when '${kind}' -%}{%- case id -%}` +
      own.map((r) => `{%- when '${r.id.replace(/[^\w-]/g, "")}' -%}\n${r.liquid}\n`).join("") +
      "{%- endcase -%}"
    );
  };
  // Template objects are for the merchant's own Liquid, which may not use them all.
  return `${HEADER}{% # theme-check-disable UnusedDocParam %}
{%- doc -%}
  Custom Liquid from LockRules locks. Each rule outputs "true" when it passes.

  @param {string} kind - "lock" or "cond"
  @param {string} id - Lock id or condition uid
  @param {product} [product] - Current product, if any
  @param {collection} [collection] - Current collection, if any
  @param {page} [page] - Current page, if any
  @param {blog} [blog] - Current blog, if any
  @param {article} [article] - Current article, if any
{%- enddoc -%}
{%- case kind -%}${branch("lock")}${branch("cond")}{%- endcase -%}
`;
}

/** Every snippet secure mode owns, keyed by theme filename. */
export function snippetFiles(appId: string, rules: CustomRule[]) {
  const ns = namespaceFor(appId);
  return {
    [`snippets/${GATE}.liquid`]: gateSnippet(ns),
    "snippets/lockrules-item.liquid": itemSnippet(ns),
    "snippets/lockrules-access.liquid": accessSnippet(ns),
    "snippets/lockrules-open.liquid": forTheme(lrOpen, ns),
    "snippets/lockrules-unlocked.liquid": forTheme(lrUnlocked, ns),
    "snippets/lockrules-applies.liquid": forTheme(lrApplies, ns),
    "snippets/lockrules-custom.liquid": customSnippet(rules),
  };
}

export function layoutWrap(original: string) {
  return (
    MARK_BEGIN +
    `{%- capture lockrules_gate -%}{%- render '${GATE}', ${TEMPLATE_ARGS} -%}{%- endcapture -%}` +
    "{%- assign lockrules_gate = lockrules_gate | strip -%}" +
    `{%- if lockrules_gate == blank -%}${original}{%- else -%}{{ lockrules_gate }}{%- endif -%}` +
    MARK_END
  );
}

export function itemGuard(variable: string, kind: "product" | "search" | "link") {
  return (
    ITEM_BEGIN +
    `{%- capture lockrules_skip -%}{%- render 'lockrules-item', item: ${variable}, kind: '${kind}' -%}{%- endcapture -%}` +
    "{%- if lockrules_skip != blank -%}{%- continue -%}{%- endif -%}" +
    ITEM_END
  );
}
