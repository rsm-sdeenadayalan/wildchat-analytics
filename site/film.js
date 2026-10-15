// The Loupe film: one continuous motion graphic, not a sequence of slides. The same objects carry the story from
// start to end: a dot becomes a crowd, the crowd becomes two bars, the bars burst back into people, the people who
// used both models become two equal bars, and the loupe dives into your logs. One GSAP timeline drives it; it plays
// on its own clock when on screen. Dots stand for people; every number is real (aggregates/user_mix_reveal.json).
import { gsap } from "https://cdn.jsdelivr.net/npm/gsap@3.12.5/+esm";

const $ = (s, root = document) => root.querySelector(s);
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const fmtInt = new Intl.NumberFormat("en-US");
const pct = (x) => `${(100 * x).toFixed(1)}%`;
// The coding comparison, gpt-4o-mini vs gpt-4o, repeat-or-correction rate (validated signals); used if the fetch fails.
const FALLBACK = { na: 0.029953, nb: 0.009233, ma: 0.116495, mb: 0.115561, people: 622, convs: 3199860 };

async function loadNumbers() {
  try {
    const d = await (await fetch(new URL("aggregates/user_mix_reveal.json", import.meta.url))).json();
    const p = d.pairs.find((x) => x.model_a === "gpt-4o-mini" && x.intent === "coding");
    const f = p?.friction;
    if (!f) return FALLBACK;
    return { na: f.naive_a, nb: f.naive_b, ma: f.matched_a, mb: f.matched_b, people: p.matched_users, convs: FALLBACK.convs };
  } catch { return FALLBACK; }
}

// A line of kinetic type: each word its own span, so lines rise in word by word.
function line(html, cls) {
  const el = document.createElement("div");
  el.className = `kt ${cls}`;
  el.innerHTML = html;
  const walk = (node) => {
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const part of n.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(part); continue; }
          const w = document.createElement("span"); w.className = "w"; w.textContent = part; frag.append(w);
        }
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && !n.classList.contains("w")) {
        if (n.dataset.unit != null) { n.classList.add("w"); } else walk(n);
      }
    }
  };
  walk(el);
  return el;
}

