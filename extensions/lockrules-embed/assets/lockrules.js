// LockRules storefront helper. Config comes from blocks/lock_embed.liquid.
(function () {
  var lr = window.LockRules;
  if (!lr) return;

  function pathOf(href) {
    try {
      // Strip locale prefixes like /fr or /en-ca so /fr/products/x matches /products/x.
      return new URL(href, location.origin).pathname.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/i, "").replace(/\/$/, "");
    } catch (e) {
      return "";
    }
  }

  function matches(list, href) {
    var p = pathOf(href);
    for (var i = 0; i < list.length; i++) if (list[i] && p === list[i]) return true;
    return false;
  }

  function hideLinks(root) {
    var links = root.querySelectorAll ? root.querySelectorAll("a[href]") : [];
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute("href");
      var inNav = a.closest("header, nav, [role='navigation'], .header, .menu-drawer");
      if (inNav && matches(lr.nav, href)) {
        (a.closest("li") || a).style.display = "none";
      } else if (!inNav && matches(lr.hide, href)) {
        var card = a.closest("li, .grid__item, .card-wrapper, .product-card, .product-item, .predictive-search__list-item") || a;
        card.style.display = "none";
      }
    }
  }

  function renderDenied() {
    var main = document.querySelector("main, #MainContent, [role='main']");
    var box = document.createElement("div");
    box.className = "lockrules-denied";
    box.setAttribute("role", "alert");
    box.style.cssText = "max-width:36rem;margin:4rem auto;padding:2rem;text-align:center;";
    var p = document.createElement("p");
    p.style.cssText = "white-space:pre-line;margin:0 0 1.5rem;";
    p.textContent = lr.message;
    box.appendChild(p);
    if (lr.action === "login") {
      var btn = document.createElement("a");
      btn.className = "button button--primary btn";
      btn.href = lr.loginUrl;
      btn.textContent = lr.loginLabel || "Sign in";
      box.appendChild(btn);
    }
    if (main) {
      main.innerHTML = "";
      main.appendChild(box);
      main.style.setProperty("visibility", "visible", "important");
    } else {
      document.body.innerHTML = "";
      document.body.appendChild(box);
    }
  }

  function run() {
    if (lr.denied && lr.action !== "redirect") renderDenied();
    if ((lr.hide && lr.hide.length) || (lr.nav && lr.nav.length)) {
      hideLinks(document);
      // Catch cards added later: predictive search, infinite scroll, quick view.
      new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) hideLinks(added[j]);
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
