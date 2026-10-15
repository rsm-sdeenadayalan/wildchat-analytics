import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm";
import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.17/+esm";

export const AGGREGATES = [
  "volume_daily_model", "volume_weekly_country", "volume_weekly_language",
  "intensity_weekly", "pseudo_user_persistence_quarterly", "depth_by_model",
  "intent_weekly", "intent_by_model", "intent_by_language",
  "friction_by_intent_model", "friction_weekly", "data_quality_weekly",
  "intensity_weekly_model", "intent_weekly_model", "friction_weekly_model", "data_quality_weekly_model",
  "friction_by_intent_model_era", "friction_by_responder",
];

const $ = (sel) => document.querySelector(sel);
const fmtInt = new Intl.NumberFormat("en-US");
const fmtPct = (x, d = 1) => (x == null ? "–" : (100 * x).toFixed(d) + "%");
const fmtPct0 = (x) => (x == null ? "–" : Math.round(100 * x) + "%");
const fmtPts = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1)} pts`;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const palette = () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => css(`--c${i}`));
const seq = () => [1, 2, 3, 4, 5].map((i) => css(`--seq-${i}`));
const utc = { timeZone: "UTC" };
const fmtWeek = (d) => (d ? `week of ${new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...utc })}` : "–");
const fmtMonth = (d) => new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric", ...utc });
const pctChange = (a, b) => (b ? (a - b) / b : null);
const describeChange = (c) => (c == null ? "flat" : Math.abs(c) < 0.005 ? "flat" : `${c > 0 ? "up" : "down"} ${Math.abs(100 * c).toFixed(0)}%`);
const sum = (rows, f) => rows.reduce((a, r) => a + (f ? f(r) : r), 0);
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const dim = (hover, key) => (hover && key !== hover ? 0.15 : 1);
const by = (rows, keyFn, valFn) => {
  const m = new Map();
  for (const r of rows) m.set(keyFn(r), (m.get(keyFn(r)) || 0) + valFn(r));
  return m;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// The WildChat collection changed how person keys persist around this date; return rates
// before and after are not comparable (trends report, F1).
export const COLLECTION_BREAK = new Date("2024-10-01T00:00:00Z");
const finding = (n) => new URL(`docs/07-trends-report.html#f${n}`, import.meta.url).href;

const RENDERERS = {};
export function registerRenderer(name, fn) { RENDERERS[name] = fn; }

// Cross-view model filter. One model family or null for all. Every renderer reads it; views that
// have no per-model cut (countries, languages, persistence) say so with a scope tag.
export const FILTER = { model: null, models: [] };
const sqlQuote = (v) => `'${String(v).replace(/'/g, "''")}'`;
const modelWhere = (col = "model") => (FILTER.model ? ` AND ${col} = ${sqlQuote(FILTER.model)}` : "");
const perModel = (table) => (FILTER.model ? `${table}_model` : table);
const scopeLabel = () => (FILTER.model ? FILTER.model : "all models");

export async function boot() {
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  const meta = await (await fetch(new URL("aggregates/meta.json", import.meta.url))).json();
  const conn = await db.connect();
  for (const name of AGGREGATES) {
    const buf = await (await fetch(new URL(`aggregates/${name}.parquet`, import.meta.url))).arrayBuffer();
    await db.registerFileBuffer(`${name}.parquet`, new Uint8Array(buf));
    await conn.query(`CREATE VIEW ${name} AS SELECT * FROM '${name}.parquet'`);
  }
  return { db, conn, meta };
}

export async function q(conn, sql) {
  const table = await conn.query(sql);
  // Arrow JS serializes DATE as epoch milliseconds and TIMESTAMP as an integer in the column's unit;
  // convert those columns back to JS Dates so axes and tables show dates, not numbers.
  const dateCols = new Map();
  for (const f of table.schema.fields) {
    const t = String(f.type);
    if (/^Date/.test(t)) dateCols.set(f.name, 1);
    else if (/^Timestamp<NANO/.test(t)) dateCols.set(f.name, 1e-6);
    else if (/^Timestamp<MICRO/.test(t)) dateCols.set(f.name, 1e-3);
    else if (/^Timestamp<MILLI/.test(t)) dateCols.set(f.name, 1);
    else if (/^Timestamp<SECOND/.test(t)) dateCols.set(f.name, 1e3);
  }
  return table.toArray().map((row) => {
    const o = row.toJSON();
    for (const k in o) {
      const v = o[k];
      if (v == null) continue;
      if (dateCols.has(k)) { o[k] = v instanceof Date ? v : new Date(Number(v) * dateCols.get(k)); continue; }
      if (typeof v === "bigint") o[k] = Number(v);
      else if (typeof v === "object" && !(v instanceof Date) && typeof v.toString === "function" && /^-?\d+$/.test(v.toString())) o[k] = Number(v.toString());
    }
    return o;
  });
}

// ---------- UI primitives ----------

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function tile(label, value, sub) {
  return `<div class="tile"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
}

// A view's opening card: the question a product owner would ask, answered from the aggregates.
// Each answer shows its first sentence; the rest of the evidence waits behind "More".
function splitLead(html) {
  const re = /\.(?:<\/b>)?\s+(?=[A-Z<])/g;
  let m;
  while ((m = re.exec(html))) {
    const cut = m.index + m[0].trimEnd().length;
    const lead = html.slice(0, cut);
    if (lead.replace(/<[^>]+>/g, "").length >= 40) return [lead, html.slice(cut).trim()];
  }
  return [html, ""];
}
// Label names read as words in sentences: "writing_and_business" becomes "writing and business"; "other" is quoted.
function niceKind(k, capital = false) {
  if (k === "other") return capital ? '"Other"' : '"other"';
  const t = String(k).replace(/_/g, " ");
  return capital ? t[0].toUpperCase() + t.slice(1) : t;
}
const plainLabels = (html) => html.replace(/(^|[^\w"'=-])([a-z]+(?:_[a-z]+)+)(?=[^\w"']|$)/g, (m, pre, w) => pre + w.replace(/_/g, " "));
function insight(view, question, items, link) {
  const parts = items.map((i) => splitLead(plainLabels(i)));
  const more = parts.some(([, rest]) => rest);
  const card = el(`<div class="card insight"><p class="eyebrow">The question</p><h2>${question}</h2>
    <ul class="facts">${parts.map(([lead, rest]) => `<li>${lead}${rest ? `<span class="rest"> ${rest}</span>` : ""}</li>`).join("")}</ul>
    <div class="insight-foot">${more ? `<button type="button" class="more-toggle" aria-expanded="false">More detail</button>` : ""}${link ? `<a class="more" href="${link.href}">${link.text}&nbsp;→</a>` : ""}</div></div>`);
  card.querySelector(".more-toggle")?.addEventListener("click", (e) => {
    const open = card.classList.toggle("expanded");
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "Less" : "More detail";
  });
  view.append(card);
  return card;
}

// A chart card with its own clickable legend. `series` fixes the colour of every key; `draw`
// re-renders the figure whenever the viewer isolates, compares, or hovers a series.
function chart(view, { title, so, note, series, draw, scope, caption }) {
  const tag = scope === "all" && FILTER.model ? `<span class="scope" title="This chart has no per-model cut">All models</span>` : "";
  const [lead, rest] = so ? splitLead(plainLabels(so)) : ["", ""];
  const card = el(`<div class="card chart"><div class="card-head"><h2>${title}${tag}</h2>${lead ? `<p class="so">${lead}</p>` : ""}</div>
    <div class="legend" role="group" aria-label="Series"></div><figure></figure>
    ${note || caption || rest ? `<details class="def"><summary>What this measures</summary>${rest ? `<p>${rest}</p>` : ""}${note ? `<p>${note}</p>` : ""}${caption ? `<p class="keys">${caption}</p>` : ""}</details>` : ""}</div>`);
  view.append(card);
  const legend = card.querySelector(".legend");
  const fig = card.querySelector("figure");
  let active = null; // null = all series shown
  let hover = null;
  const isOn = (k) => !active || active.has(k);
  const render = () => {
    const w = Math.min(1060, fig.clientWidth || view.clientWidth || 1060);
    fig.replaceChildren(draw({ isOn, hover, w, active }));
    legend.querySelectorAll(".chip[data-key]").forEach((c) => c.classList.toggle("off", !isOn(c.dataset.key)));
    legend.querySelector(".chip-all").hidden = !active;
  };
  for (const s of series) {
    const swatch = s.dash ? `background: repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)` : `background: ${s.color}`;
    const chip = el(`<button type="button" class="chip" data-key="${esc(s.key)}" aria-pressed="false"><i style="${swatch}"></i>${esc(s.label ?? s.key)}</button>`);
    chip.addEventListener("click", (e) => {
      if (series.length === 1) return;
      if (e.shiftKey) {
        active = active ? new Set(active) : new Set(series.map((x) => x.key));
        active.has(s.key) ? active.delete(s.key) : active.add(s.key);
        if (active.size === series.length || active.size === 0) active = null;
      } else {
        active = active && active.size === 1 && active.has(s.key) ? null : new Set([s.key]);
      }
      hover = null;
      window.loupeTrack?.("series_isolated", { chart: title, key: s.key, compare: !!e.shiftKey });
      legend.querySelectorAll(".chip[data-key]").forEach((c) => c.setAttribute("aria-pressed", String(!!active && active.has(c.dataset.key))));
      render();
    });
    chip.addEventListener("mouseenter", () => { if (series.length > 1 && (!active || active.size > 1)) { hover = s.key; render(); } });
    chip.addEventListener("mouseleave", () => { if (hover) { hover = null; render(); } });
    legend.append(chip);
  }
  legend.append(el(`<button type="button" class="chip chip-all" hidden>Show all</button>`));
  legend.querySelector(".chip-all").addEventListener("click", () => { active = null; hover = null; render(); });
  if (series.length > 1) legend.append(el(`<span class="hint">Click a series to isolate it · shift-click to compare</span>`));
  render();
  return card;
}

function tableEl(rows, limit = 200) {
  if (!rows.length) return Object.assign(document.createElement("p"), { textContent: "No rows." });
  const cols = Object.keys(rows[0]);
  const wrap = document.createElement("div");
  wrap.className = "tablewrap";
  // NULL is shown as a muted "null", as a SQL client would, never as an empty cell that looks like a bug.
  const fmt = (v) => v == null ? `<span class="null" title="NULL: this value is undefined for this row">null</span>`
    : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "number" && !Number.isInteger(v) ? v.toFixed(4) : esc(v);
  wrap.innerHTML = `<table class="grid"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0, limit).map((r) => `<tr>${cols.map((c) => `<td>${fmt(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return wrap;
}

// Marks shared by every weekly time series: a dashed rule at the collection break.
function breakMarks(label = "collection break") {
  // Only draw the break when it falls inside the weeks on the chart (a model retired before it has nothing to mark).
  if (DATA.from) { const [a, b] = range(); if (COLLECTION_BREAK < a || COLLECTION_BREAK > new Date(+b + WEEK_MS)) return []; }
  return [
    Plot.ruleX([COLLECTION_BREAK], { stroke: css("--muted"), strokeDasharray: "3 4", strokeOpacity: 0.7 }),
    Plot.text([COLLECTION_BREAK], { x: (d) => d, text: () => label, frameAnchor: "top", dy: 6, dx: 6, textAnchor: "start", fill: css("--muted"), fontSize: 11 }),
  ];
}

const completeThrough = (meta) => new Date(meta.complete_weeks_through + "T00:00:00Z");
const WEEK_MS = 7 * 86400000;
const weeksBetween = (a, b) => { const out = []; for (let t = +a; t <= +b; t += WEEK_MS) out.push(new Date(t)); return out; };
// Tooltips list every channel; hide the styling ones.
const TIP = { format: { strokeOpacity: false, fillOpacity: false, z: false } };

// Dataset facts filled at boot: the complete-week range, weeks with no conversations at all
// (collection outages), and each model family's window in the logs.
export const DATA = { from: null, through: null, outages: [], windows: new Map(), modelWeeks: new Map() };

// The weeks a weekly chart spans: the dataset's complete weeks, or the selected model's own window.
function range() {
  const w = FILTER.model ? DATA.windows.get(FILTER.model) : null;
  return w ? [w.w0, w.w1 < DATA.through ? w.w1 : DATA.through] : [DATA.from, DATA.through];
}
// Weeks to shade: collection outages, plus the selected model's own zero-traffic weeks.
function shadedWeeks() {
  const [a, b] = range();
  const present = FILTER.model ? DATA.modelWeeks.get(FILTER.model) : null;
  return weeksBetween(a, b).filter((w) => DATA.outages.some((o) => +o === +w) || (present && !present.has(+w)));
}
function bandMarks() {
  const weeks = shadedWeeks();
  if (!weeks.length) return [];
  const label = (w) => (DATA.outages.some((o) => +o === +w) ? "collection offline" : `no ${FILTER.model} conversations`);
  return [Plot.rectX(weeks, { x1: (d) => d, x2: (d) => new Date(+d + WEEK_MS), fill: css("--fg"), fillOpacity: 0.045, title: label })];
}
const timeMarks = (label) => [...bandMarks(), ...breakMarks(label)];
const fmtDay = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...utc });