// a seeded random, so the film is the same every time it plays
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function build(N, numbers) {
  const stage = $("#film-stage"), cam = $("#cam"), lens = $("#flens"), logs = $("#logs"), end = $("#endcard");
  cam.innerHTML = "";
  const W = stage.clientWidth, H = stage.clientHeight, narrow = W < 700;
  const rand = rng(11);
  const cx = W / 2, cy = H / 2;

  // ---------- the cast ----------
  const n = narrow ? 120 : 220;
  // Three depth layers: near dots are bigger and brighter and move more with the camera; far ones are small and dim.
  const layers = [0, 1, 2].map((k) => { const l = document.createElement("div"); l.className = `layer l${k}`; cam.append(l); return l; });
  const depth = Array.from({ length: n }, () => { const r = rand(); return r < 0.3 ? 0 : r < 0.75 ? 1 : 2; });
  const dots = Array.from({ length: n }, (_, i) => {
    const d = document.createElement("i"); d.className = "p";
    const c = document.createElement("b"); c.className = "core";
    // every dot breathes on its own clock, so the scene never freezes
    c.style.setProperty("--fd", `${(2.6 + rand() * 2.8).toFixed(2)}s`); c.style.setProperty("--fo", `${(-rand() * 5).toFixed(2)}s`);
    c.style.setProperty("--fx", `${((rand() - 0.5) * 7).toFixed(1)}px`); c.style.setProperty("--fy", `${((rand() - 0.5) * 7).toFixed(1)}px`);
    d.style.setProperty("--ds", [0.7, 1, 1.45][depth[i]]); d.style.setProperty("--do", [0.55, 0.85, 1][depth[i]]);
    d.append(c); layers[depth[i]].append(d); return d;
  });
  const cores = dots.map((d) => d.firstChild);
  const ring = document.createElement("i"); ring.className = "ring"; cam.append(ring);
  const mk = (cls, html = "") => { const e = document.createElement("div"); e.className = cls; e.innerHTML = html; cam.append(e); return e; };
  const labA = mk("crowd-lab", "cheap model"), labB = mk("crowd-lab", "big model");
  const bar = (name, cls) => mk(`fbar ${cls}`, `<i class="fill"></i><b class="val">0.0%</b><span class="bl">${name}</span>`);
  const barA = bar("cheap model", "a"), barB = bar("big model", "b");
  const ratio = mk("ratio", '<b class="ratio-n">1.0×</b><span class="ratio-k">as often as the big model</span>');
  const stamp = mk("stamp2", "same people");
  const shock = mk("shock");
  const legend = mk("legend", '<span><i class="lt"></i>occasional users</span><span><i class="hv"></i>heavy users</span><span class="ill">illustration</span>');
  const butWord = mk("but", "But");
  const cluster = mk("cluster-lab", `<b>${fmtInt.format(numbers.people)}</b> people used both models`);
  const L = {
    trace: line("Every conversation leaves a trace.", "low"),
    count: line(`<b class="count" data-unit>0</b> real conversations`, "top"),
    compare: line("A dashboard splits them by model: a cheap one and a big one.", "top"),
    verdict: line(`People have to correct the cheap model <em data-unit>3.2×</em> as often. <span class="dim">Verdict: drop it.</span>`, "top"),
    diff: line("But the two models weren't used by the same kind of people.", "top"),
    self: line("So Loupe compares the same people on both models.", "top"),
    same: line(`Same people, same rate of corrections. <span class="dim">The gap came from who chose each model.</span>`, "top"),
    yours: line("Now point Loupe at your logs.", "top"),
    work: line("It hands you what to do next.", "top"),
  };
  // lines for the "your logs" act live outside the camera, which fades away during the dive
  let hud = $(".hud", stage);
  if (!hud) { hud = document.createElement("div"); hud.className = "hud"; stage.append(hud); }
  hud.innerHTML = "";
  const sampleNote = document.createElement("p"); sampleNote.className = "sample-note";
  sampleNote.textContent = "example output, from the sample log on the try page";
  hud.append(sampleNote); gsap.set(sampleNote, { autoAlpha: 0 });
  Object.entries(L).forEach(([k, el]) => (k === "yours" || k === "work" ? hud : cam).append(el));
  const words = (el) => el.querySelectorAll(".w");

  // ---------- where things go ----------
  const crowdA = { x: W * (narrow ? 0.27 : 0.3), y: H * 0.56 }, crowdB = { x: W * (narrow ? 0.73 : 0.7), y: H * 0.56 };
  const crowdR = Math.min(W * (narrow ? 0.2 : 0.15), H * 0.2);
  const inDisc = (c, r) => { const a = rand() * Math.PI * 2, k = Math.sqrt(rand()); return { x: c.x + Math.cos(a) * r * k, y: c.y + Math.sin(a) * r * k * 0.85 }; };
  const cloud = dots.map(() => inDisc({ x: cx, y: cy + H * 0.04 }, Math.min(W * 0.42, H * 0.36) * 1.15));
  const side = dots.map((_, i) => i % 2);  // 0: cheap model's crowd, 1: big model's
  const crowd = dots.map((_, i) => inDisc(side[i] ? crowdB : crowdA, crowdR));
  // who they are (illustration): the cheap model's crowd is mostly occasional users, the big model's mostly heavy users
  const heavy = dots.map((_, i) => (side[i] ? rand() < 0.8 : rand() < 0.2));
  // the people who used both models: a slice of each crowd
  const matched = dots.map((_, i) => (heavy[i] && side[i] === 1 && rand() < 0.35) || (heavy[i] && side[i] === 0 && rand() < 0.95));
  // bars
  const baseY = H * 0.8, barW = Math.min(W * 0.12, 120), maxH = H * 0.42;
  const placeBar = (b, x) => { b.style.left = `${x - barW / 2}px`; b.style.top = `${baseY - maxH}px`; b.style.width = `${barW}px`; b.style.height = `${maxH}px`; };
  placeBar(barA, crowdA.x); placeBar(barB, crowdB.x);
  const hA = 1, hB = numbers.nb / numbers.na;                       // the dashboard view, to scale
  const mA = 0.92, mB = 0.92 * numbers.mb / numbers.ma;             // the same people, to scale
  const inBar = (x, h) => ({ x: x + (rand() - 0.5) * barW * 0.7, y: baseY - rand() * maxH * h });
  const pour = dots.map((_, i) => inBar(side[i] ? crowdB.x : crowdA.x, side[i] ? hB : hA));
  const midA = crowdA.x, midB = crowdB.x;  // the same places as the dashboard's bars, so the two views compare directly
  const clusterPos = dots.map(() => inDisc({ x: cx, y: H * 0.56 }, crowdR * 0.75));
  const pour2 = dots.map((_, i) => inBar(side[i] ? midB : midA, side[i] ? mB : mA));
  // labels and the ratio
  Object.assign(labA.style, { left: `${crowdA.x}px`, top: `${crowdA.y + crowdR + 18}px` });
  Object.assign(labB.style, { left: `${crowdB.x}px`, top: `${crowdB.y + crowdR + 18}px` });
  Object.assign(ratio.style, { left: `${cx}px`, top: `${H * 0.44}px` });
  Object.assign(cluster.style, { left: `${cx}px`, top: `${H * 0.56 + crowdR + 14}px` });
  Object.assign(legend.style, { left: `${cx}px`, top: `${H * 0.84}px` });
  Object.assign(stamp.style, { left: `${cx + Math.min(W * 0.16, 180)}px`, top: `${H * 0.32}px` });
  Object.assign(shock.style, { left: `${cx}px`, top: `${baseY - maxH * 0.5}px`, width: `${Math.min(W * 0.5, 520)}px`, height: `${maxH * 1.1}px` });

  // ---------- the timeline ----------
  const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
  const textIn = (el, at) => { tl.set(el, { autoAlpha: 1 }, at); tl.fromTo(words(el), { y: "0.55em", opacity: 0, filter: "blur(8px)" }, { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.7, stagger: 0.064 }, at); };
  const textOut = (el, at) => { tl.to(words(el), { y: "-0.35em", opacity: 0, filter: "blur(6px)", duration: 0.35, stagger: 0.025, ease: "power2.in" }, at); tl.set(el, { autoAlpha: 0 }, at + 0.6); };
  // Counting numbers are derived from the timeline's position (not from callbacks), so they are right after any jump.
  const counts = [];
  const count = (el, from, to, at, dur, fmt) => { const o = { v: from }; counts.push({ el, o, at, from, fmt }); tl.to(o, { v: to, duration: dur, ease: "power2.out" }, at); };
  tl.syncTexts = () => {
    const t = tl.time(), byEl = new Map();
    for (const c of counts) { const cur = byEl.get(c.el); if (!cur || (c.at <= t && (cur.at > t || c.at > cur.at)) || (cur.at > t && c.at < cur.at)) byEl.set(c.el, c); }
    for (const [el, c] of byEl) el.textContent = c.at <= t ? c.fmt(c.o.v) : c.fmt(c.from);
  };
  const ratioN = $(".ratio-n", ratio), valA = $(".val", barA), valB = $(".val", barB), fillA = $(".fill", barA), fillB = $(".fill", barB);

  gsap.set([...Object.values(L), labA, labB, barA, barB, ratio, stamp, legend, butWord, cluster, shock], { autoAlpha: 0 });
  gsap.set(dots, { x: cx, y: cy, scale: 0, opacity: 0 });
  gsap.set(cores, { backgroundColor: "#f2a93b" });
  gsap.set(ring, { x: cx, y: cy, scale: 0, opacity: 0 });
  gsap.set([fillA, fillB], { scaleY: 0 });
  gsap.set([valA, valB], { opacity: 0 });
  gsap.set(cam, { scale: 1.7, x: 0, y: 0, transformOrigin: "50% 50%" });
  const flash = mk("flash");
  gsap.set(flash, { autoAlpha: 0 });
  gsap.set(lens, { autoAlpha: 0, x: W + 200, y: cy, scale: 1 });
  gsap.set(logs, { autoAlpha: 0 });
  gsap.set($(".files", logs).children, { y: -80, opacity: 0 });
  gsap.set($(".arts", logs).children, { scale: 0.5, opacity: 0, y: 30 });
  gsap.set(end, { autoAlpha: 0, y: 20 });

  // 1 · one conversation, then all of them
  tl.addLabel("c1", 0);
  tl.to(dots[0], { scale: 2.2, opacity: 1, duration: 0.5, ease: "back.out(3)" }, 0.25);
  tl.fromTo(ring, { scale: 0.2, opacity: 0.8 }, { scale: 6, opacity: 0, duration: 1.1, ease: "power2.out", immediateRender: false }, 0.45);
  textIn(L.trace, 0.5);
  textOut(L.trace, 1.9);
  tl.to(dots, { x: (i) => cloud[i].x, y: (i) => cloud[i].y, scale: 1, opacity: 1, duration: 1.1, ease: "expo.out", stagger: { each: 0.003, from: "start" } }, 2.0);
  tl.to(cam, { scale: 1, duration: 1.6, ease: "power3.inOut" }, 1.9);  // the camera pulls back as one becomes millions
  textIn(L.count, 2.05);
  count($(".count", L.count), 0, numbers.convs, 2.1, 1.3, (v) => fmtInt.format(Math.round(v)));
  textOut(L.count, 3.5);
  // the crowd splits by model
  tl.to(dots, { x: (i) => crowd[i].x, y: (i) => crowd[i].y, duration: 0.9, ease: "power3.inOut", stagger: { each: 0.002, from: "random" } }, 3.6);
  textIn(L.compare, 3.7);
  tl.to([labA, labB], { autoAlpha: 1, duration: 0.4 }, 4.2);
  // each crowd pours itself into a bar
  textOut(L.compare, 4.9);
  tl.to([labA, labB], { autoAlpha: 0, duration: 0.3 }, 4.9);
  tl.to([barA, barB], { autoAlpha: 1, duration: 0.35 }, 4.95);
  tl.to([valA, valB], { opacity: 1, duration: 0.3 }, 5.3);
  tl.to(dots, { x: (i) => pour[i].x, y: (i) => pour[i].y, scale: 0.7, duration: 0.55, ease: "power2.in", stagger: { each: 0.002, from: "random" } }, 4.95);
  tl.to(dots, { scale: 0, opacity: 0, duration: 0.18, stagger: { each: 0.002, from: "random" } }, 5.45);
  tl.to(fillA, { scaleY: hA, duration: 0.8, ease: "power2.out" }, 5.3);
  tl.to(fillB, { scaleY: hB, duration: 0.8, ease: "power2.out" }, 5.3);
  count(valA, 0, numbers.na, 5.3, 0.8, pct); count(valB, 0, numbers.nb, 5.3, 0.8, pct);
  tl.fromTo(ratio, { autoAlpha: 0, scale: 2.4 }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: "back.out(2)" }, 5.9);
  count(ratioN, 1, numbers.na / numbers.nb, 5.9, 0.7, (v) => `${v.toFixed(1)}×`);
  textIn(L.verdict, 6.1);
  tl.to(cam, { keyframes: [{ scale: 1.09, duration: 0.12, ease: "power2.out" }, { scale: 1.03, duration: 0.6, ease: "power2.out" }, { scale: 1.06, duration: 1.1, ease: "none" }] }, 5.9);  // punch in on the slam, then a slow push

  // 2 · But
  tl.addLabel("c2", 7.9);
  tl.to([barA, barB, ratio, L.verdict], { autoAlpha: 0.1, duration: 0.3 }, 7.9);
  tl.to(cam, { scale: 1, duration: 0.4, ease: "power2.inOut" }, 7.9);
  tl.fromTo(butWord, { autoAlpha: 0, x: W * 0.5, skewX: -22, filter: "blur(14px)" }, { autoAlpha: 1, x: 0, skewX: 0, filter: "blur(0px)", duration: 0.55, ease: "expo.out" }, 7.95);
  tl.to(butWord, { autoAlpha: 0, x: -W * 0.5, skewX: 22, filter: "blur(14px)", duration: 0.4, ease: "expo.in" }, 8.75);
  tl.to([barA, barB, ratio, L.verdict], { autoAlpha: 0, duration: 0.2 }, 8.72);
  tl.set([fillA, fillB], { scaleY: 0 }, 8.95);
  tl.set([valA, valB], { opacity: 0 }, 8.95);
  // the bars burst back into people, and they are not the same people
  tl.set(dots, { x: (i) => pour[i].x, y: (i) => pour[i].y, scale: 0, opacity: 1 }, 8.85);
  tl.to(dots, { x: (i) => crowd[i].x, y: (i) => crowd[i].y, scale: 1, duration: 0.8, ease: "expo.out", stagger: { each: 0.002, from: "random" } }, 8.9);
  tl.to(cores, { backgroundColor: (i) => (heavy[i] ? "#fffaf0" : "#8fb0ff"), duration: 0.5, stagger: { each: 0.002, from: "random" } }, 9.4);
  tl.to([labA, labB, legend], { autoAlpha: 1, duration: 0.4 }, 9.5);
  textIn(L.diff, 9.1);
  textOut(L.diff, 10.8);
  // the people who used both step into the middle
  textIn(L.self, 10.95);
  tl.to([labA, labB, legend], { autoAlpha: 0, duration: 0.3 }, 11.0);
  tl.to(dots, { x: (i) => (matched[i] ? clusterPos[i].x : crowd[i].x), y: (i) => (matched[i] ? clusterPos[i].y : crowd[i].y),
    opacity: (i) => (matched[i] ? 1 : 0.08),
    duration: 0.9, ease: "power3.inOut", stagger: { each: 0.002, from: "random" } }, 11.1);
  tl.to(cluster, { autoAlpha: 1, duration: 0.4 }, 11.7);

  // 3 · same people
  tl.addLabel("c3", 12.6);
  textOut(L.self, 12.6);
  tl.to(cluster, { autoAlpha: 0, duration: 0.3 }, 12.6);
  tl.to(dots, { opacity: (i) => (matched[i] ? 1 : 0), duration: 0.3 }, 12.6);
  tl.call(() => { placeBar(barA, midA); placeBar(barB, midB); }, null, 12.65);
  tl.to([barA, barB], { autoAlpha: 1, duration: 0.35 }, 12.7);
  tl.to([valA, valB], { opacity: 1, duration: 0.3 }, 13.05);
  tl.to(dots, { x: (i) => pour2[i].x, y: (i) => pour2[i].y, scale: 0.7, duration: 0.55, ease: "power2.in", stagger: { each: 0.003, from: "random" } }, 12.7);
  tl.to(dots, { scale: 0, opacity: 0, duration: 0.18, stagger: { each: 0.003, from: "random" } }, 13.2);
  tl.to(fillA, { scaleY: mA, duration: 0.8, ease: "power2.out" }, 13.05);
  tl.to(fillB, { scaleY: mB, duration: 0.8, ease: "power2.out" }, 13.05);
  count(valA, 0, numbers.ma, 13.05, 0.8, pct); count(valB, 0, numbers.mb, 13.05, 0.8, pct);
  tl.to(ratio, { autoAlpha: 1, duration: 0.3 }, 13.4);
  count(ratioN, numbers.na / numbers.nb, numbers.ma / numbers.mb, 13.5, 0.9, (v) => `${v.toFixed(1)}×`);
  tl.to(ratioN, { color: "#fffaf0", duration: 0.9 }, 13.5);
  tl.fromTo(stamp, { autoAlpha: 0, scale: 2.6, rotate: -18 }, { autoAlpha: 1, scale: 1, rotate: -8, duration: 0.35, ease: "back.out(2.4)" }, 14.45);
  tl.fromTo(shock, { autoAlpha: 0.9, scale: 0.9 }, { autoAlpha: 0, scale: 1.5, duration: 0.8, ease: "power2.out", immediateRender: false }, 14.6);
  tl.to(cam, { keyframes: [{ x: -8, y: 4, duration: 0.06 }, { x: 7, y: -3, duration: 0.07 }, { x: -3, y: 2, duration: 0.07 }, { x: 0, y: 0, duration: 0.08 }] }, 14.6);
  tl.fromTo(flash, { autoAlpha: 0.35 }, { autoAlpha: 0, duration: 0.6, ease: "power2.out", immediateRender: false }, 14.52);
  tl.fromTo(cam, { scale: 1 }, { scale: 1.05, duration: 2, ease: "none", immediateRender: false }, 14.6);
  textIn(L.same, 14.7);

  // 4 · your logs: the camera pulls back, the loupe sweeps in and dives
  tl.addLabel("c4", 16.6);
  textOut(L.same, 16.6);
  tl.to(cam, { scale: 0.5, duration: 0.8, ease: "power3.inOut" }, 16.7);
  tl.to(lens, { autoAlpha: 1, x: cx, y: cy, duration: 0.8, ease: "power3.out" }, 16.9);
  tl.to(lens, { scale: 14, duration: 0.85, ease: "power3.in" }, 17.8);
  tl.to(cam, { autoAlpha: 0, duration: 0.45, ease: "power2.in" }, 17.95);
  tl.to(lens, { autoAlpha: 0, duration: 0.3 }, 18.55);
  tl.set(logs, { autoAlpha: 1 }, 18.5);
  textIn(L.yours, 18.55);
  tl.set(L.yours, { autoAlpha: 1 }, 18.55);
  tl.to($(".files", logs).children, { y: 0, opacity: 1, duration: 0.6, ease: "back.out(2)", stagger: 0.12 }, 18.7);
  // the files become the outputs
  textOut(L.yours, 19.9);
  tl.to($(".files", logs).children, { scale: 0.4, opacity: 0, y: 40, duration: 0.4, ease: "power2.in", stagger: 0.05 }, 19.9);
  tl.to($(".arts", logs).children, { scale: 1, opacity: 1, y: 0, rotate: (i) => (i - 1) * 3, duration: 0.6, ease: "back.out(1.8)", stagger: 0.1 }, 20.25);
  textIn(L.work, 20.2);
  tl.to(sampleNote, { autoAlpha: 1, duration: 0.4 }, 20.6);
  // end card
  tl.addLabel("c5", 22.0);
  tl.to(logs, { autoAlpha: 0, scale: 0.96, duration: 0.4 }, 22.0);
  tl.to([L.work, sampleNote], { autoAlpha: 0, duration: 0.3 }, 22.0);
  tl.to(end, { autoAlpha: 1, y: 0, duration: 0.6 }, 22.3);
  tl.set({}, {}, 23.0);
  // The longer lines stay up a little longer: everything after each one moves later by a fraction of a second
  // (latest first, so each threshold still refers to the original times).
  // [time after which everything moves later, seconds added]: "Now point Loupe…", "Same people…", "So Loupe compares…",
  // "But the two models…", "People have to correct…", "A dashboard splits them…"
  [[19.85, 0.4], [16.5, 0.9], [12.55, 0.6], [10.7, 0.9], [7.8, 0.8], [4.85, 0.9]].forEach(([after, extra]) => tl.shiftChildren(extra, true, after));
  tl.timeScale(1.04);  // a little faster overall
  return tl;
}

