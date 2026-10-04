// Loupe story page. Scroll drives one framed canvas through four beats; the numbers come from
// aggregates/story.json, written at build time from the same parquet files the dashboard queries.
import { gsap } from "https://cdn.jsdelivr.net/npm/gsap@3.12.5/+esm";
import ScrollTrigger from "https://cdn.jsdelivr.net/npm/gsap@3.12.5/ScrollTrigger/+esm";
import Lenis from "https://cdn.jsdelivr.net/npm/lenis@1.1.18/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { geoEqualEarth, geoPath } from "https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm";

const LAND_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json";
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
  if (r1) r1.textContent = `${fmtInt.format(s.conversations)} conversations`;
  if (r2) r2.textContent = `${mon(s.date_min)} – ${mon(s.date_max)} · aggregates only`;
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
    s.one_and_done_recent != null ? `<b>${pct0(s.one_and_done_recent)}</b>end after one turn` : `<b>–</b>no friction data`,
  ];
  document.querySelectorAll(".qtile .qanswer").forEach((el, i) => (el.innerHTML = answers[i]));
  const rows = [
    ["01", "Who uses it?", "app/#overview", `<b>${fmtInt.format(s.peak_weekly_pseudo_users)}</b> pseudo-users in the busiest week${s.largest_country ? `; ${esc(s.largest_country)} is the largest country at ${pct0(s.largest_country_share)}` : ""}`],
    ["02", "How intensely?", "app/#intensity", s.return_rate != null ? `<b>${pct(s.return_rate)}</b> came back the following week; the top 10% of pseudo-users produce ${pct0(s.top10_share)} of conversations` : "return not yet measurable"],
    ["03", "For what?", "app/#intent", top ? `<b>${esc(top.intent)}</b> ${pct0(top.share)}${second ? `, then ${esc(second.intent)} ${pct0(second.share)}` : ""}, across seven intent classes` : "intent labels not in this build"],
    ["04", "Where does it fail them?", "app/#friction", s.one_and_done_recent != null ? `<b>${pct0(s.one_and_done_recent)}</b> of recent conversations end after one turn; refusals, corrections and repeats are tracked per intent and model` : "friction proxies not yet computed"],
  ];
  const ledger = $("#ledger");
  if (ledger) ledger.innerHTML = rows.map(([n, q, href, a]) => `<li><a href="${href}"><span class="n">${n}</span><span class="q">${q}</span><span class="a">${a}</span><span class="arr" aria-hidden="true">↗</span></a></li>`).join("");
  drawSparkline(s.weekly || []);
}

