import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.17/+esm";
import { normalize, analyze, compareModels, versionChanges, beforeAfter, failureCases, backlog, compileReasons, failureReasons } from "./engine.js";
import { loadIntentModel } from "./intent.js";

const $ = (s) => document.querySelector(s);
const pct = (x, d = 1) => (x == null ? "–" : (100 * x).toFixed(d) + "%");
const fmt = new Intl.NumberFormat("en-US");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;  // personal exports bundle images; only conversations*.json is decompressed
let last = null;  // { norm, a, name, compare } for the copy-summary button

let classifierP = null;
const classifier = () => (classifierP ??= fetch(new URL("intent-model.json", import.meta.url)).then((r) => r.json()).then(loadIntentModel));
let reasonsP = null;
const reasonRules = () => (reasonsP ??= fetch(new URL("failure-reasons.json", import.meta.url)).then((r) => r.json()).then(compileReasons));
const status = (msg, err = false) => { const s = $("#status"); s.hidden = !msg; s.textContent = msg || ""; s.classList.toggle("err", err); };
const statusHtml = (html) => { const s = $("#status"); s.hidden = false; s.innerHTML = html; s.classList.add("err"); };
const sizeBucket = (n) => (n < 1e3 ? "<1k" : n < 1e4 ? "1k-10k" : n < 1e5 ? "10k-100k" : "100k+");

async function run(text, name, source) {
  try {
    status("Reading the file…");
    await new Promise((r) => setTimeout(r, 20));
    const norm = normalize(text, name);
    status(`Classifying ${fmt.format(norm.conversations.length)} conversations in your browser…`);
    const [clf, rules] = await Promise.all([classifier(), reasonRules()]);
    await new Promise((r) => setTimeout(r, 20));
    const a = analyze(norm, clf);
    status("");
    last = { norm, a, name, rules, compare: null, change: null, cases: [], themes: [], reasons: [] };
    render(norm, a, clf);
    window.loupeTrack?.("try_analyzed", { source, format: norm.format, personal: norm.personal, conversations: sizeBucket(a.n), has_users: a.realUsers, models: a.models.length, responders: a.responders.length });
    $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    status(e.message || String(e), true);
    window.loupeTrack?.("try_failed", { source, message: String(e.message || e).slice(0, 120) });
  }
}

function tile(label, value, sub) { return `<div class="tile"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div>`; }

// Card headings carry a team wording (default) and a personal wording (data-personal) for one person's export.
function setHeadings(personal) {
  document.querySelectorAll("#results [data-personal]").forEach((h) => { h.dataset.team ??= h.textContent; h.textContent = personal ? h.dataset.personal : h.dataset.team; });
}