// Weeks in which a model family first or last appears in the logs, merged per week so a handoff
// ("gpt-3.5-turbo ends, gpt-4o-mini begins") is one marker with one tooltip.
function handoffEvents(models) {
  const byWeek = new Map();
  const add = (week, text) => { const k = +week; if (!byWeek.has(k)) byWeek.set(k, { week: new Date(k), ends: [], begins: [] }); byWeek.get(k)[text.kind].push(text.model); };
  for (const m of models) {
    const w = DATA.windows.get(m);
    if (!w) continue;
    if (w.w0 > DATA.from) add(w.w0, { kind: "begins", model: m });
    if (w.w1 < DATA.through) add(w.w1, { kind: "ends", model: m });
  }
  return [...byWeek.values()].sort((a, b) => a.week - b.week).map((e) => ({
    ...e,
    ended: e.ends.length ? e.ends.join(", ") : null,
    began: e.begins.length ? e.begins.join(", ") : null,
  }));
}
const CAPTION_RATES = "Dashed rule: collection break · Shaded: no conversations that week · Dotted: no measurement that week, line carried across";
const CAPTION_COUNTS = "Dashed rule: collection break · Shaded: no conversations that week";

// Count series: a week with no rows inside the series' window is a true zero, so draw it as one.
function fillZeros(rows, { key = null, value, windowOf }) {
  const groups = key ? [...new Set(rows.map((r) => r[key]))] : [null];
  const out = [];
  for (const g of groups) {
    const mine = key ? rows.filter((r) => r[key] === g) : rows;
    const have = new Map(mine.map((r) => [+r.week, r]));
    const [a, b] = windowOf ? windowOf(g) : range();
    for (const w of weeksBetween(a, b)) out.push(have.get(+w) ?? { ...(key ? { [key]: g } : {}), week: w, [value]: 0 });
  }
  return out.sort((x, y) => x.week - y.week);
}
// Rate series: a week with no conversations has no rate. Insert null rows so the solid line
// breaks there, and return dotted bridge segments that carry the eye across each gap.
function bridged(rows, { key = null, value }) {
  const groups = key ? [...new Set(rows.map((r) => r[key]))] : [null];
  const [a, b] = range();
  const out = [], bridges = [];
  for (const g of groups) {
    const mine = key ? rows.filter((r) => r[key] === g) : rows;
    const have = new Map(mine.filter((r) => r[value] != null).map((r) => [+r.week, r]));
    let prev = null, inGap = false, gapId = 0;
    for (const w of weeksBetween(a, b)) {
      const r = have.get(+w);
      if (r) {
        if (inGap && prev) { bridges.push({ ...prev, gap: `${g}-${gapId}` }, { ...r, gap: `${g}-${gapId}` }); gapId++; }
        out.push(r); prev = r; inGap = false;
      } else {
        out.push({ ...(key ? { [key]: g } : {}), week: w, [value]: null }); inGap = true;
      }
    }
  }
  return { rows: out.sort((x, y) => x.week - y.week), bridges };
}
function bridgeMark(bridges, { value, stroke }) {
  return Plot.lineY(bridges, { x: "week", y: value, z: "gap", stroke, strokeWidth: 1.5, strokeDasharray: "2 4", strokeOpacity: 0.8 });
}

// Compare the last 12 complete weeks with the 12 before, for a share-per-week series.
function lastVsPrior(rows, weekKey, valueFn) {
  const weeks = [...new Set(rows.map((r) => +r[weekKey]))].sort((a, b) => a - b);
  const recent = new Set(weeks.slice(-12)), prior = new Set(weeks.slice(-24, -12));
  return {
    recent: valueFn(rows.filter((r) => recent.has(+r[weekKey]))),
    prior: valueFn(rows.filter((r) => prior.has(+r[weekKey]))),
    enough: weeks.length >= 24,
  };
}

// ---------- Overview ----------

export async function renderOverview(conn, meta) {
  const view = $("#view-overview");
  view.innerHTML = "";
  const through = completeThrough(meta);
  const [tot] = await q(conn, `SELECT sum(conversations)::BIGINT AS convs, sum(turns)::BIGINT AS turns, min(date) AS d0, max(date) AS d1 FROM volume_daily_model WHERE true${modelWhere()}`);
  const [users] = await q(conn, `SELECT max(pseudo_users) AS peak_users FROM ${perModel("intensity_weekly")} WHERE true${modelWhere()}`);
  const allWeekly = (await q(conn, `SELECT date_trunc('week', date)::DATE AS week, model, sum(conversations)::BIGINT AS conversations FROM volume_daily_model GROUP BY ALL ORDER BY week`))
    .filter((r) => r.week <= through);
  const weekly = FILTER.model ? allWeekly.filter((r) => r.model === FILTER.model) : allWeekly;
  const intensity = (await q(conn, `SELECT * FROM ${perModel("intensity_weekly")} WHERE true${modelWhere()} ORDER BY week`)).filter((r) => r.week <= through);
  const last = intensity.at(-1) || {};
  const lastRet = [...intensity].reverse().find((r) => r.return_rate != null);

  const totals = [...by(weekly, (r) => +r.week, (r) => r.conversations)].map(([w, c]) => ({ week: new Date(w), conversations: c })).sort((a, b) => a.week - b.week);
  const recent = totals.slice(-12), prior = totals.slice(-24, -12);
  const change = pctChange(sum(recent, (r) => r.conversations), sum(prior, (r) => r.conversations));
  const recentWeeks = new Set(recent.map((r) => +r.week));
  const recentByModel = [...by(allWeekly.filter((r) => recentWeeks.has(+r.week)), (r) => r.model, (r) => r.conversations)].sort((a, b) => b[1] - a[1]);
  const recentAll = sum(recentByModel, ([, n]) => n);
  const [topModel, topN] = recentByModel[0] || ["–", 0];
  const thisModelRecent = recentByModel.find(([m]) => m === FILTER.model)?.[1] ?? 0;
  const peak = totals.reduce((a, b) => (b.conversations > a.conversations ? b : a), totals[0]);
  const latest = totals.at(-1);

  view.innerHTML = `<div class="tiles">
    ${tile("conversations", fmtInt.format(tot.convs))}
    ${tile("turns", fmtInt.format(tot.turns))}
    ${tile("complete weeks with data", fmtInt.format(totals.length))}
    ${tile("peak weekly people", fmtInt.format(users.peak_users ?? 0))}
    ${tile(FILTER.model ? "week-over-week return (same model)" : "week-over-week return", fmtPct(lastRet?.return_rate), lastRet ? fmtWeek(lastRet.week) : "no measurable week")}
    ${tile("intent coverage", meta.intent_coverage)}
  </div>`;

  const win = FILTER.model ? DATA.windows.get(FILTER.model) : null;
  const retired = win && win.w1 < DATA.through ? `<b>${esc(FILTER.model)}</b> left the logs after the ${fmtWeek(win.w1)}. ` : "";
  // The dashboard's point is what to do next; say so before the charts.
  view.append(el(`<div class="card start"><p><b>Start with what to do.</b> What to fix first (with a backlog to download), which differences between models are real, and a way to score your tests by what people actually ask.</p><a class="chip" href="#next">Open Next steps&nbsp;→</a></div>`));
  insight(view, FILTER.model ? `Is ${esc(FILTER.model)} usage growing, or is it the same power users?` : "Is usage growing, or is it the same power users?", [
    `${retired}<b>${fmtInt.format(sum(recent, (r) => r.conversations))}</b> conversations in the last 12 complete weeks, ${prior.length ? describeChange(change) + " versus the 12 weeks before" : "with no earlier 12-week window to compare against"}.`,
    last.week ? `In the ${fmtWeek(last.week)}, the top 10% of ${FILTER.model ? "its " : ""}people produced <b>${fmtPct(last.top10_share)}</b> of conversations; the median person had ${(last.convs_per_user_p50 ?? 0).toFixed(1)} conversation${last.convs_per_user_p50 === 1 ? "" : "s"}.` : `No complete week has enough ${esc(FILTER.model)} people to report intensity.`,
    FILTER.model
      ? (topModel === FILTER.model
          ? `<b>${esc(FILTER.model)}</b> was the largest model in its last 12 complete weeks, at ${fmtPct0(thisModelRecent / Math.max(1, recentAll))} of all traffic.`
          : `<b>${esc(FILTER.model)}</b> was ${fmtPct0(thisModelRecent / Math.max(1, recentAll))} of all traffic in its last 12 complete weeks; ${esc(topModel)} was the largest model at ${fmtPct0(topN / Math.max(1, recentAll))}.`)
      : `<b>${esc(topModel)}</b> served ${fmtPct0(topN / Math.max(1, recentAll))} of recent traffic. The model behind the logs changed several times over the period, so compare eras, not just dates.`,
  ], { href: finding(3), text: "Read finding F3 in the trends report" });

  const models = [...by(weekly, (r) => r.model, (r) => r.conversations)].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  const colors = palette();
  chart(view, {
    title: FILTER.model ? `Weekly ${FILTER.model} conversations` : "Weekly conversations by model",
    so: latest ? `Latest complete week: ${fmtInt.format(latest.conversations)} conversations, ${describeChange(pctChange(latest.conversations, peak.conversations))} from the peak in the ${fmtWeek(peak.week)}.` : "No complete weeks for this model.",
    note: "Stacked by model: the height is the total conversations that week, and each color is the share served by one model family. The chatbot behind the logs switched models on fixed dates, so one color handing over to the next is a configuration change, not users leaving; the dots mark those weeks and name the models. A week with no conversations is drawn as zero; the partial final week is excluded.",
    caption: CAPTION_COUNTS + " · Dots: a model's first or last week in the logs, hover for which",
    series: models.map((m, i) => ({ key: m, color: colors[i % colors.length] })),
    draw: ({ isOn, hover, w }) => {
      // Every model gets a row for every week in range (zero outside its window) so the stack is well defined.
      const rows = fillZeros(weekly.filter((r) => isOn(r.model)), { key: "model", value: "conversations", windowOf: () => range() });
      const shown = models.filter(isOn);
      const totals = by(rows, (r) => +r.week, (r) => r.conversations);
      const events = handoffEvents(shown).map((e) => ({ ...e, total: totals.get(+e.week) ?? 0 }));
      // Layer midpoints for the tooltip, stacked in the same order as the areas; zero rows are skipped.
      const cum = new Map();
      const tipPoints = [];
      for (const m of shown) for (const r of rows.filter((r) => r.model === m)) {
        const base = cum.get(+r.week) || 0;
        if (r.conversations > 0) tipPoints.push({ week: r.week, model: m, conversations: r.conversations, ended: null, began: null, y: base + r.conversations / 2 });
        cum.set(+r.week, base + r.conversations);
      }
      for (const e of events) tipPoints.push({ week: e.week, model: null, conversations: null, ended: e.ended, began: e.began, y: e.total });
      const endMark = win && win.w1 < DATA.through && latest ? [
        Plot.text([latest], { x: "week", y: "conversations", text: () => "last week in logs", dy: -14, fill: css("--muted"), fontSize: 11, textAnchor: "end" })] : [];
      return Plot.plot({
        width: w, height: 320, marginLeft: 60, marginTop: 24,
        color: { domain: models, range: colors },
        x: { label: null }, y: { label: "conversations / week", grid: true },
        marks: [...timeMarks(),
          Plot.areaY(rows, Plot.stackY({ order: shown }, { x: "week", y: "conversations", fill: "model", fillOpacity: (d) => 0.9 * dim(hover, d.model) })),
          Plot.lineY(rows, Plot.stackY2({ order: shown }, { x: "week", y: "conversations", z: "model", stroke: "#fff", strokeWidth: 1, strokeOpacity: 0.7 })),
          Plot.dot(events, { x: "week", y: "total", r: 4.5, fill: "#fff", stroke: css("--fg"), strokeWidth: 1.5 }),
          // One tooltip layer: measured layer midpoints (never the zero-filled rows) plus the handoff markers.
          Plot.tip(tipPoints, Plot.pointer({ x: "week", y: "y", maxRadius: 28,
            channels: { model: "model", "conversations / week": "conversations", "last week served": "ended", "first week served": "began" },
            format: { y: false, x: (d) => fmtWeek(d) } })),
          ...endMark],
      });
    },
  });
}
registerRenderer("overview", renderOverview);

