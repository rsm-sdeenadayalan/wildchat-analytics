// Loupe story page: the hero with its live loupe, and the ledger below the film (the film itself is film.js); the numbers come from
// aggregates/story.json, written at build time from the same parquet files the dashboard queries.

const $ = (s) => document.querySelector(s);
const fmtInt = new Intl.NumberFormat("en-US");
const pct = (x, d = 1) => (x == null ? "–" : (100 * x).toFixed(d) + "%");
const pct0 = (x) => pct(x, 0);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// Approximate centroids for the countries that appear in the logs, spelled as the dataset spells them.
const CENTROIDS = {
  "United States": [-98, 39], Russia: [95, 62], China: [104, 35], Germany: [10.4, 51.2], "United Kingdom": [-2, 54], Japan: [138, 36.5],
  Vietnam: [106, 16], "Hong Kong": [114.2, 22.3], India: [79, 22], France: [2.5, 46.5], "South Korea": [127.8, 36.5], Brazil: [-52, -11],
  Canada: [-100, 58], Taiwan: [121, 23.7], Australia: [134, -25], Italy: [12.5, 42.5], Spain: [-3.7, 40.2], "The Netherlands": [5.3, 52.2],
  Singapore: [103.8, 1.35], Egypt: [30, 27], Iran: [53, 32.5], Ukraine: [31, 49], Poland: [19.5, 52], Mexico: [-102, 23.5], Indonesia: [118, -2],
  "Türkiye": [35, 39], "DR Congo": [23.5, -3], Sweden: [16, 62], Morocco: [-6, 32], Philippines: [122, 12.5], Argentina: [-64, -34], Romania: [25, 46],
  "South Africa": [25, -29], Switzerland: [8.2, 46.8], Colombia: [-73, 4], Belarus: [28, 53.5], Finland: [26, 64], "Saudi Arabia": [45, 24],
  "New Zealand": [172, -41], Algeria: [3, 28], Nigeria: [8, 9.5], Pakistan: [69, 30], Thailand: [101, 15], Malaysia: [102, 4], Israel: [35, 31.5],
  Portugal: [-8, 39.5], Belgium: [4.5, 50.6], Austria: [14.5, 47.5], Czechia: [15.5, 49.8], Greece: [22, 39], Hungary: [19.5, 47.2], Norway: [9, 61],
  Denmark: [10, 56], Ireland: [-8, 53.3], Chile: [-71, -35], Peru: [-75, -10], Venezuela: [-66, 8], Kazakhstan: [67, 48], Bangladesh: [90, 24],
  Kenya: [38, 0.5], Ethiopia: [39, 9], Iraq: [44, 33], "United Arab Emirates": [54, 24], Serbia: [21, 44], Bulgaria: [25.5, 42.7], Slovakia: [19.5, 48.7],
  Croatia: [16, 45.5], Lithuania: [24, 55.3], Latvia: [25, 57], Estonia: [25.5, 58.7], Georgia: [43.5, 42], Armenia: [45, 40.2], Azerbaijan: [47.5, 40.4],
  Uzbekistan: [64, 41.5], Mongolia: [104, 46.5], Nepal: [84, 28.2], "Sri Lanka": [80.7, 7.8], Myanmar: [96, 19.5], Cambodia: [105, 12.5], Tunisia: [9.5, 34],
  Ghana: [-1.2, 7.9], Tanzania: [35, -6.4], Uganda: [32.5, 1.4], Cameroon: [12.5, 5.7], "Ivory Coast": [-5.5, 7.5], Senegal: [-14.5, 14.5], Jordan: [36.5, 31.2],
  Lebanon: [35.8, 33.9], Qatar: [51.2, 25.3], Kuwait: [47.8, 29.3], Oman: [56, 21], Yemen: [48, 15.5], Cuba: [-79.5, 21.5], Ecuador: [-78.5, -1.5], Bolivia: [-64.5, -16.5],
  Uruguay: [-56, -33], Paraguay: [-58.5, -23.5], Guatemala: [-90.5, 15.5], "Dominican Republic": [-70.5, 19], "Puerto Rico": [-66.5, 18.2], Iceland: [-18, 65],
};