function render(norm, a, clf) {
  $("#results").hidden = false;
  const me = norm.personal;
  setHeadings(me);
  $("#compare-card").hidden = me;
  $("#change-card").hidden = false;
  $("#fx-card").hidden = false;
  $("#change-so").textContent = me
    ? "Pick when you changed how you use it: new custom instructions, a Project, a different model. Loupe compares your conversations before and after, then reruns the test at an earlier date as a placebo."
    : $("#change-so").dataset.team;
  $("#copy-ok").textContent = ""; $("#sum-wrap").hidden = true;
  $("#notes").innerHTML = norm.notes.map((n) => `<p class="${/^No /.test(n) ? "warn" : ""}">${esc(n)}</p>`).join("");
  const span = a.span ? `${a.span[0].toISOString().slice(0, 10)} to ${a.span[1].toISOString().slice(0, 10)}` : "no timestamps";
  const active = a.weekly.length, spanWeeks = a.span ? Math.floor((weekStart(a.span[1]) - weekStart(a.span[0])) / (7 * 864e5)) + 1 : 0;
  $("#tiles").innerHTML = me ? [
    tile("conversations", fmt.format(a.n), span),
    tile("weeks you used it", active ? `${fmt.format(active)} of ${fmt.format(spanWeeks)}` : "–", active ? `busiest: ${fmt.format(Math.max(...a.weekly.map((w) => w.conversations)))} conversations` : "no timestamps"),
    tile("models", a.models.length || "–", a.models.length ? a.models.slice(0, 3).map(esc).join(", ") : "not in this export"),
    tile("you re-asked", pct(a.repeat), `you corrected it in ${pct(a.correction)}`),
  ].join("") : [
    tile("conversations", fmt.format(a.n), `format: ${esc(norm.format)}`),
    tile(a.realUsers ? "people" : "people (one per conversation)", fmt.format(a.nUsers), a.realUsers ? `top 10% produce ${pct(a.top10Share, 0)}` : "no user field"),
    tile("models", a.models.length || "–", a.models.slice(0, 3).map(esc).join(", ")),
    tile("repeated request", pct(a.repeat), `correction ${pct(a.correction)}`),
  ].join("");

  // intents
  $("#clf-acc").textContent = pct(clf.accuracy);
  const top = a.intents[0];
  $("#intent-so").textContent = !top ? "" : me ? `${top.intent} is your largest use at ${pct(top.share, 0)} of conversations.` : `${top.intent} is the largest use at ${pct(top.share, 0)} of conversations.`;
  $("#intent-fig").replaceChildren(Plot.plot({
    width: Math.min(1060, $("#intent-fig").clientWidth || 900), height: 40 + 28 * a.intents.length, marginLeft: 150,
    x: { label: "share of conversations", grid: true, percent: true }, y: { label: null, domain: a.intents.map((i) => i.intent) },
    marks: [Plot.barX(a.intents, { y: "intent", x: "share", fill: css("--c1"), rx: 3, channels: { conversations: "n" }, tip: { format: { x: (v) => (100 * v).toFixed(1) + "%", y: false } } }), Plot.ruleX([0])],
  }));

  // failures by intent
  const real = a.intents.filter((i) => i.intent !== "other");
  const worst = [...real].sort((x, y) => y.repeat - x.repeat)[0];
  $("#fail-so").textContent = !worst ? "" : me ? `You repeat yourself most in ${worst.intent}: ${pct(worst.repeat)} of those conversations re-ask the same thing.` : `People repeat themselves most in ${worst.intent}: ${pct(worst.repeat)} of those conversations re-ask the same thing.`;
  $("#fail-table").innerHTML = `<div class="tablewrap"><table class="grid"><thead><tr><th>intent</th><th>conversations</th><th>repeated request</th><th>correction</th>${me ? "" : "<th>ended in one turn</th>"}</tr></thead><tbody>${
    a.intents.map((i) => `<tr><td>${esc(i.intent)}</td><td>${fmt.format(i.n)}</td><td>${pct(i.repeat)}</td><td>${pct(i.correction, 2)}</td>${me ? "" : `<td>${pct(i.oneTurn)}</td>`}</tr>`).join("")}</tbody></table></div>`;

  // responders
  const resp = a.responders.filter((r) => !me || r.replies >= MIN_PERSONAL_REPLIES).slice(0, 12);
  $("#resp-card").hidden = resp.length < 2;
  if (resp.length >= 2) {
    const w = [...resp].sort((x, y) => (y.repeatPer1k + y.correctionPer1k) - (x.repeatPer1k + x.correctionPer1k))[0];
    $("#resp-so").textContent = me ? `You push back on ${w.responder} most: ${w.repeatPer1k.toFixed(0)} repeats and ${w.correctionPer1k.toFixed(0)} corrections per 1,000 of its replies (models with ${MIN_PERSONAL_REPLIES}+ replies).`
      : `${w.responder} draws the most friction: ${w.repeatPer1k.toFixed(0)} repeats and ${w.correctionPer1k.toFixed(0)} corrections per 1,000 of its replies.` +
        (respAreModels(a) ? " These responders are models, and different people may use each; check the gap with Model or users? above before acting on it." : "");
    const long = resp.flatMap((r) => [{ responder: r.responder, signal: "repeated request", per1k: r.repeatPer1k, replies: r.replies }, { responder: r.responder, signal: "correction follow-up", per1k: r.correctionPer1k, replies: r.replies }]);
    $("#resp-fig").replaceChildren(Plot.plot({
      width: Math.min(1060, $("#resp-fig").clientWidth || 900), height: 40 + 30 * resp.length, marginLeft: 150,
      color: { domain: ["repeated request", "correction follow-up"], range: [css("--c1"), css("--c2")], legend: true },
      x: { label: "per 1,000 replies", grid: true }, y: { label: null, domain: resp.map((r) => r.responder) },
      marks: [Plot.barX(long, { y: "responder", x: "per1k", fill: "signal", rx: 3, channels: { replies: "replies" }, tip: { format: { x: (v) => v.toFixed(1), y: false } } }), Plot.ruleX([0])],
    }));
  }

  // weekly
  $("#weekly-card").hidden = !a.weekly.length;
  if (a.weekly.length && me) {
    const busiest = [...a.weekly].sort((x, y) => y.conversations - x.conversations)[0];
    $("#weekly-so").textContent = `You used it in ${fmt.format(active)} of the ${fmt.format(spanWeeks)} weeks since ${a.span[0].toISOString().slice(0, 10)}; your busiest week (${busiest.week.toISOString().slice(0, 10)}) had ${fmt.format(busiest.conversations)} conversations.`;
    $("#weekly-fig").replaceChildren(Plot.plot({
      width: Math.min(1060, $("#weekly-fig").clientWidth || 900), height: 240, marginLeft: 50,
      y: { label: "conversations per week", grid: true }, x: { label: null },
      marks: [Plot.rectY(a.weekly, { x1: "week", x2: (d) => new Date(+d.week + 6 * 864e5), y: "conversations", fill: css("--c1"), tip: true }), Plot.ruleY([0])],
    }));
  } else if (a.weekly.length) {
    const rr = a.weekly.filter((w) => w.return_rate != null);
    const med = rr.length ? [...rr].sort((x, y) => x.return_rate - y.return_rate)[Math.floor(rr.length / 2)].return_rate : null;
    $("#weekly-so").textContent = med != null ? `A median of ${pct(med)} of each week's people come back the following week.` : "Not enough consecutive weeks to measure return.";
    $("#weekly-fig").replaceChildren(Plot.plot({
      width: Math.min(1060, $("#weekly-fig").clientWidth || 900), height: 240, marginLeft: 50,
      y: { label: "people per week", grid: true }, x: { label: null },
      marks: [Plot.areaY(a.weekly, { x: "week", y: "users", fill: css("--c1"), fillOpacity: 0.12 }), Plot.lineY(a.weekly, { x: "week", y: "users", stroke: css("--c1"), strokeWidth: 1.75, tip: true })],
    }));
  }

  if (!me) setupCompare(a);
  setupChange(a, me);
  setupFailures(norm, a, me);
}