// ---------- Intensity ----------

function quarterLabel(d) {
  const dt = new Date(d);
  return `${dt.getUTCFullYear()} Q${Math.floor(dt.getUTCMonth() / 3) + 1}`;
}

export async function renderIntensity(conn, meta) {
  const view = $("#view-intensity");
  view.innerHTML = "";
  const through = completeThrough(meta);
  const weekly = (await q(conn, `SELECT * FROM ${perModel("intensity_weekly")} WHERE true${modelWhere()} ORDER BY week`)).filter((r) => r.week <= through);
  const last = weekly.at(-1) || {};
  const lastRet = [...weekly].reverse().find((r) => r.return_rate != null);
  const preBreak = weekly.filter((r) => r.week < COLLECTION_BREAK && r.return_rate != null);
  const postBreak = weekly.filter((r) => r.week >= COLLECTION_BREAK && r.return_rate != null);
  const preMedian = median(preBreak.map((r) => r.return_rate));
  const postMedian = median(postBreak.map((r) => r.return_rate));
  const c1 = css("--c1"), c7 = css("--c7");
  const retNote = FILTER.model ? " Return here is model retention: a person counts as returned only if they used this model again the following week." : "";

  const depth = await q(conn, `SELECT model, depth_bucket, conversations FROM depth_by_model WHERE true${modelWhere()}`);
  const order = ["1", "2", "3-5", "6-10", "11+"];
  const depthTotals = by(depth, (r) => r.model, (r) => r.conversations);
  depth.forEach((r) => (r.share = r.conversations / depthTotals.get(r.model)));
  const allConvs = sum(depth, (r) => r.conversations);
  const singleShare = sum(depth.filter((r) => r.depth_bucket === "1"), (r) => r.conversations) / allConvs;
  const multiByModel = [...by(depth.filter((r) => !["1", "2"].includes(r.depth_bucket)), (r) => r.model, (r) => r.share)].sort((a, b) => b[1] - a[1]);
  const singleByModel = [...by(depth.filter((r) => r.depth_bucket === "1"), (r) => r.model, (r) => r.share)].sort((a, b) => b[1] - a[1]);
  const modelOrder = singleByModel.map(([m]) => m);

  view.innerHTML = `<div class="tiles">
    ${tile("people", fmtInt.format(last.pseudo_users ?? 0), fmtWeek(last.week))}
    ${tile(FILTER.model ? "week-over-week return (same model)" : "week-over-week return", fmtPct(lastRet?.return_rate), lastRet ? fmtWeek(lastRet.week) : "no measurable week")}
    ${tile("top-10% share of conversations", fmtPct(last.top10_share), fmtWeek(last.week))}
    ${tile("conversations / person (p50)", (last.convs_per_user_p50 ?? 0).toFixed(1), fmtWeek(last.week))}
  </div>`;

  const retLine = preMedian != null
    ? `Before October 2024 (April 2023 to September 2024), week-over-week return${FILTER.model ? ` to ${esc(FILTER.model)}` : ""} held at a median of <b>${fmtPct(preMedian)}</b>${postMedian != null ? `; since a change in how the data was collected (October 2024) it reads ${fmtPct(postMedian)}` : ""}.`
    : postMedian != null
      ? `${esc(FILTER.model)} only has weeks after the October 2024 change in data collection, after which returning people can no longer be recognised, so its return rate (median <b>${fmtPct(postMedian)}</b>) understates real return and cannot be compared with earlier models.`
      : `No week has enough ${esc(FILTER.model)} people to measure return.`;
  const depthLine = FILTER.model
    ? `<b>${fmtPct0(singleShare)}</b> of ${esc(FILTER.model)} conversations end after one turn; ${fmtPct0(multiByModel[0]?.[1] ?? 0)} run three or more turns.`
    : `<b>${fmtPct0(singleShare)}</b> of all conversations end after one turn. ${esc(multiByModel[0]?.[0] ?? "–")} carries the most multi-turn work (${fmtPct0(multiByModel[0]?.[1])} run three or more turns); ${esc(singleByModel[0]?.[0] ?? "–")} the least (${fmtPct0(singleByModel[0]?.[1])} single-turn).`;
  insight(view, FILTER.model ? `Are ${esc(FILTER.model)} users coming back?` : "Are people coming back?", [
    retLine,
    `From ${fmtMonth(COLLECTION_BREAK)} the data stops recognising returning people, so return reads near zero afterwards. That is a change in data collection, not people leaving.${retNote}`,
    depthLine,
  ], { href: finding(1), text: "Read findings F1, F2 and F4 in the trends report" });

  chart(view, {
    title: "Week-over-week return rate",
    so: lastRet ? `${fmtPct(lastRet.return_rate)} in the ${fmtWeek(lastRet.week)}${preMedian != null ? `, against a median of ${fmtPct(preMedian)} before October 2024` : ""}.` : "No week has a measurable return rate.",
    note: `Share of people active in a week who are active again the following week. Weeks whose following week is not in the data are drawn as gaps, not zeros.${retNote}`,
    series: [{ key: "return rate", color: c1 }],
    caption: CAPTION_RATES,
    draw: ({ w }) => {
      const { rows, bridges } = bridged(weekly, { value: "return_rate" });
      return Plot.plot({
        width: w, height: 260, marginLeft: 50, y: { label: "return rate", grid: true, percent: true }, x: { label: null },
        marks: [...timeMarks(), bridgeMark(bridges, { value: "return_rate", stroke: c1 }),
          Plot.lineY(rows, { x: "week", y: "return_rate", stroke: c1, strokeWidth: 1.75, tip: TIP })],
      });
    },
  });

  chart(view, {
    title: "People per week, and how concentrated their use is",
    so: `${fmtInt.format(last.pseudo_users ?? 0)} people in the ${fmtWeek(last.week)}; the top 10% of them produced ${fmtPct(last.top10_share)} of that week's conversations.`,
    note: "Top panel: people active each week. Bottom panel: share of the week's conversations that came from its 10% most active people. A rising share with a falling user count means the remaining usage is concentrated in fewer hands.",
    series: [{ key: "people", color: c1 }, { key: "top-10% share", color: c7 }],
    caption: CAPTION_RATES,
    draw: ({ isOn, hover, w }) => {
      const box = document.createElement("div");
      box.className = "panels";
      const both = isOn("people") && isOn("top-10% share");
      const users = fillZeros(weekly, { value: "pseudo_users" });
      const share = bridged(weekly, { value: "top10_share" });
      if (isOn("people")) box.append(Plot.plot({
        width: w, height: both ? 200 : 260, marginLeft: 60, marginBottom: both ? 10 : 30,
        x: { label: null, axis: both ? null : "bottom" }, y: { label: "people / week", grid: true, insetBottom: 8 },
        marks: [...timeMarks(),
          Plot.areaY(users, { x: "week", y: "pseudo_users", fill: c1, fillOpacity: 0.12 * dim(hover, "people") }),
          Plot.lineY(users, { x: "week", y: "pseudo_users", stroke: c1, strokeWidth: 1.75, strokeOpacity: dim(hover, "people"), tip: TIP })],
      }));
      if (isOn("top-10% share")) box.append(Plot.plot({
        width: w, height: both ? 190 : 260, marginLeft: 60, marginTop: 24,
        x: { label: null }, y: { label: "top-10% share · 50 = half of all conversations", grid: true, percent: true, domain: [0, 100], ticks: [0, 25, 50, 75, 100] },
        marks: [...(both ? [...bandMarks(), ...breakMarks().slice(0, 1)] : timeMarks()),
          Plot.ruleY([0.5], { stroke: css("--fg"), strokeOpacity: 0.35 }),
          bridgeMark(share.bridges, { value: "top10_share", stroke: c7 }),
          Plot.lineY(share.rows, { x: "week", y: "top10_share", stroke: c7, strokeWidth: 1.75, strokeOpacity: dim(hover, "top-10% share"), tip: TIP })],
      }));
      return box;
    },
  });

  const perUser = weekly.flatMap((r) => [{ week: r.week, stat: "median", value: r.convs_per_user_p50 }, { week: r.week, stat: "90th percentile", value: r.convs_per_user_p90 }]);
  chart(view, {
    title: "Conversations per person per week",
    so: `A typical person has ${(last.convs_per_user_p50 ?? 0).toFixed(1)} conversations a week; the heaviest tenth have ${(last.convs_per_user_p90 ?? 0).toFixed(1)} or more.`,
    note: "Median (solid) and 90th percentile (dashed) conversations per active person per week.",
    series: [{ key: "median", color: c1 }, { key: "90th percentile", color: c7, dash: true }],
    caption: CAPTION_RATES,
    draw: ({ isOn, hover, w }) => {
      const med = bridged(perUser.filter((r) => r.stat === "median"), { value: "value" });
      const p90 = bridged(perUser.filter((r) => r.stat === "90th percentile"), { value: "value" });
      return Plot.plot({
        width: w, height: 240, marginLeft: 50, y: { label: "conversations", grid: true }, x: { label: null },
        color: { domain: ["median", "90th percentile"], range: [c1, c7] },
        marks: [...timeMarks(),
          ...(isOn("median") ? [bridgeMark(med.bridges, { value: "value", stroke: c1 }), Plot.lineY(med.rows, { x: "week", y: "value", stroke: c1, strokeWidth: 1.75, strokeOpacity: dim(hover, "median"), tip: TIP })] : []),
          ...(isOn("90th percentile") ? [bridgeMark(p90.bridges, { value: "value", stroke: c7 }), Plot.lineY(p90.rows, { x: "week", y: "value", stroke: c7, strokeWidth: 1.75, strokeDasharray: "5 4", strokeOpacity: dim(hover, "90th percentile"), tip: TIP })] : [])],
      });
    },
  });

  const persistence = await q(conn, `SELECT * FROM pseudo_user_persistence_quarterly ORDER BY quarter`);
  persistence.forEach((r) => (r.quarter_label = quarterLabel(r.quarter)));
  const pre = persistence.filter((r) => r.quarter < COLLECTION_BREAK), post = persistence.filter((r) => r.quarter >= COLLECTION_BREAK);
  chart(view, {
    title: "How long people keep coming back",
    so: `Before 2024 Q4, about ${fmtPct0(median(pre.map((r) => r.share_multi_week)))} of a quarter's people were active in more than one week; since then, about ${fmtPct(median(post.map((r) => r.share_multi_week)))}.`,
    note: "Share of a quarter's people active in more than one week. The drop after 2024 Q3 is a property of the collection (person keys stopped persisting), not of user behavior; return rates are not comparable across that boundary.",
    series: [{ key: "share active in more than one week", color: c1 }],
    scope: "all",
    draw: ({ w }) => Plot.plot({
      width: w, height: 240, marginLeft: 50, marginBottom: w < 640 ? 48 : 30, y: { label: "share active in >1 week", grid: true, percent: true }, x: { label: null, tickRotate: w < 640 ? -40 : 0 },
      marks: [Plot.barY(persistence, { x: "quarter_label", y: "share_multi_week", fill: (d) => (d.quarter < COLLECTION_BREAK ? c1 : css("--seq-2")), tip: TIP, rx: 4 })],
    }),
  });

  const seqColors = seq();
  chart(view, {
    title: FILTER.model ? `Session depth, ${FILTER.model}` : "Session depth by model",
    so: FILTER.model ? `${fmtPct0(singleShare)} single-turn; ${fmtPct0(multiByModel[0]?.[1] ?? 0)} run three or more turns.` : `Sorted by single-turn share. ${esc(singleByModel[0]?.[0] ?? "–")} is single-turn ${fmtPct0(singleByModel[0]?.[1])} of the time; ${esc(singleByModel.at(-1)?.[0] ?? "–")} ${fmtPct0(singleByModel.at(-1)?.[1])}.`,
    note: "Distribution of turns per conversation, per model family. A turn is one user message and one reply. Isolate a bucket to compare models on it directly.",
    series: order.map((b, i) => ({ key: b, label: `${b} turn${b === "1" ? "" : "s"}`, color: seqColors[i] })),
    draw: ({ isOn, hover, w, active }) => {
      const rows = depth.filter((r) => isOn(r.depth_bucket));
      const single = active && active.size === 1;
      return Plot.plot({
        width: w, height: 40 + 30 * modelOrder.length, marginLeft: 100,
        color: { domain: order, range: seqColors },
        x: { label: single ? `share of model's conversations with ${[...active][0]} turn(s)` : "share of model's conversations", grid: true, percent: true },
        y: { label: null, domain: single ? [...rows].sort((a, b) => b.share - a.share).map((r) => r.model) : modelOrder },
        marks: [Plot.barX(rows, single
          ? { y: "model", x: "share", fill: "depth_bucket", tip: TIP, rx: 4 }
          : Plot.stackX({ order: order, offset: null }, { y: "model", x: "share", fill: "depth_bucket", fillOpacity: (d) => dim(hover, d.depth_bucket), tip: TIP, inset: 0.5 }))],
      });
    },
  });
}
registerRenderer("intensity", renderIntensity);

