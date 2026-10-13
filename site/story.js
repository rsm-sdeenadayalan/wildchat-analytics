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
    s.worst_repeat_rate != null ? `<b>${pct(s.worst_repeat_rate)}</b>of ${esc(s.worst_repeat_intent)} conversations repeat the request` : `<b>–</b>no friction data`,
  ];
  document.querySelectorAll(".qtile .qanswer").forEach((el, i) => (el.innerHTML = answers[i]));
  const rows = [
    ["01", "Who uses it?", "app/#overview", `<b>${fmtInt.format(s.peak_weekly_pseudo_users)}</b> pseudo-users in the busiest week${s.largest_country ? `; ${esc(s.largest_country)} is the largest country at ${pct0(s.largest_country_share)}` : ""}`],
    ["02", "How intensely?", "app/#intensity", s.return_rate != null ? `<b>${pct(s.return_rate)}</b> came back the following week; the top 10% of pseudo-users produce ${pct0(s.top10_share)} of conversations` : "return not yet measurable"],
    ["03", "For what?", "app/#intent", top ? `<b>${esc(top.intent)}</b> ${pct0(top.share)}${second ? `, then ${esc(second.intent)} ${pct0(second.share)}` : ""}, across seven intent classes` : "intent labels not in this build"],
    ["04", "Where does it fail them?", "app/#friction", s.worst_repeat_rate != null ? `In <b>${esc(s.worst_repeat_intent)}</b>, ${pct(s.worst_repeat_rate)} of conversations repeat the same request, the highest of any intent; repeats and corrections are the two signals that survived validation, tracked per intent and model` : "friction proxies not yet computed"],
  ];
  const ledger = $("#ledger");
  if (ledger) ledger.innerHTML = rows.map(([n, q, href, a]) => `<li><a href="${href}"><span class="n">${n}</span><span class="q">${q}</span><span class="a">${a}</span><span class="arr" aria-hidden="true">→</span></a></li>`).join("");
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
  // The grey copy the world drains into (beats 3-5), cross-faded with opacity so the GPU does the work.
  const gray = mapEl.cloneNode(true);
  gray.removeAttribute("id"); gray.classList.add("map-gray");
  mapEl.after(gray);
  // Zoom out from the busiest country: the first dot is the largest.
  if (dots.length) {
    const [x, y] = projection(dots[0].lonlat);
    gray.style.setProperty("--focus", `${(100 * x / W).toFixed(1)}% ${(100 * y / H).toFixed(1)}%`);
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
  "fig. 5 — real WildChat numbers: coding conversations with a repeated request or a correction, on each model",
  "fig. 6 — the people who used both models. heavier users, so both rates are higher; what matters is that they match",
  "fig. 7 — your logs, read in the browser",
  "fig. 8 — one conversation, labelled · words illustrative",
  "fig. 9 — outputs from the sample log on the try page",
];
// One pin carries the whole sequence, in three acts measured in % of the viewport:
//   the WildChat story (beats 1-4), the finding a dashboard gets wrong (beats 5-6), and, after the loupe dives into
//   its own glass, the same lens on your logs (beats 7-9).
const PIN = { story: 340, wow: 160, how: 170 };  // about 6.7 screens in all; longer felt like a chore
const PIN_LENGTH = PIN.story + PIN.wow + PIN.how;
const AT_WOW = PIN.story / PIN_LENGTH, AT_HOW = (PIN.story + PIN.wow) / PIN_LENGTH, DIVE = 0.3;  // the dive gets a real share of its step
const ease = (t) => t * t * (3 - 2 * t);

function finalFrame() {
  const stage = $("#stage");
  if (!stage) return;
  stage.dataset.beat = "5"; stage.classList.add("typed", "to-chat"); typeInto(1);
  stage.style.setProperty("--zoom", "1"); stage.style.setProperty("--gray", "0.6"); stage.style.setProperty("--lens", "1");
  document.querySelectorAll("#story-map circle").forEach((c) => c.classList.add("on"));
  document.querySelectorAll(".qtile").forEach((t) => t.classList.add("answered"));
}

function setBeat(beat) {
  const pin = $("#story"), cap = $("#frame-caption");
  if (pin.dataset.beat === String(beat)) return;
  pin.dataset.beat = String(beat);
  if (cap) cap.textContent = CAPTIONS[beat - 1];
  document.querySelectorAll("#captions .caption").forEach((c) => c.classList.toggle("is-active", c.dataset.beat === String(beat)));
}