// ---------- did my change help? ----------
const sg = (x) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}`;
const day = (d) => d.toISOString().slice(0, 10);
function setupChange(a, me) {
  const card = $("#change-card");
  const dated = a.rows.filter((r) => r.ts);
  if (dated.length < a.rows.length * 0.5) {
    card.querySelector(".controls").hidden = true;
    $("#chg").innerHTML = `<div class="verdict overlap"><span class="badge">needs timestamps</span><p style="margin-top:10px">Add a <code>timestamp</code> per conversation to compare before and after a change.</p></div>`;
    return;
  }
  card.querySelector(".controls").hidden = false;
  // For one person, the change points on offer are the first use of each new model.
  const changes = me ? versionChanges(a.rows, "model") : versionChanges(a.rows);
  const label = (c) => (me ? `started using ${esc(c.version)} (${day(c.at)})` : `${esc(c.version)} (after ${esc(c.previous)}, first seen ${day(c.at)})`);
  $("#chg-at").innerHTML = changes.map((c, i) => `<option value="v${i}">${label(c)}</option>`).join("") + `<option value="custom">Pick a date…</option>`;
  const ts = dated.map((r) => +r.ts).sort((x, y) => x - y);
  $("#chg-date").min = day(new Date(ts[0])); $("#chg-date").max = day(new Date(ts[ts.length - 1]));
  $("#chg-date").value = day(new Date(ts[Math.floor(ts.length / 2)]));
  // Default to the latest change with enough conversations on both sides to read; otherwise the middle of the history.
  const readable = changes.map((c, i) => [i, ts.filter((x) => x < +c.at).length]).filter(([, n]) => n >= 30 && ts.length - n >= 30);
  $("#chg-at").value = readable.length ? `v${readable[readable.length - 1][0]}` : "custom";
  $("#chg-i").innerHTML = `<option value="">all</option>` + a.intents.map((i) => `<option value="${esc(i.intent)}">${esc(i.intent)}</option>`).join("");
  const draw = (track) => {
    const sel = $("#chg-at").value, custom = sel === "custom";
    $("#chg-date-wrap").hidden = !custom;
    const at = custom ? new Date($("#chg-date").value + "T00:00:00Z") : changes[Number(sel.slice(1))].at;
    const c = beforeAfter(a.rows, at, $("#chg-m").value, $("#chg-i").value || null, me ? "conversation" : "person");
    if (last) last.change = { ...c, label: custom ? day(at) : (me ? "started using " : "") + changes[Number(sel.slice(1))].version };
    const max = Math.max(c.naiveA || 0, c.naiveB || 0, c.matchedA || 0, c.matchedB || 0, 0.01) * 1.1;
    const row = (label, v, cls) => `<div class="cmp-row"><span>${esc(label)}</span><div class="tr"><div class="br ${cls}" style="width:${(100 * (v || 0) / max).toFixed(1)}%"></div></div><b>${pct(v)}</b></div>`;
    const pl = c.placebo && c.placebo.gap != null ? `<p class="so" style="margin-top:6px">Placebo at ${day(c.placebo.at)}: ${sg(c.placebo.gap)} pts [${sg(c.placebo.ci[0])}, ${sg(c.placebo.ci[1])}]${c.verdict.key === "trend" ? ": a shift in the same direction was already under way" : c.placebo.ci[0] > 0 || c.placebo.ci[1] < 0 ? "" : ": no shift before the change"}.</p>` : "";
    const bars = me
      ? `<div><h3>Your conversations · ${fmt.format(c.nB)} before, ${fmt.format(c.nA)} after</h3>${row("before", c.naiveB, "a")}${row("after", c.naiveA, "b")}${c.matchedGap != null ? pl : ""}</div>`
      : `<div><h3>Everyone · ${fmt.format(c.nB)} conversations before, ${fmt.format(c.nA)} after</h3>${row("before", c.naiveB, "a")}${row("after", c.naiveA, "b")}</div>
        <div><h3>The same people on both sides · ${fmt.format(c.matchedUsers)} people</h3>${c.matchedGap != null ? row("before", c.matchedB, "a") + row("after", c.matchedA, "b") + pl : `<p class="so">Fewer than 30 people were active on both sides.</p>`}</div>`;
    const head = c.matchedGap != null && c.verdict.title !== "Nothing to compare" ? `${sg(c.matchedGap)} pts${me ? " after this date" : " for the same people"}` : "";
    $("#chg").innerHTML = `<div class="cmp-bars">${bars}</div>
      <div class="verdict ${c.verdict.key}"><span class="badge">${esc(c.verdict.title)}</span><h3>${head}</h3><p>${esc(c.verdict.text)}</p></div>`;
    if (track) window.loupeTrack?.("try_change", { verdict: c.verdict.key, metric: c.metric, marked_by: custom ? "date" : "version" });
  };
  ["#chg-at", "#chg-m", "#chg-i", "#chg-date"].forEach((s) => $(s).onchange = () => draw(true));
  draw(false);
}

// ---------- failures to tests ----------
function setupFailures(norm, a, me) {
  // When responders are model names, splitting failures by them repeats the naive model comparison; group by intent only.
  const byResp = !respAreModels(a);
  const cases = failureCases(norm, a), themes = backlog(cases, a, byResp);
  const reasons = last?.rules ? failureReasons(cases, last.rules) : [];
  // the most common reason in each backlog row, for the CSV
  const byId = Object.fromEntries(reasons.map((r) => [r.id, r.label]));
  for (const t of themes) {
    const n = {}; for (const c of cases) if (c.intent === t.intent && (!byResp || c.responder === t.responder)) n[c.reason] = (n[c.reason] || 0) + 1;
    const top = Object.entries(n).sort((x, y) => y[1] - x[1])[0]; t.top_reason = top ? byId[top[0]] : "";
  }
  if (last) Object.assign(last, { cases, themes, reasons });
  drawReasons(reasons, cases.length, me);
  const card = $("#fx-card");
  card.querySelector(".fx-actions").hidden = !cases.length;
  if (!cases.length) { $("#fx-so").textContent = "No corrections or repeated requests found in this file."; $("#fx-table").innerHTML = ""; $("#why").innerHTML = ""; return; }
  const top = themes[0];
  const multi = byResp && new Set(themes.map((x) => x.responder)).size > 1;
  $("#fx-so").textContent = me
    ? `${fmt.format(cases.length)} of your conversations had a correction or a repeated request. The biggest theme is ${top.intent}: ${fmt.format(top.failures)} failures${top.share != null ? `, ${pct(top.share)} of your ${top.intent} conversations` : ""}. Replay them against another model or new instructions to see whether it would have done better.`
    : `${fmt.format(cases.length)} conversations had a correction or a repeated request. The biggest theme is ${top.intent}${multi ? ` answered by ${top.responder}` : ""}: ${fmt.format(top.failures)} failures${top.share != null ? `, ${pct(top.share)} of the ${top.intent} conversations ${multi ? "it replied in" : ""}`.trimEnd() : ""}.` +
    (byResp || me ? "" : " Failures are not split by model here: different people use each model, so check model gaps with Model or users? above.");
  $("#fx-table").innerHTML = `<div class="tablewrap"><table class="grid"><thead><tr><th>theme</th>${multi ? "<th>responder</th>" : ""}<th>failures</th><th>${multi ? "of its conversations in the theme" : "of the theme's conversations"}</th><th>a conversation that failed began with</th></tr></thead><tbody>${
    themes.slice(0, 8).map((x) => `<tr><td>${esc(x.intent)}</td>${multi ? `<td>${esc(x.responder)}</td>` : ""}<td>${fmt.format(x.failures)}</td><td>${pct(x.share)}</td><td class="fx-ex">${esc(x.examples[0] || "")}</td></tr>`).join("")}</tbody></table></div>`;
}

// Why they failed: one bar per reason, with what to try and the person's own words as examples.
function drawReasons(reasons, total, me) {
  const box = $("#why");
  if (!box) return;
  if (!reasons.length) { box.innerHTML = ""; return; }
  const max = reasons[0].count;
  box.innerHTML = `<h3 class="why-h">${me ? "Why your conversations failed" : "Why they failed"}</h3>
    <div class="why-list">${reasons.map((r) => `<details class="why-row"><summary>
        <span class="why-label">${esc(r.label)}</span><span class="why-bar"><i style="width:${(100 * r.count / max).toFixed(1)}%"></i></span><span class="why-n">${fmt.format(r.count)} · ${pct(r.share)}</span></summary>
        <p class="why-plain">${esc(r.plain)} <b>What to try:</b> ${esc(r.fix)}</p>
        ${r.examples.length ? `<ul class="why-ex">${r.examples.map((e) => `<li>“${esc(e)}”</li>`).join("")}</ul>` : ""}</details>`).join("")}</div>
    <p class="why-note">Read from what ${me ? "you" : "people"} said when ${me ? "you" : "they"} pushed back, using transparent keyword rules (no AI reads your messages). Click a reason for examples.</p>`;
}

const transcript = (msgs) => msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n").slice(-20000);
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const EXPORTS = {
  jsonl: () => ["loupe-eval-cases.jsonl", "application/jsonl", last.cases.map((c) => JSON.stringify(c)).join("\n") + "\n"],
  promptfoo: () => ["promptfooconfig.yaml", "application/yaml", [
    `# Loupe regression cases: ${last.cases.length} conversations from ${last.name} where the person corrected the reply or asked again.`,
    "# Review before committing: these are real user messages. Set the provider to your assistant, then run: npx promptfoo eval",
    `description: ${JSON.stringify("Loupe regression cases from " + last.name)}`,
    "prompts:", "  - \"{{transcript}}\"",
    "providers:", "  - openai:gpt-4.1-mini  # replace with your assistant",
    "tests:",
    ...last.cases.flatMap((c) => [
      `  - description: ${JSON.stringify(`${c.intent} · ${c.responder} · ${c.reason || c.failure} · ${c.id}`)}`,
      "    vars:", `      transcript: ${JSON.stringify(transcript(c.context))}`,
      "    assert:", "      - type: llm-rubric",
      `        value: ${JSON.stringify(`Answer the user's last message well, without the problem the user flagged after a previous answer. That answer was: "${c.bad_reply.slice(0, 600)}". The user then said: "${c.user_feedback.slice(0, 600)}".`)}`,
    ]),
  ].join("\n") + "\n"],
  csv: () => ["loupe-backlog.csv", "text/csv", [["theme", "responder", "failures", "share_of_theme_conversations", "corrections", "repeats", "most_common_reason", "example_1", "example_2", "example_3"].join(","),
    ...last.themes.map((x) => [x.intent, x.responder ?? "all", x.failures, x.share == null ? "" : x.share.toFixed(4), x.corrections, x.repeats, x.top_reason || "", ...[0, 1, 2].map((i) => x.examples[i] || "")].map(csvCell).join(","))].join("\n") + "\n"],
};
document.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", () => {
  if (!last || !last.cases.length) return;
  const [file, type, body] = EXPORTS[b.dataset.export]();
  const url = URL.createObjectURL(new Blob([body], { type }));
  Object.assign(document.createElement("a"), { href: url, download: file }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  window.loupeTrack?.("try_export", { format: b.dataset.export, cases: sizeBucket(last.cases.length) });
}));