// ---------- Data quality ----------

export async function renderQuality(conn, meta) {
  const view = $("#view-quality");
  view.innerHTML = `<div class="tiles">
    ${tile("minimum cell size", meta.min_cell)}
    ${tile("shards processed", `${meta.shards} / 86`)}
    ${tile("taxonomy", meta.taxonomy_version)}
    ${tile("aggregates size", (meta.aggregate_bytes / 1e6).toFixed(1) + " MB")}
  </div>`;
  const through = completeThrough(meta);
  const dq = (await q(conn, `SELECT * FROM ${perModel("data_quality_weekly")} WHERE true${modelWhere()} ORDER BY week`)).filter((r) => r.week <= through);
  const lastDq = dq.at(-1) || {};
  const countries = await q(conn, `SELECT country, sum(conversations)::BIGINT AS conversations FROM volume_weekly_country GROUP BY country ORDER BY 2 DESC LIMIT 15`);
  const [{ total_c }] = await q(conn, `SELECT sum(conversations)::BIGINT AS total_c FROM volume_weekly_country`);
  const notRecordedC = (countries.find((r) => r.country === "not recorded")?.conversations ?? 0) / total_c;
  const smallC = (countries.find((r) => r.country === "small cells")?.conversations ?? 0) / total_c;
  const isResidual = (v) => v === "not recorded" || v === "small cells";
  const langs = await q(conn, `SELECT language, sum(conversations)::BIGINT AS conversations FROM volume_weekly_language GROUP BY language ORDER BY 2 DESC LIMIT 12`);
  const [{ total_l }] = await q(conn, `SELECT sum(conversations)::BIGINT AS total_l FROM volume_weekly_language`);
  const topLang = langs.find((r) => !isResidual(r.language));
  const c1 = css("--c1"), c2 = css("--c2"), c3 = css("--c3");

  insight(view, "What in these numbers can I trust?", [
    `Intent labels cover <b>${fmtPct(meta.intent_share)}</b> of ${FILTER.model ? "all " : ""}conversations. The classifier is ${fmtPct(meta.classifier_accuracy)} accurate; the most it could be is about ${fmtPct(meta.classifier_rater_agreement)}, because two AI labelers agree with each other only that often.`,
    `<b>${fmtPct(notRecordedC)}</b> of ${FILTER.model ? "all " : ""}conversations have no country recorded and another ${fmtPct(smallC)} fall in groups too small to show (under ${meta.min_cell} conversations), so treat geography as a rough guide. Language is nearly complete, but one top-10 language is probably a mistake by the language detector.`,
    `Token counts exist only from ${meta.token_coverage_first_week} and cover ${fmtPct(lastDq.token_usage_coverage)} of ${scopeLabel() === "all models" ? "" : esc(FILTER.model) + " "}conversations in the latest complete week, so token metrics are not reported.`,
  ], { href: finding(6), text: "Read findings F6 and F7 in the trends report" });

  const pii = dq.flatMap((r) => [{ week: r.week, signal: "redacted for PII", rate: r.redacted_rate }, { week: r.week, signal: "empty user input", rate: r.empty_input_rate }]);
  chart(view, {
    title: "Personal details removed, and empty messages",
    so: `Latest complete week: ${fmtPct(lastDq.redacted_rate)} of conversations had personal details removed, ${fmtPct(lastDq.empty_input_rate)} with an empty user message.`,
    note: "Share of conversations the dataset authors redacted for PII, and share with an empty user message (a quirk of the collection chatbot).",
    series: [{ key: "redacted for PII", color: c2 }, { key: "empty user input", color: c1 }],
    caption: CAPTION_RATES,
    draw: ({ isOn, hover, w }) => {
      const { rows, bridges } = bridged(pii.filter((r) => isOn(r.signal)), { key: "signal", value: "rate" });
      return Plot.plot({
        width: w, height: 240, marginLeft: 50, y: { label: "share", grid: true, percent: true }, x: { label: null },
        color: { domain: ["redacted for PII", "empty user input"], range: [c2, c1] },
        marks: [...timeMarks(), bridgeMark(bridges, { value: "rate", stroke: "signal" }),
          Plot.lineY(rows, { x: "week", y: "rate", stroke: "signal", strokeWidth: 1.75, strokeOpacity: (d) => dim(hover, d.signal), tip: TIP })],
      });
    },
  });
  chart(view, {
    title: "How many conversations record token counts",
    so: `Zero before ${meta.token_coverage_first_week}; ${fmtPct(lastDq.token_usage_coverage)} in the latest complete week.`,
    note: "Share of conversations whose logs include token counts. The field did not exist before 2024-09-09 and is spotty afterwards; token metrics are only valid where this is high.",
    series: [{ key: "coverage", color: c1 }],
    caption: CAPTION_RATES,
    draw: ({ w }) => {
      const { rows, bridges } = bridged(dq, { value: "token_usage_coverage" });
      return Plot.plot({
        width: w, height: 200, marginLeft: 50, x: { label: null },
        y: { label: "coverage", grid: true, percent: true, domain: [0, Math.max(10, Math.ceil(100 * Math.max(0, ...dq.map((r) => r.token_usage_coverage || 0))))] },
        marks: [...timeMarks(), Plot.areaY(rows, { x: "week", y: "token_usage_coverage", fill: c1, fillOpacity: 0.12 }),
          bridgeMark(bridges, { value: "token_usage_coverage", stroke: c1 }),
          Plot.lineY(rows, { x: "week", y: "token_usage_coverage", stroke: c1, strokeWidth: 1.75, tip: TIP })],
      });
    },
  });
  chart(view, {
    title: "Top countries",
    so: `${esc(countries.find((r) => !isResidual(r.country))?.country ?? "–")} leads. ${fmtPct(notRecordedC)} of conversations have no country recorded and ${fmtPct(smallC)} fall in groups too small to show; both are kept as their own muted bars.`,
    note: `Conversations whose logs carry no country are published as a "not recorded" row, and week × country cells with fewer than ${meta.min_cell} conversations are folded into a "small cells" row, so the bars always sum to the total. Nothing is dropped and no individual country is hidden.`,
    series: [{ key: "conversations", color: c1 }],
    scope: "all",
    draw: ({ w }) => Plot.plot({
      width: w, height: 360, marginLeft: 150, x: { label: "conversations", grid: true }, y: { label: null },
      marks: [Plot.barX(countries, { y: "country", x: "conversations", fill: (d) => (isResidual(d.country) ? css("--seq-2") : c1), sort: { y: "-x" }, tip: TIP, rx: 4 })],
    }),
  });
  chart(view, {
    title: "Top languages",
    so: `${esc(topLang?.language ?? "–")} is ${fmtPct0((topLang?.conversations ?? 0) / total_l)} of conversations. "Yoruba" in the top ten is most likely a mistake by the language detector.`,
    note: `Most frequently detected language per conversation. Week × language cells under the ${meta.min_cell}-conversation floor are folded into a "small cells" row, kept as its own muted bar (under 1% of conversations); a "not recorded" row would appear if any conversation lacked a detected language.`,
    series: [{ key: "conversations", color: c3 }],
    scope: "all",
    draw: ({ w }) => Plot.plot({
      width: w, height: 320, marginLeft: 150, x: { label: "conversations", grid: true }, y: { label: null },
      marks: [Plot.barX(langs, { y: "language", x: "conversations", fill: (d) => (isResidual(d.language) ? css("--seq-2") : c3), sort: { y: "-x" }, tip: TIP, rx: 4 })],
    }),
  });
}
registerRenderer("quality", renderQuality);

// ---------- Intent ----------

function noIntent(view) {
  view.innerHTML = `<div class="card"><h2>Intent not available</h2><p class="note">The classify stage has not produced intent labels for this build. See Data quality → coverage.</p></div>`;
}