// The pin is created at once, before any data arrives: a reader who starts scrolling while the map is still
// downloading must not have the page jump when the pin appears. Data fills `ctx` later and the frame catches up.
function bindStory(ctx) {
  const pin = $("#story"), stage = $("#stage");
  const tiles = [...document.querySelectorAll(".qtile")];
  // The loupe's entrance: one straight, unhurried glide in from the right on its own clock, and the four answers
  // fade in one after another as it settles. Time-based, so a pause never leaves it parked at the edge of the frame.
  const lens = $(".lens");
  let lastStoryBeat = 1, lastStoryP = 0, sweeping = null, sweepTimers = [];
  const answer = (n) => tiles.forEach((t, i) => t.classList.toggle("answered", i < n));
  const stopSweep = () => { sweeping?.cancel(); sweeping = null; sweepTimers.forEach(clearTimeout); sweepTimers = []; };
  const settleSweep = () => { stopSweep(); answer(tiles.length); };
  const unsweep = () => { stopSweep(); answer(0); };
  const sweep = () => {
    unsweep();
    if (!lens?.animate) { answer(tiles.length); return; }
    const D = 1100;
    sweeping = lens.animate([
      { transform: `translateX(${Math.round(stage.clientWidth * 0.32)}px)`, opacity: 0 },
      { transform: "translateX(0px)", opacity: 1 },
    ], { duration: D, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" });
    sweepTimers = tiles.map((_, i) => setTimeout(() => answer(i + 1), 450 + i * 140));
    // hand the lens back to CSS at rest (the same position), so later beats can move it with their own variables
    const mine = sweeping;
    mine.finished.then(() => { if (sweeping === mine) { mine.cancel(); sweeping = null; } }).catch(() => {});
  };
  const story = (p) => {
    const beat = p < 0.26 ? 1 : p < 0.54 ? 2 : p < 0.74 ? 3 : 4;
    typeInto(p);
    // beat 2: zoom out, then bloom the dots largest-first
    stage.style.setProperty("--zoom", String(3.2 - 2.2 * seg(p, 0.26, 0.37)));
    const bloom = Math.round(seg(p, 0.35, 0.52) * ctx.circles.length);
    ctx.circles.forEach((c, i) => c.classList.toggle("on", i < bloom));
    // beat 3: the world drains; beat 4: colour returns as the lens arrives
    stage.style.setProperty("--gray", String(beat === 3 ? seg(p, 0.54, 0.62) : beat === 4 ? 1 - 0.4 * seg(p, 0.74, 0.84) : 0));
    // beat 4: the lens is either fully in (and the tiles answered) or not there at all; its entrance is the sweep
    stage.style.setProperty("--lens", beat >= 4 ? "1" : "0");
    if (beat >= 4 && lastStoryBeat <= 3) {
      // arriving at beat 4 by scrolling forward plays the sweep; a jump (reload, link, fast drag) lands finished
      if (Math.abs(p - lastStoryP) < 0.25) sweep(); else settleSweep();
    } else if (beat <= 3 && lastStoryBeat >= 4) unsweep();
    lastStoryBeat = beat; lastStoryP = p;
    return beat;
  };
  const render = (p) => {
    let beat = story(Math.min(1, p / AT_WOW));
    if (p > AT_WOW) {
      const w = seg(p, AT_WOW, AT_HOW);
      // the lens steps aside for the finding and comes back for the dive
      // out at the start (slides away as before); back at the end by fading and growing in place, not by travelling
      const back = seg(w, 0.84, 1);
      stage.style.setProperty("--lens", w > 0.5 ? "1" : String(1 - seg(w, 0, 0.07)));
      stage.style.setProperty("--lens-in", back.toFixed(3));
      stage.classList.toggle("lens-return", w > 0.5);
      ctx.wow?.(w);
      // the lens clears out first (w < 0.07), then the finding and its caption arrive together
      beat = w < 0.07 ? 4 : w < 0.66 ? 5 : 6;  // the caption turns to 6 only once the gap has finished collapsing
    } else { ctx.wow?.(0); stage.classList.remove("lens-return"); }
    const stageBeat = p > AT_WOW && beat >= 5 ? "5" : String(Math.min(beat, 4));
    if (stage.dataset.beat !== stageBeat) stage.dataset.beat = stageBeat;
    const hp = seg(p, AT_HOW, 1);
    const step = ctx.how ? ctx.how(hp) : 0;
    setBeat(hp > 0 && ctx.how ? 6 + step : beat);
  };
  // The loupe rests beside the tiles, never on an answer: off the bottom-right corner where there is room to the
  // right (desktop), just below the tiles where there is not (phone). Placed from the tiles' own layout, so it holds
  // at every screen size; the dive later opens from wherever the glass is.
  const placeLens = () => {
    const lens = $(".lens"), t = [...document.querySelectorAll(".qtile")];
    if (!lens || t.length < 4) return;
    const w = lens.offsetWidth, r = w * 0.633 / 2, o = w * 0.4167;  // glass radius, glass centre within the lens box
    const sw = stage.clientWidth, sh = stage.clientHeight;
    // the bottom-right corner of the last tile, in scene 4's layout: the tile grid there is shifted (-9%, -5%) and
    // scaled 0.92 about its centre (story.css, .canvas[data-beat="4"] .scene-tiles)
    const scene = t[3].offsetParent, W = scene.offsetWidth, H = scene.offsetHeight;
    const px = t[3].offsetLeft + t[3].offsetWidth, py = t[3].offsetTop + t[3].offsetHeight;
    const shift = matchMedia("(min-width: 901px)").matches;  // the shift is desktop-only (story.css)
    const k = shift ? 0.92 : 1, dx = shift ? -0.09 * W : 0, dy = shift ? -0.05 * H : 0;
    const right = scene.offsetLeft + W / 2 + (px - W / 2) * k + dx;
    const bottom = scene.offsetTop + H / 2 + (py - H / 2) * k + dy;
    let cx, cy;
    if (sw - right >= 1.15 * r) { cx = right + 0.4 * r; cy = bottom - 0.7 * r; }
    else { cx = right - 1.1 * r; cy = bottom + 0.8 * r; }
    cx = Math.max(r + 8, Math.min(cx, sw - r - 8));
    cy = Math.max(r + 8, Math.min(cy, sh - r - 44));  // keep the glass clear of the figure caption
    lens.style.left = `${Math.round(cx - o)}px`;
    lens.style.top = `${Math.round(cy - o)}px`;
  };
  placeLens(); addEventListener("resize", placeLens); document.fonts?.ready.then(placeLens);
  if (reduced()) { ctx.render = () => { finalFrame(); ctx.wow?.(1); ctx.how?.(1); setBeat(9); }; ctx.render(); return; }

  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({ lerp: 0.16, smoothWheel: true, wheelMultiplier: 0.9 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  const st = ScrollTrigger.create({
    trigger: pin, start: "top top", end: `+=${PIN_LENGTH}%`, pin: true, scrub: true,  // no anticipatePin: it jumps the page when the pin engages
    onUpdate: (self) => render(self.progress),
    onToggle: (self) => document.body.classList.toggle("in-story", self.isActive),  // the top bar steps aside
  });
  ctx.render = () => render(st.progress);

  // Full screen: as the section reaches the top, the frame opens from a card to the whole viewport and the
  // captions fade in over it.
  const frame = $("#frame");
  const expand = (e) => {
    const k = 1 - ease(e);
    frame.style.setProperty("--fy", `${(k * 12).toFixed(2)}vh`);
    frame.style.setProperty("--fx", `${(k * 24).toFixed(1)}px`);
    frame.style.setProperty("--fb", `${(k * 4).toFixed(2)}vh`);
    frame.style.setProperty("--fr", `${(k * 18).toFixed(1)}px`);
    pin.style.setProperty("--cap-o", seg(e, 0.55, 1).toFixed(3));
  };
  // ...and on the way out it eases back into that rounded card as the page carries it off, mirroring the entrance.
  let enterE = 0, exitE = 0;
  const shape = () => expand(Math.min(enterE, 1 - exitE));
  ScrollTrigger.create({ trigger: pin, start: "top 80%", end: "top top", scrub: true, onUpdate: (self) => { enterE = self.progress; shape(); } });
  ScrollTrigger.create({ start: () => st.end, end: () => st.end + innerHeight * 0.6, scrub: true, onUpdate: (self) => { exitE = self.progress; shape(); } });
  shape();
  // Room for the captions above the scenes: the tallest caption, so nothing moves between parts.
  const fitCaptions = () => {
    // Part 9's buttons may reach into the top of its scene, which is empty there; the others set the line.
    const caps = [...document.querySelectorAll("#captions .caption")].filter((c) => c.dataset.beat !== "9");
    const tallest = Math.max(...caps.map((c) => c.offsetHeight));
    const top = parseFloat(getComputedStyle($("#captions")).paddingTop) || 0;
    pin.style.setProperty("--cap-h", `${Math.round(top + tallest + 14)}px`);
    placeLens();  // the scene area starts below the captions, so the tiles move with it
  };
  fitCaptions(); addEventListener("resize", fitCaptions); document.fonts?.ready.then(fitCaptions);

  // One scroll, one scene. A scroll gesture (a wheel flick, a trackpad swipe, a touch swipe, an arrow key) moves
  // exactly one scene, however long or hard it is, starting the moment it begins and always at the same pace.
  // A new scroll while a scene plays waits and plays next. At the first and last scene a gesture outward leaves the
  // story as normal.
  const STOPS = [0, 0.1, 0.25, 0.52, 0.7, 1].map((x) => x * AT_WOW)
    .concat([0.38, 0.8].map((x) => AT_WOW + x * (AT_HOW - AT_WOW)))
    .concat([0.5, 0.76, 0.995].map((x) => AT_HOW + x * (1 - AT_HOW)));  // just short of the end, where the pin is still active
  const pace = (t) => -(Math.cos(Math.PI * t) - 1) / 2;  // ease-in-out sine
  const inside = () => scrollY >= st.start - 2 && scrollY <= st.end + 2;
  let current = -1, busy = false, queued = null, moving = 0;  // moving: direction of the scene playing (+1 down, -1 up)
  const nearest = () => STOPS.reduce((best, x, i) => (Math.abs(x - st.progress) < Math.abs(STOPS[best] - st.progress) ? i : best), 0);
  // the scene after the one playing (or the one the reader is on), in a direction; -1 past either end
  const following = (d) => {
    const from = busy ? current : (() => { const p = st.progress; const i = nearest(); return Math.abs(STOPS[i] - p) < 0.004 ? i : (d > 0 ? STOPS.findIndex((x) => x > p) - 1 : STOPS.findLastIndex((x) => x < p) + 1); })();
    const i = from + d;
    return i >= 0 && i < STOPS.length ? i : -1;
  };
  const DIVE_STOP = STOPS.findIndex((x) => x > AT_HOW);  // the first scene of "your logs"
  const SCENE_SECONDS = 1.4;  // every scene plays at this pace, however the reader scrolled
  const go = (i) => {
    const prev = current;
    moving = Math.sign(STOPS[i] - st.progress) || moving;
    const diveStep = (i === DIVE_STOP && prev === DIVE_STOP - 1) || (i === DIVE_STOP - 1 && prev === DIVE_STOP);
    current = i; busy = true;
    pin.dataset.stop = String(i);
    lenis.scrollTo(st.start + STOPS[i] * (st.end - st.start), {
      // the step into "your logs" carries two moves (the loupe returning, then the dive), so it gets more time
      duration: diveStep ? 2.4 : SCENE_SECONDS, easing: pace, lock: true, force: true,
      onComplete: () => { busy = false; if (queued != null) { const q = queued; queued = null; go(q); } },
    });
  };
  // A new scroll during a scene is never lost: it plays its one scene as soon as the current one finishes, at the
  // same pace (at most one waits; it is one scroll, one scene, never two from one scroll).
  const request = (d) => {  // returns false when the gesture should leave the story instead
    if (busy && d !== moving) {
      // Reversing mid-scene takes effect at once: the glide turns around and goes back to the scene it left,
      // instead of finishing the way the reader no longer wants to go.
      queued = null;
      const i = current + d;
      if (i >= 0 && i < STOPS.length) go(i);
      return true;
    }
    if (busy) {
      if (queued == null) { const i = current + d; if (i >= 0 && i < STOPS.length) queued = i; }
      return true;
    }
    const i = following(d);
    if (i < 0) return false;  // past an end: leave the story
    go(i);
    return true;
  };
  // Wheel: one gesture is one scroll and moves one scene, however long or hard it is, momentum included. A gesture
  // starts after a pause of 240 ms, or when the scroll speed jumps sharply:
  // a trackpad's momentum only ever slows down, so a sharp rise is a new swipe even while the last one's momentum is
  // still arriving (it lasts longer than a scene). A steady scroll or one long swipe never jumps like that.
  let lastWheel = 0, gestureDir = 0, gestureIsPage = false;  // a gesture that leaves the story belongs to the page, all of it
  let speeds = [], peak = 0, slowed = false;
  const avg = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  // A new swipe needs the shape of one: the current scroll has visibly slowed (fallen under 40% of its peak) and then
  // the speed jumps past 2.2x. A swipe's own ramp-up, however long it takes, never slows first, so it never qualifies.
  const swipeStarts = () => {
    if (!slowed || speeds.length < 4) return false;
    const recent = avg(speeds.slice(-3)), before = avg(speeds.slice(-11, -3));
    return recent >= 6 && recent > 2.2 * before;
  };
  addEventListener("wheel", (e) => {
    if (e.ctrlKey || Math.abs(e.deltaY) < 1) return;
    const now = performance.now(), d = Math.sign(e.deltaY), mag = Math.abs(e.deltaY);
    const paused = now - lastWheel > 240;
    lastWheel = now;
    if (paused) speeds = [];
    speeds.push(mag); if (speeds.length > 12) speeds.shift();
    const fresh = paused || d !== gestureDir || swipeStarts();
    if (fresh) { speeds = [mag]; peak = mag; slowed = false; }
    else { peak = Math.max(peak, mag); if (mag < 0.4 * peak) slowed = true; }
    if (!inside()) { gestureDir = d; if (fresh) gestureIsPage = false; return; }  // the gesture is tracked before it arrives
    if (!fresh && !busy && current < 0) { go(d > 0 ? 1 : STOPS.length - 1); e.preventDefault(); e.stopImmediatePropagation(); return; }  // arrived mid-gesture
    if (fresh) {
      gestureDir = d;
      gestureIsPage = !request(d);
    }
    if (gestureIsPage) return;  // leaving the story: the whole gesture scrolls the page, not just its first event
    e.preventDefault(); e.stopImmediatePropagation();
  }, { passive: false, capture: true });
  // Touch: one swipe, one scene, taken as soon as the finger has clearly moved.
  let touchY = null, taken = false;
  addEventListener("touchstart", (e) => { touchY = e.touches[0].clientY; taken = false; }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (touchY == null || !inside()) return;
    const dy = touchY - e.touches[0].clientY;
    if (!taken) {
      if (Math.abs(dy) < 12) { e.preventDefault(); return; }
      taken = request(Math.sign(dy)) ? "story" : "page";
    }
    if (taken === "story") e.preventDefault();
  }, { passive: false });
  addEventListener("touchend", () => { touchY = null; }, { passive: true });
  addEventListener("keydown", (e) => {
    const d = { ArrowDown: 1, PageDown: 1, " ": e.shiftKey ? -1 : 1, ArrowUp: -1, PageUp: -1 }[e.key];
    if (!d || !inside() || e.target.closest?.("input, textarea, select, button, a")) return;
    if (request(d)) e.preventDefault();
  });
  // Arriving with the page already moving (smooth-scroll inertia from above or below): settle on a scene.
  // Arriving from above always lands on the first scene, from below on the last, however much momentum carried
  // the reader in.
  let wasInside = inside();
  lenis.on("scroll", () => {
    const now = inside(), entered = now && !wasInside;
    wasInside = now;
    if (!now && !busy) current = -1;
    if (busy || !now) return;
    { const i = nearest(); if (Math.abs(STOPS[i] - st.progress) < 0.004) { current = i; pin.dataset.stop = String(i); } }  // keep "where we are" true after any scroll
    const drift = lenis.targetScroll - scrollY;
    if (entered) {
      if (Math.abs(drift) > 4) go(drift > 0 ? 1 : STOPS.length - 1);  // carried in by momentum
      else { const i = nearest(); if (Math.abs(STOPS[i] - st.progress) > 0.004) go(i); else { current = i; pin.dataset.stop = String(i); } }  // a jump: stay, on a scene
      return;
    }
    if (Math.abs(drift) > 4) { const i = following(Math.sign(drift)); if (i >= 0) go(i); }
  });

  // A reader who stops mid-story is told there is more; it goes away the moment they scroll.
  const more = $("#scroll-more");
  let idle = null;
  const nudge = () => {
    more?.classList.remove("show");
    clearTimeout(idle);
    idle = setTimeout(() => { if (st.isActive && st.progress < 0.985) more?.classList.add("show"); }, 1600);
  };
  lenis.on("scroll", nudge);
  nudge();
  render(st.progress);
  // Web fonts can change the masthead's height after the pin measured where it starts.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  // Skipping the story jumps straight past it: a smooth scroll would travel through the pin and play scenes on the way.
  $("#skip-story")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.loupeTrack?.("story_skipped", { from: Number(pin.dataset.beat) || 1 });
    lenis.scrollTo("#finale", { immediate: true, force: true });
  });
  // in-page links scroll smoothly through Lenis
  document.querySelectorAll('a[href^="#"]:not(#skip-story)').forEach((a) => a.addEventListener("click", (e) => {
    const target = document.querySelector(a.getAttribute("href"));
    if (target) { e.preventDefault(); lenis.scrollTo(target, { offset: 0 }); }
  }));
}

// ---------- the finding: a dashboard's model gap, then the same people ----------
// Scroll scrubs the change: the bars slide from everyone on each model to the people who used both, and the gap
// counts down with them. Numbers are the real coding pair from aggregates/user_mix_reveal.json.
async function prepareWow() {
  // The validated friction signal (a repeated request or a correction), not the one-turn measure, which failed
  // validation as a failure signal: the headline has to rest on a metric the project itself trusts.
  let pair = null;
  try { const d = await (await fetch(new URL("aggregates/user_mix_reveal.json", import.meta.url))).json(); pair = d.pairs.find((x) => x.model_a === "gpt-4o-mini" && x.intent === "coding") || null; } catch { /* the static labels stay */ }
  const f = pair?.friction;
  if (!f) return null;
  const card = $(".wow-card"), stage = $("#stage");
  const r0 = f.naive_a / f.naive_b, r1 = f.matched_a / f.matched_b;
  $("#w-naive").textContent = `${Math.round(r0)}×`;
  $("#w-people").textContent = fmtInt.format(pair.matched_users);
  $("#w-matched").textContent = `${pct(f.matched_a)} vs ${pct(f.matched_b)}`;
  const max = Math.max(f.naive_a, f.naive_b, f.matched_a, f.matched_b) * 1.08;  // one scale for both views
  const A = $("#how-a"), B = $("#how-b"), va = $("#how-va"), vb = $("#how-vb"), gv = $("#how-gapv"), mode = $("#how-mode");
  let last = -1;
  return (w) => {
    const t = ease(seg(w, 0.42, 0.66));
    if (t === last) return;
    last = t;
    const a = f.naive_a + (f.matched_a - f.naive_a) * t, b = f.naive_b + (f.matched_b - f.naive_b) * t;
    A.style.width = `${(100 * a / max).toFixed(2)}%`; B.style.width = `${(100 * b / max).toFixed(2)}%`;
    va.textContent = pct(a); vb.textContent = pct(b);
    gv.textContent = `${(r0 + (r1 - r0) * t).toFixed(1)}×`;
    mode.textContent = t > 0.5 ? `the same ${fmtInt.format(pair.matched_users)} people on both` : "everyone on each model";
    card.style.setProperty("--settle", t.toFixed(3));
    stage.classList.toggle("k-same", t >= 1);
  };
}

// ---------- your logs: the loupe dives into its own glass ----------
// The glass shows a miniature of the next scene, the chart in it dissolves, the scene comes into focus, then the lens
// rushes toward the reader and the glass becomes the frame. Then read, label, act; step 3 shows the try page's
// outputs for its sample chat log.
function prepareHow() {
  const howStage = $("#how-stage"), stage = $("#stage"), frame = $("#frame"), lens = $(".lens");
  if (!howStage || !frame || !lens) return null;
  let lastIris = -1, glass = null;
  const measure = () => {
    // From layout, not from the screen: the lens may still be sliding in (a CSS transition) when a reader jumps here,
    // and at rest its transform is the identity, so the layout box is where the glass ends up.
    const f = frame.getBoundingClientRect(), lw = lens.offsetWidth;
    const x = lens.offsetLeft + lw * 0.4167, y = lens.offsetTop + lw * 0.4167, r = lw * 0.633 / 2 * 0.96;
    const parts = [...howStage.querySelectorAll(".hs-read > *")].map((el) => el.getBoundingClientRect());
    const cw = Math.max(...parts.map((b) => b.right)) - Math.min(...parts.map((b) => b.left));
    const ch = Math.max(...parts.map((b) => b.bottom)) - Math.min(...parts.map((b) => b.top));
    glass = { x, y, r, cx: f.width / 2, cy: f.height / 2, s0: Math.min(1, (2 * r * 0.88) / Math.hypot(cw, ch)), far: Math.hypot(Math.max(x, f.width - x), Math.max(y, f.height - y)) + 4 };
  };
  addEventListener("resize", () => { glass = null; });
  const iris = (t) => {
    if (t === lastIris) return;
    lastIris = t;
    if (t <= 0) {
      stage.style.setProperty("--dive-k", "1"); stage.style.setProperty("--dive-o", "1");
      howStage.style.clipPath = "circle(0px at 50% 50%)"; howStage.style.visibility = "hidden"; howStage.style.opacity = "0";
      $("#lens-chart").style.opacity = ""; stage.classList.remove("diving", "rushing", "lens-gone"); howStage.classList.remove("diving");
      return;
    }
    howStage.style.visibility = "visible";
    if (!glass) { howStage.classList.remove("diving"); measure(); }
    stage.classList.add("diving");
    const e = t < 0.3 ? 0 : ((t - 0.3) / 0.7) ** 2.2;
    // Inside the glass the chart dissolves into the next scene (opacity only: a live blur costs a full repaint per frame).
    const fe = ease(seg(t, 0, 0.32));
    howStage.style.opacity = fe.toFixed(3);
    $("#lens-chart").style.opacity = (1 - fe).toFixed(3);
    const r = glass.r + (glass.far - glass.r) * e;
    // The rim grows with the opening but is gone before it gets huge: a drop-shadowed lens at 10x is a
    // multi-thousand-pixel filter every frame, which is where this transition used to stutter.
    const lensO = 1 - seg(e, 0.18, 0.42);
    stage.style.setProperty("--dive-k", Math.min(r / glass.r, 4.5).toFixed(3));
    stage.style.setProperty("--dive-o", lensO.toFixed(3));
    stage.classList.toggle("rushing", e > 0);
    stage.classList.toggle("lens-gone", lensO <= 0);
    howStage.style.clipPath = t >= 1 ? "none" : `circle(${r.toFixed(1)}px at ${glass.x.toFixed(1)}px ${glass.y.toFixed(1)}px)`;
    howStage.classList.toggle("diving", t < 1);
    howStage.style.setProperty("--vx", `${((glass.x - glass.cx) * (1 - e)).toFixed(1)}px`);
    howStage.style.setProperty("--vy", `${((glass.y - glass.cy) * (1 - e)).toFixed(1)}px`);
    howStage.style.setProperty("--vs", (glass.s0 + (1 - glass.s0) * e).toFixed(3));
  };
  return (p) => {
    if (p <= 0) glass = null;  // re-measure on the way back in: the lens may have moved with a resize
    iris(seg(p, 0, DIVE));
    const step = p < 0.55 ? 1 : p < 0.8 ? 2 : 3;
    if (howStage.dataset.step !== String(step)) howStage.dataset.step = String(step);
    howStage.style.setProperty("--drop", String(seg(p, DIVE * 0.6, DIVE + 0.1)));
    howStage.style.setProperty("--flow", String(seg(p, DIVE + 0.06, 0.48)));
    howStage.style.setProperty("--k-intent", p > 0.6 ? "1" : "0");
    howStage.classList.toggle("k-flag", p > 0.65);
    howStage.classList.toggle("k-charge", p > 0.7);
    howStage.style.setProperty("--fan", String(seg(p, 0.83, 0.93)));
    return step;
  };
}

// A reload must land on the headline, not on a scroll offset the browser remembered from an older layout.
try { history.scrollRestoration = "manual"; } catch { /* unsupported */ }
if (!location.hash) scrollTo(0, 0);

// The fixed readout belongs to the top of the page; it steps aside once the reader scrolls past the masthead.
(() => { const r = $("#readout"); if (!r) return;
  const tick = () => r.classList.toggle("is-hidden", scrollY > 260);
  addEventListener("scroll", tick, { passive: true }); tick(); })();

(async () => {
  const ctx = { circles: [], wow: null, how: prepareHow(), render: () => {} };
  bindStory(ctx);
  const story = await loadStory();
  fill(story);
  readout(story);
  const [circles, wow] = await Promise.all([drawWorld(story), prepareWow()]);
  Object.assign(ctx, { circles, wow });
  ctx.render();
})();
