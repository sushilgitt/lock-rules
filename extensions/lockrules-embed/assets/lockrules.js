// LockRules storefront helper. Config comes from blocks/lock_embed.liquid.
(function () {
  var lr = window.LockRules;
  if (!lr) return;
  var ATTR = "_lr";

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

  // --- unlock tokens -------------------------------------------------------

  function saveTokens(tokens) {
    var now = Date.now() / 1000;
    var uids = tokens.map(function (t) { return t.split(".")[0]; });
    return fetch("/cart.js", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var kept = ((cart.attributes || {})[ATTR] || "").split(" ").filter(function (t) {
          var p = t.split(".");
          return p.length === 3 && uids.indexOf(p[0]) === -1 && Number(p[1]) > now;
        });
        var attributes = {};
        attributes[ATTR] = kept.concat(tokens).slice(-20).join(" ");
        return fetch("/cart/update.js", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attributes: attributes })
        });
      });
  }

  function proxy(path, body) {
    return fetch(lr.proxy + path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function unlocked(redirect) {
    return function () {
      if (redirect) location.assign(redirect);
      else location.reload();
    };
  }

  // --- denied view -----------------------------------------------------------

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (text) node.textContent = text;
    return node;
  }

  function passcodeForm(cond) {
    var form = el("form", { "class": "lockrules-form", style: "display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;margin:1rem 0" });
    var input = el("input", { type: "password", autocomplete: "off", required: "", "aria-label": lr.t.passcode, "class": "field__input", style: "max-width:16rem;padding:.6rem" });
    var button = el("button", { type: "submit", "class": "button button--primary btn" }, lr.t.passcodeButton);
    var error = el("p", { role: "alert", style: "width:100%;margin:.5rem 0 0;color:#b00020" });
    form.appendChild(input);
    form.appendChild(button);
    form.appendChild(error);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      button.disabled = true;
      error.textContent = "";
      proxy("/unlock", { uid: cond.id, value: input.value })
        .then(function (res) {
          if (!res.ok) throw new Error(res.error);
          return saveTokens([res.token]).then(unlocked(res.redirect));
        })
        .catch(function () {
          error.textContent = lr.t.passcodeError;
          button.disabled = false;
          input.select();
        });
    });
    return form;
  }

  function confirmButton(cond) {
    var wrap = el("div", { style: "margin:1rem 0" });
    if (cond.p) wrap.appendChild(el("p", { style: "white-space:pre-line" }, cond.p));
    var button = el("button", { type: "button", "class": "button button--primary btn" }, lr.t.confirmButton);
    button.addEventListener("click", function () {
      button.disabled = true;
      proxy("/unlock", { uid: cond.id })
        .then(function (res) {
          if (!res.ok) throw new Error(res.error);
          return saveTokens([res.token]).then(unlocked(res.redirect));
        })
        .catch(function () { button.disabled = false; });
    });
    wrap.appendChild(button);
    return wrap;
  }

  function renderDenied() {
    var remote = lr.remote || [];
    var has = function (t) { return remote.some(function (c) { return c.t === t; }); };
    var guestLogin = lr.action === "login" && !lr.signedIn;

    var message = lr.message;
    if (!message) {
      if (has("passcode")) message = lr.t.passcode;
      else if (guestLogin) message = lr.t.login;
      else if (has("confirm") && !remote.some(function (c) { return c.t === "confirm" && c.p; })) message = lr.t.confirm;
      else if (!has("confirm")) message = lr.t.denied;
    }

    var box = el("div", { "class": "lockrules-denied", role: "region", "aria-live": "polite", style: "max-width:36rem;margin:4rem auto;padding:2rem 1rem;text-align:center" });
    if (message) box.appendChild(el("p", { style: "white-space:pre-line;margin:0 0 1rem" }, message));
    remote.forEach(function (c) {
      if (c.t === "passcode") box.appendChild(passcodeForm(c));
      if (c.t === "confirm") box.appendChild(confirmButton(c));
    });
    if (guestLogin) {
      var login = el("a", { href: lr.loginUrl, "class": "button btn" + (has("passcode") ? "" : " button--primary") }, lr.t.loginButton);
      box.appendChild(login);
    }

    var main = document.querySelector("main, #MainContent, [role='main']");
    if (main) {
      main.innerHTML = "";
      main.appendChild(box);
      main.style.setProperty("visibility", "visible", "important");
    } else {
      document.body.innerHTML = "";
      document.body.appendChild(box);
    }
  }

  // IP keys: ask the server once per session; reload if it unlocks anything.
  function checkIp() {
    var ids = (lr.remote || []).filter(function (c) { return c.t === "ip"; }).map(function (c) { return c.id; });
    if (!ids.length) return false;
    var flag = "lockrules-ip:" + ids.join(",");
    try {
      if (sessionStorage.getItem(flag)) return false;
      sessionStorage.setItem(flag, "1");
    } catch (e) {}
    proxy("/ip", { uids: ids })
      .then(function (res) {
        if (res.ok && res.tokens && res.tokens.length) return saveTokens(res.tokens).then(unlocked());
        if (lr.action === "redirect" && lr.redirectUrl) location.replace(lr.redirectUrl);
      })
      .catch(function () {});
    return true;
  }

  function run() {
    if (lr.denied) {
      var pendingIp = checkIp();
      if (lr.action === "redirect" && lr.redirectUrl && !pendingIp) {
        var others = (lr.remote || []).filter(function (c) { return c.t !== "ip"; });
        if (!others.length) return location.replace(lr.redirectUrl);
      }
      renderDenied();
    }
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