function reliabilityCard(meta) {
  const acc = meta.classifier_accuracy, agree = meta.classifier_rater_agreement;
  if (acc == null) return null;
  const perClass = meta.classifier_per_class_f1 || {};
  const rows = Object.entries(perClass).sort((a, b) => b[1] - a[1]).map(([c, f]) => `${c} ${fmtPct(f)}`).join(" · ");
  const gate = agree != null
    ? `Two independent labeling models agree ${fmtPct(agree)} of the time on this taxonomy (n=${meta.classifier_rater_study_n}); the release gate is ${meta.classifier_threshold_rule}, i.e. ${fmtPct(meta.classifier_threshold)}.`
    : `Release gate: ${fmtPct(meta.classifier_threshold)} held-out accuracy.`;
  return el(`<details class="card reliability"><summary><h2>How reliable are these labels?</h2><span class="so">Right ${fmtPct(acc)} of the time on conversations held back for testing; two AI labelers agree with each other only ${fmtPct(agree)} of the time, so that is the ceiling. Treat a 5-point difference as real and a 2-point one as noise.</span></summary>
    <p class="note">Every conversation's intent is predicted by a classifier trained on model-labeled examples (taxonomy ${meta.classifier_taxonomy_version}).
    Held-out accuracy: <b>${fmtPct(acc)}</b> on ${fmtInt.format(meta.classifier_n_test || 0)} conversations. ${gate}${meta.classifier_forced ? " The gate was overridden for this build." : ""}</p>
    <p class="note">Per-class reliability (F1): ${rows}</p></details>`);
}

export async function renderIntent(conn, meta) {
  const view = $("#view-intent");
  if (meta.intent_coverage === "none") return noIntent(view);
  view.innerHTML = "";
  const through = completeThrough(meta);
  const weekly = (await q(conn, `SELECT week, intent, conversations FROM ${perModel("intent_weekly")} WHERE true${modelWhere()} ORDER BY week`)).filter((r) => r.week <= through);
  const weekTotals = by(weekly, (r) => +r.week, (r) => r.conversations);
  weekly.forEach((r) => (r.share = r.conversations / weekTotals.get(+r.week)));
  const allByModel = await q(conn, `SELECT model, intent, conversations FROM intent_by_model`);
  const byModel = FILTER.model ? allByModel.filter((r) => r.model === FILTER.model) : allByModel;
  const modelTotals = by(byModel, (r) => r.model, (r) => r.conversations);
  byModel.forEach((r) => (r.share = r.conversations / modelTotals.get(r.model)));
  const byLang = await q(conn, `SELECT language, intent, conversations FROM intent_by_language`);
  const langTotals = by(byLang, (r) => r.language, (r) => r.conversations);
  byLang.forEach((r) => (r.share = r.conversations / langTotals.get(r.language)));

  const intents = [...by(allByModel, (r) => r.intent, (r) => r.conversations)].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  const colors = palette();
  const color = Object.fromEntries(intents.map((i, k) => [i, colors[k % colors.length]]));
  const overall = by(byModel, (r) => r.intent, (r) => r.conversations);
  const overallN = sum(byModel, (r) => r.conversations);

  const shareIn = (rows) => { const t = sum(rows, (r) => r.conversations); return Object.fromEntries(intents.map((i) => [i, sum(rows.filter((r) => r.intent === i), (r) => r.conversations) / Math.max(1, t)])); };
  const { recent, prior, enough } = lastVsPrior(weekly, "week", shareIn);
  const deltas = intents.map((i) => ({ intent: i, delta: recent[i] - prior[i], now: recent[i] })).sort((a, b) => b.delta - a.delta);
  const riser = deltas[0], faller = deltas.at(-1);
  const ranked = [...overall].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  const shiftLine = enough
    ? `Over the last 12 complete weeks, <b>${esc(niceKind(riser.intent))}</b> rose most (${fmtPts(riser.delta)}, to ${fmtPct0(riser.now)}) and <b>${esc(niceKind(faller.intent))}</b> fell most (${fmtPts(faller.delta)}, to ${fmtPct0(faller.now)}) versus the 12 weeks before.`
    : `${esc(FILTER.model)} has fewer than 24 complete weeks, so there is no earlier 12-week window to measure a shift against; the largest class in its last 12 weeks is <b>${esc(deltas.sort((a, b) => b.now - a.now)[0]?.intent ?? "–")}</b>.`;

  const rel = reliabilityCard(meta);
  insight(view, FILTER.model ? `What are people using ${esc(FILTER.model)} for, and what is shifting?` : "What are people using it for, and what is shifting?", [
    `<b>${esc(niceKind(ranked[0], true))}</b> ${ranked[0] === "questions" ? "are" : "is"} the largest use at ${fmtPct0(overall.get(ranked[0]) / overallN)} of classified ${FILTER.model ? esc(FILTER.model) + " " : ""}conversations, then ${esc(niceKind(ranked[1]))} at ${fmtPct0(overall.get(ranked[1]) / overallN)}.`,
    shiftLine,
    `"other" is greetings, tests and gibberish; at ${fmtPct0(recent.other ?? 0)} of recent traffic it is the clearest sign of people probing the assistant rather than working with it.`,
  ], { href: finding(8), text: "Read findings F8 to F10 in the trends report" });
  if (rel) view.append(rel);

  const series = intents.map((i) => ({ key: i, color: color[i] }));
  const stackedShare = (data, yKey, yDomain, hover, isOn, active, w, height, marginLeft, xLabel) => {
    const rows = data.filter((r) => isOn(r.intent));
    const single = active && active.size === 1;
    return Plot.plot({
      width: w, height, marginLeft,
      color: { domain: intents, range: intents.map((i) => color[i]) },
      x: { label: single ? `share of ${xLabel} that is ${[...active][0]}` : `share of ${xLabel}`, grid: true, percent: true },
      y: { label: null, domain: single ? [...rows].sort((a, b) => b.share - a.share).map((r) => r[yKey]) : yDomain },
      marks: [Plot.barX(rows, single
        ? { y: yKey, x: "share", fill: "intent", tip: TIP, rx: 4 }
        : Plot.stackX({ order: intents, offset: null }, { y: yKey, x: "share", fill: "intent", fillOpacity: (d) => dim(hover, d.intent), tip: TIP, inset: 0.5 }))],
    });
  };

  chart(view, {
    title: "What people ask for, over time",
    so: enough ? `Last 12 weeks: ${esc(riser.intent)} ${fmtPts(riser.delta)}, ${esc(faller.intent)} ${fmtPts(faller.delta)}. Isolate an intent to see its share as a single line.` : "Isolate an intent to see its share as a single line.",
    note: "Share of each week's classified conversations by intent. Classes are defined in the metrics framework. The partial final week is excluded; weeks with no conversations are shaded, not interpolated.",
    caption: CAPTION_RATES,
    series,
    draw: ({ isOn, hover, w, active }) => {
      const { rows, bridges } = bridged(weekly.filter((r) => isOn(r.intent)), { key: "intent", value: "share" });
      return Plot.plot({
        width: w, height: 340, marginLeft: 50,
        color: { domain: intents, range: intents.map((i) => color[i]) },
        y: { label: "share of week", grid: true, percent: true }, x: { label: null },
        marks: active
          ? [...timeMarks(), Plot.areaY(rows, { x: "week", y: "share", fill: "intent", fillOpacity: 0.12 }), bridgeMark(bridges, { value: "share", stroke: "intent" }), Plot.lineY(rows, { x: "week", y: "share", stroke: "intent", strokeWidth: 1.75, tip: TIP })]
          : [...timeMarks(), Plot.areaY(rows, Plot.stackY({ order: intents }, { x: "week", y: "share", fill: "intent", fillOpacity: (d) => dim(hover, d.intent), tip: TIP }))],
      });
    },
  });

  const modelOrder = [...modelTotals].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  const codingTop = [...byModel.filter((r) => r.intent === "coding")].sort((a, b) => b.share - a.share)[0];
  chart(view, {
    title: FILTER.model ? `Intent mix, ${FILTER.model}` : "Intent mix by model",
    so: FILTER.model ? `All-time mix for ${esc(FILTER.model)}.` : codingTop ? `${esc(codingTop.model)} has the highest coding share at ${fmtPct0(codingTop.share)}. Isolate an intent to rank models on it.` : "",
    note: "Which models people reached for, by what they were trying to do. Models are ordered by total conversations.",
    series,
    draw: ({ isOn, hover, w, active }) => stackedShare(byModel, "model", modelOrder, hover, isOn, active, w, 40 + 30 * modelOrder.length, 100, "model's conversations"),
  });

  const langOrder = [...langTotals].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  chart(view, {
    title: "Intent mix by language",
    so: `Top ${langOrder.length} languages by volume. Groups under ${meta.min_cell} conversations are hidden for privacy.`,
    note: "Share of each language's classified conversations by intent, for the most common detected languages.",
    series,
    scope: "all",
    draw: ({ isOn, hover, w, active }) => stackedShare(byLang, "language", langOrder, hover, isOn, active, w, 40 + 30 * langOrder.length, 100, "language's conversations"),
  });
}
registerRenderer("intent", renderIntent);

// ---------- Friction ----------

