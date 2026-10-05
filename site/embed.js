/* Runs only when Loupe is shown inside the shankard.com desktop (an embedded window there).
   It tells that window which Loupe page is showing, so its Back / Forward / address bar work,
   and sends links that leave Loupe to a new tab instead of loading inside the desktop window.
   Opened directly, Loupe ignores this file entirely. */
(function () {
  if (window.parent === window) return;
  var DESKTOPS = ["https://shankard.com"];
  function report() {
    var msg = { type: "loupe:nav", href: location.href, title: document.title };
    DESKTOPS.forEach(function (origin) {
      try { window.parent.postMessage(msg, origin); } catch (e) { /* not that parent */ }
    });
  }
  report();
  addEventListener("hashchange", report);
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.target || !a.host || a.host === location.host) return;
    a.target = "_blank";
    a.rel = "noopener";
  });
})();