// ---------- live readout: what the page is built from ----------
function readout(s) {
  if (!s) return;
  const r1 = $("#r1"), r2 = $("#r2");
  const mon = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  if (r1) {
    if (reduced()) r1.textContent = `${fmtInt.format(s.conversations)} conversations`;
    else {
      const t0 = performance.now(), D = 1600;
      const step = (t) => { const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
        r1.textContent = `${fmtInt.format(Math.round(s.conversations * e))} conversations`; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
  }
  if (r2) r2.textContent = `${mon(s.date_min)} – ${mon(s.date_max)} · summary counts only`;
}

// ---------- numbers ----------
async function loadStory() {
  try { return await (await fetch(new URL("aggregates/story.json", import.meta.url))).json(); } catch { return null; }
}

function fill(s) {
  if (!s) return;
  const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  set("#s-users", fmtInt.format(s.peak_weekly_pseudo_users));
  set("#s-countries", fmtInt.format(s.n_countries));
  set("#s-total", fmtInt.format(s.conversations));
  const top = s.intents?.[0], second = s.intents?.[1];
  const answers = [
    `<b>${fmtInt.format(s.peak_weekly_pseudo_users)}</b>pseudo-users, busiest week`,
    s.return_rate != null ? `<b>${pct(s.return_rate)}</b>came back the next week` : `<b>–</b>return not measurable`,
    top ? `<b>${pct0(top.share)}</b>${esc(top.intent)}, the largest use` : `<b>–</b>no intent labels`,
    s.worst_repeat_rate != null ? `<b>${pct(s.worst_repeat_rate)}</b>of ${esc(s.worst_repeat_intent)} conversations repeat the request` : `<b>–</b>no friction data`,
  ];
  document.querySelectorAll(".qtile .qanswer").forEach((el, i) => (el.innerHTML = answers[i]));
  const country = (c) => (/^(United|Netherlands|Philippines|Czech)/.test(c) ? `The ${c}` : c);
  const kind = (k, capital = false) => { const t = String(k).replace(/_/g, " "); return capital ? t[0].toUpperCase() + t.slice(1) : t; };
  const rows = [
    ["01", "Who uses it?", "app/#overview", `<b>${fmtInt.format(s.peak_weekly_pseudo_users)}</b> people in the busiest week (an estimate: each person is an anonymised network-and-browser signature)${s.largest_country ? `; ${esc(country(s.largest_country))} is the largest country, at ${pct0(s.largest_country_share)}` : ""}`],
    ["02", "How often do they come back?", "app/#intensity", s.return_rate != null ? `<b>${pct(s.return_rate)}</b> came back the next week; the busiest 10% of people start ${pct0(s.top10_share)} of all conversations` : "return not yet measurable"],
    ["03", "What do they use it for?", "app/#intent", top ? `<b>${esc(kind(top.intent, true))}</b> (${pct0(top.share)}), then ${second ? `${esc(kind(second.intent))} (${pct0(second.share)})` : "others"}, out of seven kinds of request` : "not available in this build"],
    ["04", "Where does it fail them?", "app/#friction", s.worst_repeat_rate != null ? `In <b>${esc(kind(s.worst_repeat_intent))}</b>, ${pct(s.worst_repeat_rate)} of conversations have someone repeat the same request, the most of any kind of request. Repeats and corrections are the two failure signals that held up when checked against labelled conversations` : "not yet computed"],
  ];
  const ledger = $("#ledger");
  if (ledger) ledger.innerHTML = rows.map(([n, q, href, a]) => `<li><a href="${href}"><span class="n">${n}</span><span class="q">${q}</span><span class="a">${a}</span><span class="arr" aria-hidden="true">→</span></a></li>`).join("");
}


function kinetic(el, start = 0) {
  let i = start;
  const walk = (node) => {
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 3) {
        const parts = n.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const part of parts) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(part); continue; }
          const w = document.createElement("span"); w.className = "w"; w.style.setProperty("--i", i++); w.textContent = part; frag.append(w);
        }
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.id) {
        const w = document.createElement("span"); w.className = "w"; w.style.setProperty("--i", i++); n.replaceWith(w); w.append(n);
      } else if (n.nodeType === 1) walk(n);
    }
  };
  walk(el);
  return i;
}