export async function renderFriction(conn, meta) {
  const view = $("#view-friction");
  view.innerHTML = "";
  const through = completeThrough(meta);
  const weekly = (await q(conn, `SELECT * FROM ${perModel("friction_weekly")} WHERE true${modelWhere()} ORDER BY week`)).filter((r) => r.week <= through);
  // Validation (2026-10-04, model-labeled, see metrics framework): repeated request 78% and correction 96% precision are
  // kept as friction. Assistant refusal (45%) is dropped. One-and-done (41% as a failure signal) is kept only as
  // engagement depth, labelled "ended in one turn", never as friction.
  const signals = ["repeat_rate", "correction_rate"];
  const labels = { repeat_rate: "repeated request", correction_rate: "correction follow-up", one_and_done_rate: "ended in one turn" };
  const colors = palette();
  const color = { "repeated request": colors[0], "correction follow-up": colors[1], "ended in one turn": css("--c7") };
  const long = weekly.flatMap((r) => signals.map((s) => ({ week: r.week, signal: labels[s], rate: r[s] })));
  const depth = weekly.map((r) => ({ week: r.week, signal: labels.one_and_done_rate, rate: r.one_and_done_rate }));
  const avg = (rows, k) => (rows.length ? sum(rows, (r) => r[k]) / rows.length : null);
  const rep12 = lastVsPrior(weekly, "week", (rows) => avg(rows, "repeat_rate"));
  const oad = lastVsPrior(weekly, "week", (rows) => avg(rows, "one_and_done_rate"));
  const last = weekly.at(-1) || {};

  let byIntent = [];
  if (meta.intent_coverage !== "none") {
    byIntent = await q(conn, `SELECT intent, model, conversations, repeat_rate, one_and_done_rate, correction_rate, refusal_rate FROM friction_by_intent_model WHERE true${modelWhere()}`);
  }
  const big = byIntent.filter((r) => r.conversations >= 1000);
  const worstRepeat = [...big].sort((a, b) => b.repeat_rate - a.repeat_rate)[0];
  const perIntent = await q(conn, `SELECT intent, sum(conversations)::BIGINT AS n,
      sum(conversations*repeat_rate)/sum(conversations) AS repeat_rate,
      sum(conversations*one_and_done_rate)/sum(conversations) AS one_and_done_rate,
      sum(conversations*correction_rate)/sum(conversations) AS correction_rate,
      sum(conversations*refusal_rate)/sum(conversations) AS refusal_rate
    FROM friction_by_intent_model WHERE true${modelWhere()} GROUP BY intent ORDER BY n DESC`).catch(() => []);
  const realWork = perIntent.filter((r) => r.intent !== "other");
  const mostRepeated = [...realWork].sort((a, b) => b.repeat_rate - a.repeat_rate)[0];
  const mostCorrected = [...realWork].sort((a, b) => b.correction_rate - a.correction_rate)[0];

  insight(view, FILTER.model ? `Where does ${esc(FILTER.model)} fail people most?` : "Where does the assistant fail people most?", [
    worstRepeat ? `People repeat themselves most in <b>${esc(worstRepeat.intent)}${FILTER.model ? "" : ` on ${esc(worstRepeat.model)}`}</b>: ${fmtPct(worstRepeat.repeat_rate)} of those conversations re-ask the same thing (counting only combinations with at least 1,000 conversations).` : byIntent.length ? "No combination of request type and model reaches 1,000 conversations, so none is ranked." : "Friction by intent needs intent labels; this build has none.",
    rep12.recent != null ? `Repeated requests averaged <b>${fmtPct(rep12.recent)}</b> of conversations over the last 12 complete weeks${rep12.enough ? `, ${describeChange(pctChange(rep12.recent, rep12.prior))} versus the 12 weeks before` : ""}. Corrections are rarer, ${fmtPct(last.correction_rate, 2)} in the latest week, and almost always real when flagged.` : "",
    mostRepeated ? `Among real requests, <b>${esc(mostRepeated.intent)}</b> draws the most repeats (${fmtPct(mostRepeated.repeat_rate)})${mostCorrected && mostCorrected.intent !== mostRepeated.intent ? ` and <b>${esc(mostCorrected.intent)}</b> the most corrections (${fmtPct(mostCorrected.correction_rate, 2)})` : ""}. Two signals were dropped as failure measures after validation: refusal patterns fired on disclaimers 55% of the time, and 59% of one-turn conversations got what they came for.` : "",
  ].filter(Boolean), { href: finding(11), text: "Read findings F5 and F11, and the validation in the metrics framework" });

  chart(view, {
    title: "Friction signals over time",
    so: `Latest complete week: repeated request ${fmtPct(last.repeat_rate)}, correction follow-up ${fmtPct(last.correction_rate, 2)}. Both cleared the 70% precision gate in validation (78% and 96%).`,
    note: "Each signal is a proxy computed from transcript structure, then validated against 377 model-labeled conversations (metrics framework, 2026-10-04). Assistant-refusal patterns were dropped at 45% precision: in these logs they fire on the 2023 models' habit of opening a full answer with \"As an AI language model…\".",
    series: signals.map((s) => ({ key: labels[s], color: color[labels[s]] })),
    caption: CAPTION_RATES,
    draw: ({ isOn, hover, w }) => {
      const { rows, bridges } = bridged(long.filter((r) => isOn(r.signal)), { key: "signal", value: "rate" });
      return Plot.plot({
        width: w, height: 300, marginLeft: 50,
        color: { domain: signals.map((s) => labels[s]), range: signals.map((s) => color[labels[s]]) },
        y: { label: "share of conversations", grid: true, percent: true }, x: { label: null },
        marks: [...timeMarks(), bridgeMark(bridges, { value: "rate", stroke: "signal" }),
          Plot.lineY(rows, { x: "week", y: "rate", stroke: "signal", strokeWidth: 1.75, strokeOpacity: (d) => dim(hover, d.signal), tip: TIP })],
      });
    },
  });

  chart(view, {
    title: "Conversations that end after one turn",
    so: `${fmtPct(last.one_and_done_rate)} in the latest complete week${oad.enough ? `, ${describeChange(pctChange(oad.recent, oad.prior))} over 12 weeks` : ""}. This is engagement depth, not failure: in validation, 59% of these people got what they came for.`,
    note: "Share of conversations with exactly one turn and a reply under 200 characters. Until 2026-10-04 the dashboard called this \"one-and-done\" and counted it as friction. Validation found most such conversations are short questions answered correctly, greetings, or tests, so it is now shown as a measure of how much people engage, separate from the friction signals.",
    series: [{ key: labels.one_and_done_rate, color: color["ended in one turn"] }],
    caption: CAPTION_RATES,
    draw: ({ w }) => {
      const { rows, bridges } = bridged(depth, { value: "rate" });
      return Plot.plot({
        width: w, height: 220, marginLeft: 50, y: { label: "share of conversations", grid: true, percent: true }, x: { label: null },
        marks: [...timeMarks(), Plot.areaY(rows, { x: "week", y: "rate", fill: color["ended in one turn"], fillOpacity: 0.12 }),
          bridgeMark(bridges, { value: "rate", stroke: color["ended in one turn"] }),
          Plot.lineY(rows, { x: "week", y: "rate", stroke: color["ended in one turn"], strokeWidth: 1.75, tip: TIP })],
      });
    },
  });

  if (meta.intent_coverage === "none" || byIntent.length === 0) {
    view.append(el(`<div class="card"><h2>Friction by intent</h2><p class="note">Needs intent labels; not available in this build.</p></div>`));
    return;
  }
  const heatSignals = ["repeat_rate", "correction_rate", "one_and_done_rate"];
  // Across all models the grid would run to ~70 rows; keep the three busiest models per intent. Picking a model shows all of its intents.
  const TOP_PER_INTENT = 3;
  if (!FILTER.model) {
    const groups = new Map();
    for (const r of byIntent) groups.set(r.intent, [...(groups.get(r.intent) || []), r]);
    const keep = new Set([...groups.values()].flatMap((rows) => rows.sort((a, b) => b.conversations - a.conversations).slice(0, TOP_PER_INTENT)));
    byIntent = byIntent.filter((r) => keep.has(r));
  }
  const heat = byIntent.flatMap((r) => heatSignals.map((s) => ({ intent: r.intent, model: r.model, signal: labels[s], rate: r[s], conversations: r.conversations })));
  const rowKey = (d) => (FILTER.model ? d.intent : `${d.intent} · ${d.model}`);
  const rowOrder = [...byIntent].sort((a, b) => a.intent.localeCompare(b.intent) || b.conversations - a.conversations).map(rowKey);
  chart(view, {
    title: FILTER.model ? `Friction and depth by intent, ${FILTER.model}` : "Friction and depth by intent and model",
    so: FILTER.model ? "Darker means more. Click one signal to rank the kinds of request by it." : "Darker means more. Click one signal to rank every kind of request on every model by it.",
    note: `Repeated-request and correction rates (validated friction) and the share ending after one turn (depth, not failure) for intent × model pairs with at least ${meta.min_cell} conversations${FILTER.model ? "" : `, the ${TOP_PER_INTENT} busiest models for each intent`}. Rows are grouped by intent and ordered by volume. Differences between models here mix model quality with who chose each model; Next steps checks them on the same people.`,
    series: heatSignals.map((s) => ({ key: labels[s], color: color[labels[s]] })),
    draw: ({ isOn, w, active }) => {
      const rows = heat.filter((r) => isOn(r.signal));
      const single = active && active.size === 1;
      const order = single ? [...rows].sort((a, b) => b.rate - a.rate).map(rowKey) : rowOrder;
      return single
        ? Plot.plot({
            width: w, height: 40 + 22 * order.length, marginLeft: 210,
            x: { label: `${[...active][0]} rate`, grid: true, percent: true }, y: { label: null, domain: order },
            marks: [Plot.barX(rows, { y: rowKey, x: "rate", fill: color[[...active][0]], tip: { format: { y: false } }, rx: 3, channels: { conversations: "conversations", [FILTER.model ? "intent" : "intent · model"]: rowKey } })],
          })
        : Plot.plot({
            width: w, height: 60 + 24 * order.length, marginLeft: 210, padding: 0,
            color: { legend: true, label: "rate", range: [css("--seq-1"), css("--seq-5")], percent: true },
            x: { label: null, axis: "top" }, y: { label: null, domain: order },
            marks: [Plot.cell(rows, { x: "signal", y: rowKey, fill: "rate", tip: { format: { y: false, x: false } }, inset: 0.5, rx: 3, channels: { conversations: "conversations", signal: "signal", [FILTER.model ? "intent" : "intent · model"]: rowKey } })],
          });
    },
  });
  // Attribution: friction charged to the responder whose reply the user reacted to, turn by turn.
  if (!FILTER.model) {
    const resp = await q(conn, `SELECT responder, assistant_turns, corrections, repeats, correction_rate, repeat_rate FROM friction_by_responder ORDER BY assistant_turns DESC`).catch(() => []);
    if (resp.length) {
      const per1k = resp.flatMap((r) => [{ responder: r.responder, signal: "repeated request", per1k: 1000 * r.repeat_rate, n: r.assistant_turns }, { responder: r.responder, signal: "correction follow-up", per1k: 1000 * r.correction_rate, n: r.assistant_turns }]);
      const order = resp.map((r) => r.responder);
      const worst = [...resp].sort((a, b) => (b.repeat_rate + b.correction_rate) - (a.repeat_rate + a.correction_rate))[0];
      chart(view, {
        title: "Which model or sub-agent the friction lands on, per 1,000 replies",
        so: `${esc(worst.responder)} draws the most friction per reply: ${(1000 * worst.repeat_rate).toFixed(1)} repeats and ${(1000 * worst.correction_rate).toFixed(1)} corrections per 1,000 of its replies. In these logs one model answers a whole conversation, so this equals the by-model view; the point is the unit.`,
        note: "Loupe charges a repeated request or a correction to the responder that produced the reply the user reacted to, turn by turn (loupe/attribution.py), not to the conversation as a whole. The first user turn reacts to nothing and is charged to no one. For an assistant built from several sub-assistants, the team logs one field per assistant message, `responder`, and this chart splits by sub-assistant with no further code. When that field is absent, every reply is charged to the conversation's model and Loupe says so rather than guess which sub-assistant was at fault.",
        series: [{ key: "repeated request", color: colors[0] }, { key: "correction follow-up", color: colors[1] }],
        draw: ({ isOn, hover, w }) => Plot.plot({
          width: w, height: 40 + 30 * order.length, marginLeft: 110,
          color: { domain: ["repeated request", "correction follow-up"], range: [colors[0], colors[1]] },
          x: { label: "per 1,000 replies", grid: true }, y: { label: null, domain: order },
          marks: [Plot.barX(per1k.filter((d) => isOn(d.signal)), { y: "responder", x: "per1k", fill: "signal", fillOpacity: (d) => dim(hover, d.signal), tip: { format: { y: false } }, channels: { responder: "responder", replies: "n" }, rx: 3, inset: 1 }), Plot.ruleX([0])],
        }),
      });
    }
  }

  view.append(el(`<div class="card nudge"><p>Ranked by how many people each one hits, with a backlog to download: <a href="#next">the fix list in Next steps&nbsp;→</a></p></div>`));
}
registerRenderer("friction", renderFriction);

// ---------- Next steps: what the logs say to do ----------

const ERA_LABEL = { A: "Era A · gpt-3.5-turbo and gpt-4 side by side", B: "Era B · gpt-4o, gpt-4o-mini, o1 and o1-mini side by side" };