const weekStart = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return +x; };
const MIN_PERSONAL_REPLIES = 30;
// When every responder is a model name, per-responder friction is the naive model comparison again.
const respAreModels = (a) => a.responders.length > 0 && a.responders.every((r) => a.models.includes(r.responder));

function setupCompare(a) {
  const card = $("#compare-card");
  const models = a.models;
  if (models.length < 2) {
    card.querySelector(".controls").hidden = true;
    $("#cmp").innerHTML = `<div class="verdict overlap"><span class="badge">needs two models</span><p style="margin-top:10px">This file has ${models.length ? "one model" : "no model field"}. Add a <code>model</code> field per conversation, or a <code>responder</code> per reply, to compare.</p></div>`;
    return;
  }
  card.querySelector(".controls").hidden = false;
  const counts = Object.fromEntries(models.map((m) => [m, a.rows.filter((r) => r.model === m).length]));
  const sorted = [...models].sort((x, y) => counts[y] - counts[x]);
  const opt = (m) => `<option value="${esc(m)}">${esc(m)} (${fmt.format(counts[m])})</option>`;
  $("#cmp-a").innerHTML = sorted.map(opt).join(""); $("#cmp-b").innerHTML = sorted.map(opt).join("");
  const one = (m) => { const xs = a.rows.filter((r) => r.model === m); return xs.reduce((s, r) => s + (r.oneTurn ? 1 : 0), 0) / Math.max(1, xs.length); };
  const [x0, x1] = [sorted[0], sorted[1]].sort((x, y) => one(y) - one(x));
  $("#cmp-a").value = x0; $("#cmp-b").value = x1;
  $("#cmp-i").innerHTML = `<option value="">all</option>` + a.intents.map((i) => `<option value="${esc(i.intent)}">${esc(i.intent)}</option>`).join("");
  const draw = (track) => {
    const A = $("#cmp-a").value, Bm = $("#cmp-b").value, m = $("#cmp-m").value, it = $("#cmp-i").value || null;
    if (A === Bm) { $("#cmp").innerHTML = `<div class="verdict overlap"><span class="badge">pick two different models</span></div>`; return; }
    const c = compareModels(a.rows, A, Bm, m, it);
    if (last) last.compare = c;
    const max = Math.max(c.naiveA || 0, c.naiveB || 0, c.matchedA || 0, c.matchedB || 0, 0.01) * 1.1;
    const row = (label, v, cls) => `<div class="cmp-row"><span>${esc(label)}</span><div class="tr"><div class="br ${cls}" style="width:${(100 * (v || 0) / max).toFixed(1)}%"></div></div><b>${pct(v)}</b></div>`;
    $("#cmp").innerHTML = `<div class="cmp-bars">
        <div><h3>Across everyone who used each model · ${fmt.format(c.nA)} vs ${fmt.format(c.nB)} conversations</h3>${row(A, c.naiveA, "a")}${row(Bm, c.naiveB, "b")}</div>
        <div><h3>The same people on both · ${fmt.format(c.matchedUsers)} people</h3>${c.matchedGap != null ? row(A, c.matchedA, "a") + row(Bm, c.matchedB, "b") : `<p class="so">Fewer than 30 people used both.</p>`}</div>
      </div>
      <div class="verdict ${c.verdict.key}"><span class="badge">${esc(c.verdict.title)}</span><h3>${c.naiveGap != null ? `Dashboard gap ${c.naiveGap >= 0 ? "+" : ""}${(c.naiveGap * 100).toFixed(1)} pts` : ""}${c.matchedGap != null ? ` → same people ${c.matchedGap >= 0 ? "+" : ""}${(c.matchedGap * 100).toFixed(1)} pts` : ""}</h3><p>${esc(c.verdict.text)}</p></div>`;
    if (track) window.loupeTrack?.("try_compare", { verdict: c.verdict.key, metric: m });
  };
  ["#cmp-a", "#cmp-b", "#cmp-m", "#cmp-i"].forEach((s) => $(s).onchange = () => draw(true));
  draw(false);
}

