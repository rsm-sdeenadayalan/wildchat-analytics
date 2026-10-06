/* Site analytics (PostHog, US cloud). This measures how the Loupe site itself is used: where
   visitors come from, how far they get through the story, which dashboard views and controls
   they touch, which documents they read. It has nothing to do with the WildChat data, which is
   never tracked at row level anywhere on this site. Disclosed in the page footers. */
(function () {
  var KEY = "phc_ydvidFEvJSMdK4wAXyNiTCBJiqhQwHi8MsrPgq66cuQH";
  var HOST = "https://us.i.posthog.com";
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    // Local previews never count as visits. Keep the API so the pages behave identically.
    window.loupeTrack = function () {};
    return;
  }

  /* official PostHog snippet */
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    session_recording: { maskAllInputs: true },
  });

  var page = location.pathname.indexOf("/app/") === 0 ? "dashboard" : location.pathname.indexOf("/docs/") === 0 ? "docs" : "story";
  posthog.register({ loupe_page: page });

  window.loupeTrack = function (name, props) {
    try { posthog.capture(name, props || {}); } catch (e) { /* analytics must never break the page */ }
  };

  /* Outbound and call-to-action links: which destinations visitors actually take. */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var label = a.getAttribute("data-track") || null;
    var href = a.getAttribute("href") || "";
    if (/resume\.pdf/.test(href)) label = label || "resume";
    else if (/github\.com/.test(href)) label = label || "github";
    else if (/shankard\.com/.test(href)) label = label || "personal_site";
    else if (/^(\.\.\/)?app\//.test(href) || /\/app\//.test(href)) label = label || "open_dashboard";
    else if (/^(\.\.\/)?docs\//.test(href) || /\/docs\//.test(href)) label = label || "open_docs";
    if (label) window.loupeTrack("link_click", { label: label, href: href, text: (a.textContent || "").trim().slice(0, 60) });
  }, true);

  /* Story progress: each beat reached, once per page view. */
  var stage = document.getElementById("stage");
  if (stage && window.MutationObserver) {
    var seen = {};
    function beat() {
      var b = stage.getAttribute("data-beat");
      if (b && !seen[b]) { seen[b] = true; window.loupeTrack("story_beat_reached", { beat: Number(b) }); }
    }
    beat();  // the page opens on beat 1; record it, or beat 1 is only counted when someone scrolls back up
    new MutationObserver(beat).observe(stage, { attributes: true, attributeFilter: ["data-beat"] });
  }

  /* Reading depth on documents and the story page: 50% and 90% of the page. */
  var marks = { 50: false, 90: false };
  function depth() {
    var h = document.documentElement.scrollHeight - innerHeight;
    if (h <= 0) return;
    var pct = (scrollY / h) * 100;
    [50, 90].forEach(function (m) {
      if (!marks[m] && pct >= m) { marks[m] = true; window.loupeTrack("read_depth", { percent: m, title: document.title }); }
    });
  }
  addEventListener("scroll", depth, { passive: true });
})();