// ---------- the hero: a real loupe ----------
// A magnifying glass that appears only while a pointer moves over the masthead, follows it, and magnifies the text
// beneath it; it stays wholly inside the masthead and leaves when the pointer does. No drifting on its own, and none on
// touch screens, so it never competes with reading. The glass shows a copy of the masthead scaled about the point
// beneath it, so what you see through it is the page, magnified.
function heroLoupe() {
  const mast = $("#masthead"), content = $("#mast-content"), mag = $("#mag"), view = $("#mag-view");
  const h1 = mast?.querySelector("h1");
  if (h1) kinetic(h1);
  if (!mast || !content || !mag || !view || reduced() || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const clone = content.cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
  view.append(clone);
  const K = 1.8;
  let x = 0, y = 0, tx = 0, ty = 0, active = false, running = false;
  const clampIn = (px, py) => {
    const D = mag.offsetWidth, W = mast.clientWidth, H = mast.clientHeight, m = 10;
    const handle = D * 0.45;  // the handle reaches down and right of the glass
    const bar = $(".topbar")?.offsetHeight || 0;  // never under the fixed top bar
    return [Math.max(D / 2 + m, Math.min(px, W - D / 2 - handle * 0.75 - m)), Math.max(bar + D / 2 + m, Math.min(py, H - D / 2 - handle * 0.75 - m))];
  };
  const place = () => {
    const D = mag.offsetWidth;
    mag.style.transform = `translate(${(x - D / 2).toFixed(1)}px, ${(y - D / 2).toFixed(1)}px)`;
    clone.style.width = `${content.offsetWidth}px`;
    clone.style.left = `${(content.offsetLeft - (x - D / 2)).toFixed(1)}px`;
    clone.style.top = `${(content.offsetTop - (y - D / 2)).toFixed(1)}px`;
    clone.style.transformOrigin = `${(x - content.offsetLeft).toFixed(1)}px ${(y - content.offsetTop).toFixed(1)}px`;
    clone.style.transform = `scale(${K})`;
  };
  const loop = () => {
    x += (tx - x) * 0.25; y += (ty - y) * 0.25;
    place();
    if (active || Math.abs(tx - x) + Math.abs(ty - y) > 0.5) requestAnimationFrame(loop); else running = false;
  };
  mast.addEventListener("pointermove", (e) => {
    const m = mast.getBoundingClientRect();
    [tx, ty] = clampIn(e.clientX - m.left, e.clientY - m.top);
    if (!active) { active = true; mag.classList.add("on"); if (!running) { x = tx; y = ty; } }
    if (!running) { running = true; requestAnimationFrame(loop); }
  });
  mast.addEventListener("pointerleave", () => { active = false; mag.classList.remove("on"); });
}

// A reload must land on the headline, not on a scroll offset the browser remembered from an older layout.
try { history.scrollRestoration = "manual"; } catch { /* unsupported */ }
if (!location.hash) scrollTo(0, 0);

// The fixed readout belongs to the top of the page; it steps aside once the reader scrolls past the masthead.
(() => { const r = $("#readout"); if (!r) return;
  const tick = () => r.classList.toggle("is-hidden", scrollY > 260);
  addEventListener("scroll", tick, { passive: true }); tick(); })();

(async () => {
  heroLoupe();
  const story = await loadStory();
  fill(story);
  readout(story);
})();