// ---------- inputs ----------
// Personal exports arrive as one zip (ChatGPT) or, from Claude, as a manifest of one-time links to several zips
// (conversations-000.zip, projects-000.zip, ...). Several files can be dropped at once; their conversations are merged.
const FFLATE = "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";
const NOT_CONVERSATIONS = /(^|\/)(users?|projects?|memories|manifest[^/]*|account[^/]*|settings|shared_conversations|message_feedback|model_comparisons)\.json$/i;
const EXPORT_HOSTS = /^https:\/\/(claude\.ai|chatgpt\.com|chat\.openai\.com)\//;

async function textsFrom(f) {
  if (!/\.zip$/i.test(f.name)) return [{ name: f.name, text: await f.text() }];
  const { unzipSync, strFromU8 } = await import(FFLATE);
  const buf = new Uint8Array(await f.arrayBuffer());
  const pick = (ok) => unzipSync(buf, { filter: (e) => /\.jsonl?$/i.test(e.name) && !NOT_CONVERSATIONS.test(e.name) && ok(e.name) });
  let files = pick((n) => /conversation/i.test(n));
  if (!Object.keys(files).length) files = pick(() => true);
  return Object.keys(files).sort().map((k) => ({ name: k, text: strFromU8(files[k]) }));
}

// An export manifest lists download links rather than conversations; point at the conversations part.
function manifestHelp(text) {
  if (text.length > 1e6 || !/"export_url"/.test(text)) return null;
  let doc; try { doc = JSON.parse(text); } catch { return null; }
  const files = Array.isArray(doc && doc.data_files) ? doc.data_files : null;
  if (!files) return null;
  const conv = files.filter((d) => /conversation/i.test(`${d.category || ""} ${d.filename || ""}`) && EXPORT_HOSTS.test(String(d.export_url || "")));
  const links = conv.map((d) => `<a href="${esc(d.export_url)}" target="_blank" rel="noopener">${esc(d.filename || "conversations")}</a>`).join(", ");
  return `This is the export's manifest, a list of download links, not the conversations. ` +
    (links ? `Download ${links} (each link works once and expires 24 hours after the export), then drop ${conv.length > 1 ? "them" : "it"} here.` : `Download the conversations file it lists, then drop it here.`);
}