function policyTable(era) {
  const pol = era.policies;
  const row = (name, label) => {
    const p = pol[name]; const base = name === "baseline_actual_mix";
    return `<tr><td>${label}</td><td>${fmtPct(p.one_and_done_rate)}</td><td>${base ? "" : fmtPts(p.one_and_done_change_pts)}</td><td>${fmtPct(p.repeat_rate, 2)}</td><td>${fmtPct(p.correction_rate, 2)}</td><td>$${p.cost_per_1k.toFixed(2)}</td><td>${base ? "" : (p.cost_change_pct >= 0 ? "+" : "") + Math.round(100 * p.cost_change_pct) + "%"}</td><td class="routes">${p.routes ? Object.entries(p.routes).map(([i, m]) => `${esc(i)}→${esc(m)}`).join(", ") : "as users chose"}</td></tr>`;
  };
  return `<div class="tablewrap"><table class="grid"><thead><tr><th>policy</th><th>ended in one turn</th><th>change</th><th>repeated</th><th>corrected</th><th>cost / 1k</th><th>cost change</th><th>routes</th></tr></thead><tbody>
    ${row("baseline_actual_mix", "Baseline, actual mix")}${row("best_friction", "Best friction")}${row("cost_aware", "Cost-aware")}${row("cheapest_only", "Cheapest only")}</tbody></table></div>`;
}

// A same-people comparison reads as one of three things; the interval decides which.
function mixVerdict(p) {  // p: one measure of one pair (naive_gap, matched_gap, matched_ci)
  const [lo, hi] = p.matched_ci;
  if (lo <= 0 && hi >= 0) return Math.abs(p.naive_gap) >= 0.01
    ? { cls: "mix", text: "No detectable gap for the same people: the dashboard gap was who used each model" }
    : { cls: "mix", text: "Small on the dashboard, none detectable for the same people" };
  if (Math.sign(p.matched_gap) !== Math.sign(p.naive_gap)) return { cls: "flip", text: `Reversed: small and the other way for the same people (${fmtPts(p.matched_gap)}, not ${fmtPts(p.naive_gap)})` };
  return { cls: "real", text: `Real, but ${fmtPts(p.matched_gap)}, not ${fmtPts(p.naive_gap)}` };
}
// "3.0% vs 0.9% → 11.6% vs 11.6%", the dashboard view then the same people
const mixCell = (m) => `${fmtPct(m.naive_a)} vs ${fmtPct(m.naive_b)} → <b>${fmtPct(m.matched_a)} vs ${fmtPct(m.matched_b)}</b><small>same people: ${fmtPts(m.matched_gap)} (${(100 * m.matched_ci[0]).toFixed(1)} to ${(100 * m.matched_ci[1]).toFixed(1)})</small>`;

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export async function renderNext(conn, meta) {
  const view = $("#view-next");
  view.innerHTML = "";
  const doc = (n) => new URL(`docs/${n}`, import.meta.url).href;
  const [rc, mix, reveal] = await Promise.all([
    fetch(new URL("aggregates/routing_counterfactual.json", import.meta.url)).then((r) => r.json()).catch(() => null),
    fetch(new URL("aggregates/eval_mix.json", import.meta.url)).then((r) => r.json()).catch(() => null),
    fetch(new URL("aggregates/user_mix_reveal.json", import.meta.url)).then((r) => r.json()).catch(() => null),
  ]);
  // The fix list ranks intents, not models: per-model gaps in usage logs are mostly user mix (card 02).
  const fixes = meta.intent_coverage === "none" ? [] : (await q(conn, `SELECT intent, sum(conversations)::BIGINT AS n,
      sum(conversations*repeat_rate) AS repeats, sum(conversations*correction_rate) AS corrections
    FROM friction_by_intent_model WHERE true${modelWhere()} GROUP BY intent`).catch(() => []))
    .filter((r) => r.intent !== "other")
    .map((r) => ({ ...r, flagged: r.repeats + r.corrections, rate: (r.repeats + r.corrections) / r.n }))
    .sort((a, b) => b.flagged - a.flagged);
  const totalFlagged = sum(fixes, (r) => r.flagged);
  const pairs = reveal?.pairs || [];
  const mini = pairs.filter((p) => p.model_a === "gpt-4o-mini");

  insight(view, FILTER.model ? `What should the team do next on ${esc(FILTER.model)}?` : "What should the team do next?", [
    fixes.length ? `<b>Fix ${esc(fixes[0].intent)} first.</b> It accounts for ${fmtPct0(fixes[0].flagged / totalFlagged)} of the conversations where people had to repeat or correct themselves${fixes[1] ? `, ahead of ${esc(fixes[1].intent)} at ${fmtPct0(fixes[1].flagged / totalFlagged)}` : ""}. The fix list below downloads as a backlog.` : "",
    mini.length && mini[0].friction ? `<b>Don't switch models on a dashboard gap.</b> On coding, people repeat themselves or correct gpt-4o-mini ${(mini[0].friction.naive_a / mini[0].friction.naive_b).toFixed(1)}× as often as gpt-4o; for the same ${fmtInt.format(mini[0].matched_users)} people on both models the rates match (${fmtPct(mini[0].friction.matched_a)} vs ${fmtPct(mini[0].friction.matched_b)}).` : "",
    mix ? `<b>Weight your tests by real usage.</b> People bring ${esc(Object.keys(mix.weights)[0])} ${fmtPct0(Object.values(mix.weights)[0])} of the time and ${esc(Object.keys(mix.weights)[1])} ${fmtPct0(Object.values(mix.weights)[1])}; score your assistant on that mix, not the one your test set happens to have.` : "",
  ].filter(Boolean), { href: "../try/", text: "Run the same checks on your own logs, plus the change check and failure export" });

  // ---- 01 Fix list ----
  if (fixes.length) {
    const fix = el(`<div class="card next"><p class="eyebrow">01 · fix list</p><h2>Where people fail, ranked by how many it hits</h2>
      <p class="so">Conversations where people had to repeat themselves or correct the reply, ranked by how many.</p>
      <div class="tablewrap"><table class="grid fix"><thead><tr><th>#</th><th>intent</th><th>conversations</th><th>repeated</th><th>corrected</th><th>flagged rate</th><th>share of all flagged</th></tr></thead><tbody>
      ${fixes.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.intent)}</b></td><td>${fmtInt.format(r.n)}</td><td>${fmtInt.format(Math.round(r.repeats))}</td><td>${fmtInt.format(Math.round(r.corrections))}</td><td>${fmtPct(r.rate)}</td><td><span class="sharebar"><i style="width:${(100 * r.flagged / fixes[0].flagged).toFixed(1)}%"></i></span>${fmtPct0(r.flagged / totalFlagged)}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="next-actions"><button type="button" class="chip" id="fix-csv">Download backlog.csv</button><a class="chip" href="../try/">Turn your own failures into test&nbsp;cases&nbsp;→</a></div>
      <details class="def"><summary>How this is counted</summary><p>Repeats and corrections are the two signals that held up in validation (78% and 96% precision). Grouped by intent, not by model: in these logs most of the difference between models is who chose them (card 02). Counts are estimated from per-cell rates; a conversation with both a repeat and a correction counts once in each column. "Other" (greetings and probe traffic) is left out.</p></details></div>`);
    view.append(fix);
    fix.querySelector("#fix-csv").addEventListener("click", () => {
      const lines = [["rank", "intent", "conversations", "repeated_requests", "corrections", "flagged_rate", "share_of_flagged", "title"].join(",")]
        .concat(fixes.map((r, i) => [i + 1, r.intent, r.n, Math.round(r.repeats), Math.round(r.corrections), r.rate.toFixed(4), (r.flagged / totalFlagged).toFixed(4),
          `Reduce repeats and corrections in ${r.intent} (${fmtPct(r.rate)} of conversations)`].map(csvCell).join(",")));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
      a.download = "loupe-wildchat-backlog.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      window.loupeTrack?.("next_backlog_downloaded", {});
    });
  }

  // ---- 02 Model or the people ----
  if (pairs.length && !FILTER.model) {
    view.append(el(`<div class="card next"><p class="eyebrow">02 · before you switch models</p><h2>The model, or the people who chose it?</h2>
      <p class="so">Each gap a dashboard shows, rechecked on the people who used both models.</p>
      <div class="tablewrap"><table class="grid mixcheck"><thead><tr><th>comparison</th><th>people</th><th>repeated or corrected (validated)</th><th>ended after one short reply</th><th>verdict</th></tr></thead><tbody>
      ${pairs.map((p) => {
        const f = p.friction, ok = f && f.measurable;
        const v = mixVerdict(ok ? f : p);
        const single = f && !f.measurable ? (f.multi_turn_a < f.multi_turn_b ? p.model_a : p.model_b) : null;
        return `<tr><td>${esc(p.intent)}<small>${esc(p.model_a)} vs ${esc(p.model_b)}</small></td><td>${fmtInt.format(p.matched_users)}</td>
          <td>${ok ? mixCell(f) : `<span class="muted-cell">not measurable: ${esc(single)} conversations are almost always one turn, so nobody can repeat themselves</span>`}</td>
          <td>${mixCell(p)}</td><td><span class="vd ${v.cls}">${v.text}</span>${ok ? "" : "<small>on the one-turn measure</small>"}</td></tr>`; }).join("")}
      </tbody></table></div>
      <details class="def"><summary>How this is checked, and what it cannot rule out</summary><p>${esc(reveal.window.start)} to ${esc(reveal.window.end)}. Each cell reads: the rates across everyone on each model, as a dashboard compares them, then the rates for the same people, with the same-people gap and its 95% interval. The verdict uses the validated signal where it can be measured: the ${esc(reveal.friction_metric)}. ${esc(reveal.method)}</p>${(reveal.caveats || []).map((c) => `<p>${esc(c)}</p>`).join("")}<p><a href="${doc("10-routing-counterfactual.html")}">Method and the correction&nbsp;→</a></p></details></div>`));
  }

  // ---- 03 Usage-weighted eval: live scorer ----
  if (mix) {
    const intents = Object.keys(mix.weights);
    // Starter scores: an assistant good at the rare things and weak at the common ones, so the gap between the two means is visible.
    const defaults = { questions: 0.55, coding: 0.60, writing_and_business: 0.80, creative_roleplay: 0.95, translation: 0.90, image_prompting: "", other: "" };
    const evalCard = el(`<div class="card next"><p class="eyebrow">03 · score your eval on real usage</p><h2>Judge an assistant by what people actually bring it</h2>
      <p class="so">Enter your test scores for each kind of request; the total is reweighted by how often people actually ask for each.</p>
      <div class="controls"><label>Weights from <select id="mix-src"><option value="all">all conversations</option><option value="noother">all, excluding "other"</option>${Object.keys(mix.by_era).map((k) => `<option value="era:${k}">era ${k} (${mix.by_era[k].start} to ${mix.by_era[k].end})</option>`).join("")}${Object.keys(mix.by_model).map((m) => `<option value="model:${esc(m)}">${esc(m)} only</option>`).join("")}</select></label></div>
      <div class="tablewrap"><table class="grid eval"><thead><tr><th>intent</th><th>weight</th><th>your score</th><th>weighted</th></tr></thead><tbody>
        ${intents.map((i) => `<tr data-intent="${esc(i)}"><td>${esc(i)}</td><td class="w"></td><td><input type="number" step="0.01" min="0" placeholder="not tested" value="${defaults[i] ?? ""}" aria-label="score for ${esc(i)}"></td><td class="wx"></td></tr>`).join("")}
      </tbody></table></div>
      <div class="eval-out"><div class="tile"><b id="ev-weighted">–</b><span>usage-weighted score</span></div><div class="tile"><b id="ev-plain">–</b><span>unweighted mean</span></div><div class="tile"><b id="ev-cover">–</b><span>share of real usage your set covers</span><small id="ev-missing"></small></div></div>
      <details class="def"><summary>How to use this on your own eval set</summary><p>Weights come from ${fmtInt.format(mix.labeled_conversations)} classified conversations; the classifier is ${fmtPct(mix.classifier_accuracy)} accurate against a ${fmtPct(mix.classifier_rater_agreement)} rater ceiling. Scores can be on any scale; leave an intent blank if your set does not test it. Label each prompt with one of the seven intents, score it however you already do, and run <code>scripts/eval_weighted_score.py results.csv</code> with intent and score columns, or type per-intent means here. The scorer never hides what the set does not cover: intents with weight but no score are listed and excluded, and the weighted score is renormalised over the covered weight. <a href="${doc("11-usage-weighted-eval.html")}">Read the method&nbsp;→</a></p></details></div>`);
    view.append(evalCard);
    const weightsFor = (src) => src === "all" ? mix.weights : src === "noother" ? mix.weights_excluding_other : src.startsWith("era:") ? mix.by_era[src.slice(4)].weights : mix.by_model[src.slice(6)];
    const recompute = () => {
      const w = weightsFor(evalCard.querySelector("#mix-src").value);
      let cover = 0, acc = 0, n = 0, plain = 0; const missing = [];
      evalCard.querySelectorAll("tbody tr").forEach((tr) => {
        const i = tr.dataset.intent, wt = w[i] ?? 0, v = tr.querySelector("input").value;
        tr.querySelector(".w").textContent = wt ? fmtPct(wt) : "–";
        tr.classList.toggle("muted", !wt);
        if (v !== "" && wt) { const x = Number(v); cover += wt; acc += wt * x; plain += x; n++; tr.querySelector(".wx").textContent = (wt * x).toFixed(3); }
        else { tr.querySelector(".wx").textContent = "–"; if (wt && v === "") missing.push(i); }
      });
      $("#ev-weighted").textContent = cover ? (acc / cover).toFixed(2) : "–";
      $("#ev-plain").textContent = n ? (plain / n).toFixed(2) : "–";
      $("#ev-cover").textContent = fmtPct0(cover);
      $("#ev-missing").textContent = missing.length ? `not tested: ${missing.join(", ")}` : "every intent with weight is covered";
    };
    evalCard.addEventListener("input", () => { window.loupeTrack?.("eval_scorer_used", {}); recompute(); });
    evalCard.addEventListener("change", recompute);
    recompute();
  }

  // ---- 04 The recommendation that was withdrawn, kept short and kept visible ----
  if (rc && !FILTER.model) {
    const B = rc.eras.B;
    const routing = el(`<div class="card next withdrawn"><p class="eyebrow">04 · withdrawn 2026-10-07</p><h2>What this page used to recommend: route requests by intent</h2>
      <p class="so">It said sending each kind of request to a different model would cut conversations that end after one short reply from ${fmtPct(B.policies.baseline_actual_mix.one_and_done_rate)} to ${fmtPct(B.policies.cost_aware.one_and_done_rate)}. Card 02 shows the model differences it relied on came from who chose each model.</p>
      <details class="def"><summary>The original sizing, both eras</summary>
        <div class="era-tabs" role="tablist"><button type="button" class="chip" data-era="B" aria-pressed="true">${ERA_LABEL.B}</button><button type="button" class="chip" data-era="A" aria-pressed="false">${ERA_LABEL.A}</button></div>
        <p class="so era-so"></p><div class="era-table"></div></details>
      <p class="note"><a href="${doc("10-routing-counterfactual.html")}">Read the correction and the experiment design&nbsp;→</a></p></div>`);
    view.append(routing);
    const showEra = (k) => {
      const e = rc.eras[k], p = e.policies;
      routing.querySelector(".era-so").innerHTML = k === "B"
        ? `${e.start} to ${e.end}, ${fmtInt.format(p.baseline_actual_mix.conversations)} conversations that could have been sent to another model, compared across everyone on each model (the comparison card 02 shows to be misleading).`
        : `${e.start} to ${e.end}, ${fmtInt.format(p.baseline_actual_mix.conversations)} conversations that could have been sent to another model. A null result even before the correction: the best policy gains only ${fmtPts(-p.best_friction.one_and_done_change_pts).replace("+", "")} for +${Math.round(100 * p.best_friction.cost_change_pct)}% cost.`;
      routing.querySelector(".era-table").innerHTML = policyTable(e);
      routing.querySelectorAll(".era-tabs .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.era === k)));
    };
    routing.querySelector(".era-tabs").addEventListener("click", (ev) => { const b = ev.target.closest("[data-era]"); if (b) showEra(b.dataset.era); });
    showEra("B");
  }
}
registerRenderer("next", renderNext);

// ---------- Query ----------

export async function renderQuery(conn) {
  const view = $("#view-query");
  const cols = await q(conn, `SELECT table_name, string_agg(column_name || ' ' || data_type, ', ' ORDER BY ordinal_position) AS columns FROM information_schema.columns WHERE table_schema = 'main' GROUP BY table_name ORDER BY table_name`);
  view.innerHTML = `<div class="card"><h2>Run your own SQL over the aggregates</h2>
    <p class="note">Everything runs in your browser with DuckDB-WASM. Only pre-computed aggregates are available; no transcript content exists here.</p>
    <textarea id="sql">-- return_rate is NULL when the following week is absent from the data (see next_week_present)
SELECT week, pseudo_users, round(return_rate, 3) AS return_rate, next_week_present
FROM intensity_weekly ORDER BY week DESC LIMIT 12</textarea>
    <div class="controls"><button class="run" id="run">Run</button><span id="qerr" class="status"></span></div>
    <div id="qout"></div></div>
    <div class="card"><h2>Available views</h2>${tableEl(cols, 50).outerHTML}</div>`;
  const run = async () => {
    $("#qerr").textContent = "";
    window.loupeTrack?.("query_run", { chars: $("#sql").value.length });
    try {
      const rows = await q(conn, $("#sql").value);
      $("#qout").replaceChildren(tableEl(rows));
      $("#qerr").textContent = `${rows.length} rows${rows.length > 200 ? " (showing 200)" : ""}`;
    } catch (e) { $("#qerr").textContent = e.message; }
  };
  $("#run").addEventListener("click", run);
  $("#sql").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run(); });
  await run();
}
registerRenderer("query", renderQuery);