async function main() {
  const stage = $("#film-stage");
  if (!stage) return;
  const numbers = await loadNumbers();
  const people = $("#end-people"); if (people) people.textContent = fmtInt.format(numbers.people);
  let tl = build(0, numbers);
  const CH = ["c1", "c2", "c3", "c4", "c5"];
  const playBtn = $("#film-play"), segs = [...document.querySelectorAll("#film-controls .seg")];
  let playing = false, started = false, visible = false, userPaused = false;
  const paint = () => {
    tl.syncTexts?.();
    const t = tl.time();
    const starts = CH.map((c) => tl.labels[c]), endT = tl.duration();
    const ch = starts.filter((s) => t >= s).length;  // 1..5
    stage.dataset.chapter = String(Math.min(ch, 5));
    $("#story").dataset.beat = String(Math.min(ch, 5));
    segs.forEach((b, i) => {
      const a = starts[i], z = i === 3 ? endT : starts[i + 1];
      b.style.setProperty("--fill", String(Math.max(0, Math.min(1, (t - a) / (z - a)))));
      b.classList.toggle("on", t >= a && t < z);
    });
  };
  const label = () => { const done = tl.progress() >= 1; playBtn.textContent = playing ? "Pause" : done ? "Replay" : "Play"; playBtn.setAttribute("aria-label", playBtn.textContent); };
  const attach = () => {
    tl.eventCallback("onUpdate", paint);
    tl.eventCallback("onComplete", () => { playing = false; label(); window.loupeTrack?.("film_finished", {}); });
  };
  attach();
  const setPlaying = (on) => { playing = on; on ? tl.play() : tl.pause(); label(); };
  if (reduced()) { tl.progress(1); paint(); label(); playBtn.disabled = true; }
  // It waits on its first frame until the reader has scrolled down to it: on arrival the hero is read first, even
  // where the top of the film already shows beneath it.
  const scrolledTo = () => $("#story").getBoundingClientRect().top < innerHeight * 0.3;
  const start = () => {
    if (reduced() || !scrolledTo()) return;
    if (!started) { started = true; window.loupeTrack?.("film_started", {}); }
    if (!userPaused && visible && tl.progress() < 1) setPlaying(true);
  };
  playBtn.addEventListener("click", () => {
    if (tl.progress() >= 1) { tl.restart(); setPlaying(true); userPaused = false; return; }
    userPaused = playing; setPlaying(!playing);
  });
  $("#film-replay").addEventListener("click", () => { window.loupeTrack?.("film_replayed", {}); userPaused = false; tl.restart(); setPlaying(true); });
  segs.forEach((b, i) => b.addEventListener("click", () => {
    window.loupeTrack?.("film_scene_jump", { to: i + 1 });
    userPaused = false; tl.seek(CH[i]); setPlaying(true); paint();
  }));
  try {
    new IntersectionObserver(([e]) => {
      visible = e.intersectionRatio >= 0.5;
      document.body.classList.toggle("in-story", e.intersectionRatio >= 0.9);  // full screen: the top bar steps aside
      if (visible) start(); else if (playing) setPlaying(false);
    }, { threshold: [0, 0.5, 0.9, 1] }).observe($("#frame"));
  } catch { visible = true; start(); }
  addEventListener("scroll", () => { if (visible && !playing && !started) start(); }, { passive: true });
  // A new size rebuilds the timeline at the same moment.
  let resizeT = null, lastW = stage.clientWidth;
  addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (Math.abs(stage.clientWidth - lastW) < 40) return;
      lastW = stage.clientWidth;
      const t = tl.time(), was = playing;
      tl.kill(); tl = build(0, numbers); attach(); tl.seek(t); if (was) tl.play(); paint();
    }, 200);
  });
  // The frame's shape follows the scroll: a rounded card under the hero, edge to edge once it fills the window,
  // and rounding back into a card as the page carries it away.
  const section = $("#story"), frame = $("#frame");
  const easeIO = (t) => t * t * (3 - 2 * t);
  let shapeQueued = false;
  const shape = () => {
    shapeQueued = false;
    const top = section.getBoundingClientRect().top, vh = innerHeight;
    const enter = Math.min(1, Math.max(0, 1 - top / (vh * 0.85)));   // 0 while below the fold, 1 when it reaches the top
    const leave = Math.min(1, Math.max(0, -top / (vh * 0.6)));       // 0 at the top, 1 once mostly scrolled past
    const k = 1 - easeIO(Math.min(enter, 1 - leave));               // 1: card, 0: full screen
    const shrink = innerWidth < 700 ? 0.06 : 0.07;  // the whole film scales into the card, so buttons and text shrink with it
    frame.style.setProperty("--fs", (1 - k * shrink).toFixed(4));
    frame.style.setProperty("--fr", `${(k * 28).toFixed(1)}px`);
  };
  const queueShape = () => { if (!shapeQueued) { shapeQueued = true; requestAnimationFrame(shape); } };
  addEventListener("scroll", queueShape, { passive: true }); addEventListener("resize", queueShape); shape();
  // A gentle snap: when scrolling stops with the film within a tenth of a screen of filling the window, it settles
  // exactly into place. Further away it never pulls, so scrolling on past the film is never fought.
  let settleT = null, settling = false;
  addEventListener("scroll", () => {
    clearTimeout(settleT);
    settleT = setTimeout(() => {
      const top = section.getBoundingClientRect().top;
      if (settling || Math.abs(top) < 1 || Math.abs(top) > innerHeight * 0.1 || reduced()) { settling = false; return; }
      settling = true;
      scrollTo({ top: scrollY + top, behavior: "smooth" });
    }, 160);
  }, { passive: true });
  // Depth: the three dot layers shift with the pointer, near ones most (touch screens sway on their own, in CSS).
  if (matchMedia("(hover: hover) and (pointer: fine)").matches && !reduced()) {
    $("#frame").addEventListener("pointermove", (e) => {
      const r = stage.getBoundingClientRect(), mx = (e.clientX - r.left) / r.width - 0.5, my = (e.clientY - r.top) / r.height - 0.5;
      document.querySelectorAll("#cam .layer").forEach((l, k) => gsap.to(l, { x: -mx * [10, 22, 40][k], y: -my * [6, 14, 26][k], duration: 1.1, ease: "power3.out", overwrite: true }));
    });
  }
  paint(); label();
  window.__seek = (t) => { tl.pause(); playing = false; tl.seek(t); paint(); label(); };  // for the browser checks
}

main();