function parseAny(text) {
  const s = text.replace(/^﻿/, "").trim();
  if (!s) return [];
  try { const d = JSON.parse(s); return Array.isArray(d) ? d : Array.isArray(d.conversations) ? d.conversations : Array.isArray(d.data) ? d.data : [d]; }
  catch { return s.split(/\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)); }
}

async function readFiles(list, source) {
  const fs = [...list];
  if (!fs.length) return;
  for (const f of fs) {
    const zip = /\.zip$/i.test(f.name);
    if (f.size > (zip ? MAX_ZIP_BYTES : MAX_BYTES)) { status(`${f.name} is ${(f.size / 1e6).toFixed(0)} MB; this page handles up to ${zip ? "1 GB zips" : "200 MB"}. Try a sample of it.`, true); return; }
  }
  try {
    status(fs.some((f) => /\.zip$/i.test(f.name)) ? "Opening the zip in your browser…" : "Reading the file…");
    const parts = (await Promise.all(fs.map(textsFrom))).flat();
    for (const p of parts) {
      const help = manifestHelp(p.text);
      if (help) { statusHtml(help); window.loupeTrack?.("try_failed", { source, message: "export manifest" }); return; }
    }
    if (!parts.length) throw new Error(`No conversation files in ${fs.map((f) => f.name).join(", ")}. From a Claude export, drop conversations-000.zip; from ChatGPT, the export zip or the conversations.json inside it.`);
    if (parts.length === 1) { run(parts[0].text, parts[0].name, source); return; }
    run(JSON.stringify(parts.flatMap((p) => parseAny(p.text))), "conversations.json", source);
  } catch (e) {
    status(e.message || String(e), true);
    window.loupeTrack?.("try_failed", { source, message: String(e.message || e).slice(0, 120) });
  }
}