// ---------- Shell ----------

function showView(name) {
  document.querySelectorAll("main section").forEach((s) => (s.hidden = s.id !== `view-${name}`));
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const hash = FILTER.model ? `${name}/${encodeURIComponent(FILTER.model)}` : name;
  // First paint with no hash: write it without adding a history step, so Back leaves the dashboard
  // instead of returning to the same page with its hash stripped (which would only re-add it).
  if (!location.hash) history.replaceState(null, "", `#${hash}`);
  else location.hash = hash;
}

function parseHash() {
  const [view, model] = (location.hash || "#overview").slice(1).split("/");
  return { view: view === "built" ? "next" : view || "overview", model: model ? decodeURIComponent(model) : null };
}

// The model picker under the tabs. Changing it re-renders every view for that model only.
function buildPicker(models, counts, onChange) {
  const picker = $("#model-picker");
  picker.innerHTML = "";
  const all = el(`<button type="button" data-model="" aria-pressed="${!FILTER.model}">All models</button>`);
  picker.append(all);
  for (const m of models) picker.append(el(`<button type="button" data-model="${esc(m)}" aria-pressed="${FILTER.model === m}">${esc(m)}</button>`));
  const banner = $("#scope-banner");
  const paint = () => {
    picker.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.model || null) === FILTER.model)));
    banner.hidden = !FILTER.model;
    const win = FILTER.model ? DATA.windows.get(FILTER.model) : null;
    const fmtDay = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...utc });
    banner.innerHTML = FILTER.model
      ? `Showing <b>${esc(FILTER.model)}</b> only · ${fmtInt.format(counts.get(FILTER.model) || 0)} conversations · in the logs ${fmtDay(win.w0)} to ${fmtDay(new Date(+win.w1 + WEEK_MS - 86400000))} (${fmtInt.format(win.weeks)} weeks with traffic) · return is same-model retention · <button type="button" class="linklike" id="scope-reset">Show all models</button>`
      : "";
    banner.querySelector("#scope-reset")?.addEventListener("click", () => { FILTER.model = null; paint(); onChange(); });
  };
  picker.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-model]");
    if (!b) return;
    FILTER.model = b.dataset.model || null;
    window.loupeTrack?.("model_filter", { model: FILTER.model || "all" });
    paint();
    onChange();
  });
  paint();
  return paint;
}

async function main() {
  const t0 = performance.now();
  try {
    const { conn, meta } = await boot();
    $("#status").hidden = true;
    window.loupeTrack?.("dashboard_loaded", { ms: Math.round(performance.now() - t0) });
    $("#caveat-population").textContent = meta.population_caveat;
    $("#caveat-users").textContent = `"People" on this dashboard are estimates. ${meta.pseudo_user_caveat}`;
    $("#generated").textContent = `Aggregates generated ${meta.generated_at} from ${fmtInt.format(meta.conversations)} conversations (${meta.date_min} to ${meta.date_max}).`;
    if (meta.intent_coverage !== "full") {
      const b = $("#coverage-banner");
      b.hidden = false;
      b.textContent = `Intent coverage is "${meta.intent_coverage}". Intent and friction-by-intent views are incomplete or absent.`;
    }
    const modelRows = await q(conn, `SELECT model, sum(conversations)::BIGINT AS n, min(date_trunc('week', date))::DATE AS w0, max(date_trunc('week', date))::DATE AS w1, count(DISTINCT date_trunc('week', date))::BIGINT AS weeks FROM volume_daily_model GROUP BY model ORDER BY n DESC`);
    FILTER.models = modelRows.map((r) => r.model);
    const counts = new Map(modelRows.map((r) => [r.model, r.n]));
    DATA.from = new Date(meta.complete_weeks_from + "T00:00:00Z");
    DATA.through = completeThrough(meta);
    for (const r of modelRows) DATA.windows.set(r.model, { w0: r.w0, w1: r.w1, weeks: r.weeks, n: r.n });
    const mw = await q(conn, `SELECT model, date_trunc('week', date)::DATE AS week FROM volume_daily_model GROUP BY ALL`);
    for (const r of mw) { if (!DATA.modelWeeks.has(r.model)) DATA.modelWeeks.set(r.model, new Set()); DATA.modelWeeks.get(r.model).add(+r.week); }
    const allWeeks = new Set((await q(conn, `SELECT week FROM intensity_weekly`)).map((r) => +r.week));
    DATA.outages = weeksBetween(DATA.from, DATA.through).filter((w) => !allWeeks.has(+w));
    const start = parseHash();
    FILTER.model = FILTER.models.includes(start.model) ? start.model : null;
    let rendered = new Set();
    let current = start.view;
    const go = async (name) => {
      current = name;
      showView(name);
      window.loupeTrack?.("view_opened", { view: name, model: FILTER.model || "all" });
      if (!rendered.has(name) && RENDERERS[name]) { rendered.add(name); await RENDERERS[name](conn, meta); }
    };
    const paint = buildPicker(FILTER.models, counts, () => { rendered = new Set(); go(current); });
    document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
    // Back/forward and hand-edited URLs: the hash is the source of truth for view and model.
    window.addEventListener("hashchange", () => {
      const h = parseHash();
      const model = FILTER.models.includes(h.model) ? h.model : null;
      const view = RENDERERS[h.view] ? h.view : "overview";
      if (model === FILTER.model && view === current) return; // our own showView() wrote this hash
      if (model !== FILTER.model) { FILTER.model = model; paint(); rendered = new Set(); }
      go(view);
    });
    await go(RENDERERS[start.view] ? start.view : "overview");
  } catch (err) {
    $("#status").textContent = `Failed to load: ${err.message}`;
    window.loupeTrack?.("dashboard_failed", { message: String(err.message).slice(0, 120), ms: Math.round(performance.now() - t0) });
    console.error(err);
  }
}

main();