// The glass: every week of traffic as one quiet line.
function drawSparkline(weekly) {
  const glass = $("#lens-chart");
  if (!glass || !weekly.length) return;
  const W = 200, H = 120, pad = 6;
  const max = Math.max(...weekly.map(([, n]) => n)) || 1;
  const pts = weekly.map(([, n], i) => [pad + (i / (weekly.length - 1)) * (W - 2 * pad), H - pad - (n / max) * (H - 2 * pad)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts.at(-1)[0].toFixed(1)} ${H - pad} L${pts[0][0].toFixed(1)} ${H - pad} Z`;
  glass.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path class="area" d="${area}"/><path class="line" d="${line}"/></svg>`;
}

// The world: land from a public topology, one dot per country sized by conversations.
async function drawWorld(s) {
  const mapEl = $("#story-map");
  if (!mapEl || !s) return [];
  const dots = (s.countries || []).filter((c) => CENTROIDS[c.country]).map((c) => ({ ...c, lonlat: CENTROIDS[c.country] }));
  let land = null;
  try {
    const topo = await (await fetch(LAND_URL)).json();
    land = topojson.feature(topo, topo.objects.land);
  } catch { /* no land, the dots still tell the story */ }
  const W = 960, H = 500;
  const projection = geoEqualEarth();
  if (land) projection.fitSize([W, H], land); else projection.fitSize([W, H], { type: "Sphere" });
  const path = geoPath(projection);
  const maxN = Math.max(1, ...dots.map((d) => d.n));
  const circles = dots.map((d) => {
    const [x, y] = projection(d.lonlat);
    const r = 3 + 20 * Math.sqrt(d.n / maxN);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"><title>${esc(d.country)}: ${fmtInt.format(d.n)} conversations</title></circle>`;
  }).join("");
  mapEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${land ? `<path class="land" d="${path(land)}"/>` : ""}${circles}</svg>`;
  // Zoom out from the busiest country: the first dot is the largest.
  if (dots.length) {
    const [x, y] = projection(dots[0].lonlat);
    mapEl.style.setProperty("--focus", `${(100 * x / W).toFixed(1)}% ${(100 * y / H).toFixed(1)}%`);
  }
  return [...mapEl.querySelectorAll("circle")];
}

// ---------- the scroll story ----------
// Progress p runs 0..1 across the pinned section. Each beat owns a slice; the frame slides right to make
// room for the text once the first beat has had the screen to itself.
// Illustrative only: not from the dataset. The logs keep a conversation's shape, never its words.
const USER_TEXT = "Can you tighten the opening of my cover letter? It feels long.";
const BOT_TEXT = "Yes. Lead with the role and the one result you're proudest of, then cut the sentence about your background. Want me to draft two versions?";

const LOG_FIELDS = ["ts", "model", "ip", "country", "turns", "len"];
function typeInto(p) {
  const u = $("#u-text"), b = $("#b-text"), uc = $("#u-caret"), bc = $("#b-caret"), typing = $("#b-typing"), stage = $("#stage");
  if (!u || !b) return;
  // 0 .. 0.11: the log line, one field lighting up at a time with its meaning
  const lit = Math.floor(seg(p, 0.01, 0.1) * (LOG_FIELDS.length + 0.999));
  document.querySelectorAll(".lf, .ltag").forEach((e) => e.classList.toggle("lit", LOG_FIELDS.indexOf(e.dataset.f) < lit));
  stage.classList.toggle("to-chat", p > 0.115);
  // 0.12 .. 0.26: the line becomes the conversation it describes
  const uN = Math.round(seg(p, 0.125, 0.175) * USER_TEXT.length);
  const botOn = p > 0.18;
  const bN = Math.round(seg(p, 0.195, 0.25) * BOT_TEXT.length);
  u.textContent = USER_TEXT.slice(0, uN);
  uc.hidden = !(uN > 0 && uN < USER_TEXT.length);
  stage.classList.toggle("bot-on", botOn);
  typing.hidden = !(botOn && bN === 0);
  b.textContent = BOT_TEXT.slice(0, bN);
  bc.hidden = !(bN > 0 && bN < BOT_TEXT.length);
}

const CAPTIONS = [
  "fig. 1 — one conversation. the logs keep its shape, never its words",
  "fig. 2 — one dot per country, sized by conversations",
  "fig. 3 — the dashboard a product owner has today",
  "fig. 4 — the same logs, read through the glass",
];

function finalFrame() {
  const stage = $("#stage");
  if (!stage) return;
  stage.dataset.beat = "4"; stage.classList.add("typed", "to-chat"); typeInto(1);
  stage.style.setProperty("--zoom", "1"); stage.style.setProperty("--gray", "0.6"); stage.style.setProperty("--lens", "1");
  document.querySelectorAll("#story-map circle").forEach((c) => c.classList.add("on"));
  document.querySelectorAll(".qtile").forEach((t) => t.classList.add("answered"));
  document.querySelectorAll(".caption").forEach((b) => b.classList.toggle("is-active", b.dataset.beat === "4"));
  $("#story")?.setAttribute("data-beat", "4");
  const cap = $("#frame-caption"); if (cap) cap.textContent = CAPTIONS[3];
}

function bindStory(circles) {
  const pin = $("#story"), stage = $("#stage"), caption = $("#frame-caption");
  const panels = [...document.querySelectorAll(".caption")];
  const tiles = [...document.querySelectorAll(".qtile")];
  const render = (p) => {
    const beat = p < 0.26 ? 1 : p < 0.54 ? 2 : p < 0.74 ? 3 : 4;
    if (stage.dataset.beat !== String(beat)) { stage.dataset.beat = String(beat); pin.dataset.beat = String(beat); if (caption) caption.textContent = CAPTIONS[beat - 1]; }
    typeInto(p);
    // beat 2: zoom out, then bloom the dots largest-first
    stage.style.setProperty("--zoom", String(3.2 - 2.2 * seg(p, 0.26, 0.37)));
    const bloom = Math.round(seg(p, 0.35, 0.52) * circles.length);
    circles.forEach((c, i) => c.classList.toggle("on", i < bloom));
    // beat 3: the world drains; beat 4: colour returns as the lens arrives
    stage.style.setProperty("--gray", String(beat === 3 ? seg(p, 0.54, 0.62) : beat === 4 ? 1 - 0.4 * seg(p, 0.74, 0.84) : 0));
    stage.style.setProperty("--lens", String(seg(p, 0.74, 0.86)));
    tiles.forEach((t, i) => t.classList.toggle("answered", p > 0.85 + i * 0.03));
    panels.forEach((c) => c.classList.toggle("is-active", c.dataset.beat === String(beat)));
  };
  if (reduced()) { finalFrame(); return; }

  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  ScrollTrigger.create({
    trigger: pin, start: "top top", end: "+=520%", pin: true, scrub: true, anticipatePin: 1,
    onUpdate: (self) => render(self.progress),
  });
  render(0);
  // in-page links scroll smoothly through Lenis
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const target = document.querySelector(a.getAttribute("href"));
    if (target) { e.preventDefault(); lenis.scrollTo(target, { offset: 0 }); }
  }));
}

async function fillBuilt() {
  try {
    const rc = await (await fetch(new URL("aggregates/routing_counterfactual.json", import.meta.url))).json();
    const p = rc.eras.B.policies;
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set("#b-base", pct(p.baseline_actual_mix.one_and_done_rate)); set("#b-ca", pct(p.cost_aware.one_and_done_rate));
    set("#b-cost", `${p.cost_aware.cost_change_pct >= 0 ? "+" : ""}${Math.round(100 * p.cost_aware.cost_change_pct)}%`);
  } catch { /* strip keeps its build-time text */ }
}

// A reload must land on the headline, not on a scroll offset the browser remembered from an older layout.
try { history.scrollRestoration = "manual"; } catch { /* unsupported */ }
if (!location.hash) scrollTo(0, 0);

(async () => {
  const story = await loadStory();
  fillBuilt();
  fill(story);
  readout(story);
  const circles = await drawWorld(story);
  bindStory(circles);
})();
