import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { findCondition, issueToken, recordUnlock, shopForProxy } from "../lib/proxy.server";
import { TOKEN_ATTRIBUTE } from "../lib/tokens.server";

// GET /apps/lockrules/s/:code?to=/products/x
// Secret link: stores an unlock token in the cart, then sends the shopper on.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = await shopForProxy(url.searchParams.get("shop"));
  const condition =
    shop && params.code ? await findCondition(shop.id, { code: params.code }) : null;

  const rawTo = url.searchParams.get("to") ?? "/";
  // Only same-site paths: no protocol-relative or absolute URLs.
  const to = /^\/(?![/\\])/.test(rawTo) ? rawTo : "/";

  if (!shop || condition?.type !== "secret_link") {
    return page(`<p>This link is no longer valid.</p><p><a href="/">Continue to the store</a></p>`);
  }

  await recordUnlock({
    shopId: shop.id,
    lockId: condition.lockId,
    conditionUid: condition.p.uid,
    kind: "secret_link",
    customerId: url.searchParams.get("logged_in_customer_id"),
  });
  const token = issueToken(shop.hmacSecret!, condition.p.uid, condition.p.minutes);
  const data = JSON.stringify({ token, to, attr: TOKEN_ATTRIBUTE }).replace(/</g, "\u003c");

  return page(`<p>Unlocking&hellip;</p>
<script>
(function () {
  var d = ${data};
  var uid = d.token.split(".")[0];
  var now = Date.now() / 1000;
  fetch("/cart.js", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (cart) {
      var current = ((cart.attributes || {})[d.attr] || "").split(" ").filter(function (t) {
        var p = t.split(".");
        return p.length === 3 && p[0] !== uid && Number(p[1]) > now;
      });
      current.push(d.token);
      var attributes = {};
      attributes[d.attr] = current.slice(-20).join(" ");
      return fetch("/cart/update.js", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: attributes })
      });
    })
    .finally(function () { location.replace(d.to); });
})();
</script>`);
};

function page(body: string) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unlocking</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:4rem 1rem">${body}</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