// ---------- copy summary ----------
function summary() {
  const { norm, a, name, compare: c } = last;
  const p1 = (x) => pct(x, 1);
  const top3 = a.intents.filter((i) => i.intent !== "other").slice(0, 3).map((i) => `${i.intent} ${pct(i.share, 0)}`).join(", ");
  const real = a.intents.filter((i) => i.intent !== "other" && i.n >= 20);
  const worst = [...real].sort((x, y) => y.repeat - x.repeat)[0];
  const span = a.span ? `, ${a.span[0].toISOString().slice(0, 10)} to ${a.span[1].toISOString().slice(0, 10)}` : "";
  const lines = [norm.personal
    ? `My AI use, read by Loupe (${fmt.format(a.n)} ${norm.format.replace(" export", "")} conversations${span})`
    : `Loupe read of ${name} (${fmt.format(a.n)} conversations, ${a.realUsers ? fmt.format(a.nUsers) + " people" : "no user field"}${span})`];
  if (top3) lines.push(`- ${norm.personal ? "What I use it for" : "Top uses"}: ${top3}`);
  lines.push(`- Friction: ${p1(a.repeat)} of conversations re-ask the same thing, ${p1(a.correction)} correct a reply${worst ? `; worst in ${worst.intent} (${p1(worst.repeat)} re-ask)` : ""}`);
  const resp = a.responders.filter((r) => !norm.personal || r.replies >= MIN_PERSONAL_REPLIES);
  if (resp.length >= 2 && (norm.personal || !respAreModels(a))) {
    const w = [...resp].sort((x, y) => (y.repeatPer1k + y.correctionPer1k) - (x.repeatPer1k + x.correctionPer1k))[0];
    lines.push(`- Most friction: ${w.responder}, ${w.repeatPer1k.toFixed(0)} repeats and ${w.correctionPer1k.toFixed(0)} corrections per 1,000 replies`);
  }
  if (!norm.personal && c && c.naiveGap != null) {
    const sig = { oneTurn: "ended in one turn", repeat: "repeated request", correction: "correction follow-up" }[c.metric];
    const sg = (x) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}`;
    lines.push(`- Model or users (${c.a} vs ${c.b}, ${sig}${c.intent ? ", " + c.intent : ""}): dashboard gap ${sg(c.naiveGap)} pts` +
      (c.matchedGap != null ? `, same ${fmt.format(c.matchedUsers)} people ${sg(c.matchedGap)} pts [${sg(c.ci[0])}, ${sg(c.ci[1])}]` : "") + ` → ${c.verdict.title}`);
  }
  const ch = last.change;
  if (ch && ch.verdict) {
    const sig = { oneTurn: "ended in one turn", repeat: "repeated request", correction: "correction follow-up" }[ch.metric];
    const who = ch.unit === "conversation" ? `across ${fmt.format(ch.nB + ch.nA)} conversations` : `for the same ${fmt.format(ch.matchedUsers)} people`;
    lines.push(`- Did the change help (${ch.label}, ${sig}${ch.intent ? ", " + ch.intent : ""}): ${ch.verdict.title}` + (ch.matchedGap != null ? `, ${sg(ch.matchedGap)} pts ${who} [${sg(ch.ci[0])}, ${sg(ch.ci[1])}]` : ""));
  }
  if (last.cases.length) {
    const tp = last.themes[0];
    lines.push(`- ${fmt.format(last.cases.length)} failed conversations exported as eval cases; biggest theme ${tp.intent} (${fmt.format(tp.failures)})`);
  }
  if (!norm.personal && a.weekly.length) {
    const rr = a.weekly.filter((w) => w.return_rate != null).map((w) => w.return_rate).sort((x, y) => x - y);
    if (rr.length) lines.push(`- Weekly return: median ${p1(rr[Math.floor(rr.length / 2)])}`);
  }
  lines.push("Computed in the browser; nothing uploaded. https://loupe.shankard.com/try/");
  return lines.join("\n");
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: s }); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.append(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
}
$("#copy-sum").addEventListener("click", async () => {
  if (!last) return;
  const s = summary();
  $("#sum-text").textContent = s;
  const ok = await copyText(s);
  $("#copy-ok").textContent = ok ? `Copied ${s.split("\n").length} lines. Paste into Slack or a doc.` : "Copy blocked by the browser; select the text below.";
  $("#sum-wrap").hidden = false; $("#sum-wrap").open = true;
  window.loupeTrack?.("try_copied", { personal: last.norm.personal, has_compare: !!last.compare });
});
$("#file").addEventListener("change", (e) => readFiles(e.target.files, "file"));
const drop = $("#drop");
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#file").click(); } });
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => readFiles(e.dataTransfer.files, "drop"));
document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", async () => {
  const name = b.dataset.sample;
  status("Loading the sample…");
  const text = await (await fetch(new URL(`samples/${name}`, import.meta.url))).text();
  window.loupeTrack?.("try_sample", { sample: name });
  run(text, name, "sample");
}));
classifier().catch(() => {});  // warm the model while the visitor reads
