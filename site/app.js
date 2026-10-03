import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm";
import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.17/+esm";

export const AGGREGATES = [
  "volume_daily_model", "volume_weekly_country", "volume_weekly_language",
  "intensity_weekly", "pseudo_user_persistence_quarterly", "depth_by_model",
  "intent_weekly", "intent_by_model", "intent_by_language",
  "friction_by_intent_model", "friction_weekly", "data_quality_weekly",
  "intensity_weekly_model", "intent_weekly_model", "friction_weekly_model", "data_quality_weekly_model",
];

const $ = (sel) => document.querySelector(sel);
const fmtInt = new Intl.NumberFormat("en-US");
const fmtPct = (x) => (x == null ? "–" : (100 * x).toFixed(1) + "%");
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

// The WildChat collection changed how pseudo-user keys persist around this date; return rates
// before and after are not comparable (trends report, F1).
export const COLLECTION_BREAK = new Date("2024-10-01T00:00:00Z");
const finding = (n) => `docs/07-trends-report.html#f${n}`;

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

  const meta = await (await fetch("aggregates/meta.json")).json();
  const conn = await db.connect();
  for (const name of AGGREGATES) {
    const buf = await (await fetch(`aggregates/${name}.parquet`)).arrayBuffer();
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
function insight(view, question, items, link) {
  const card = el(`<div class="card insight"><p class="eyebrow">The question</p><h2>${question}</h2>
    <ul class="facts">${items.map((i) => `<li>${i}</li>`).join("")}</ul>
    ${link ? `<a class="more" href="${link.href}">${link.text} →</a>` : ""}</div>`);
  view.append(card);
  return card;
}

// A chart card with its own clickable legend. `series` fixes the colour of every key; `draw`
// re-renders the figure whenever the viewer isolates, compares, or hovers a series.
function chart(view, { title, so, note, series, draw, scope, caption }) {
  const tag = scope === "all" && FILTER.model ? `<span class="scope" title="This chart has no per-model cut">All models</span>` : "";
  const card = el(`<div class="card chart"><div class="card-head"><h2>${title}${tag}</h2>${so ? `<p class="so">${so}</p>` : ""}</div>
    <div class="legend" role="group" aria-label="Series"></div><figure></figure>
    ${caption ? `<p class="keys">${caption}</p>` : ""}
    ${note ? `<details class="def"><summary>What this measures</summary><p>${note}</p></details>` : ""}</div>`);
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
    ${tile("peak weekly pseudo-users", fmtInt.format(users.peak_users ?? 0))}
    ${tile(FILTER.model ? "week-over-week return (same model)" : "week-over-week return", fmtPct(lastRet?.return_rate), lastRet ? fmtWeek(lastRet.week) : "no measurable week")}
    ${tile("intent coverage", meta.intent_coverage)}
  </div>`;

  const win = FILTER.model ? DATA.windows.get(FILTER.model) : null;
  const retired = win && win.w1 < DATA.through ? `<b>${esc(FILTER.model)}</b> left the logs after the ${fmtWeek(win.w1)}. ` : "";
  insight(view, FILTER.model ? `Is ${esc(FILTER.model)} usage growing, or is it the same power users?` : "Is usage growing, or is it the same power users?", [
    `${retired}<b>${fmtInt.format(sum(recent, (r) => r.conversations))}</b> conversations in the last 12 complete weeks, ${prior.length ? describeChange(change) + " versus the 12 weeks before" : "with no earlier 12-week window to compare against"}.`,
    last.week ? `In the ${fmtWeek(last.week)}, the top 10% of ${FILTER.model ? "its " : ""}pseudo-users produced <b>${fmtPct(last.top10_share)}</b> of conversations; the median pseudo-user had ${(last.convs_per_user_p50 ?? 0).toFixed(1)} conversation${last.convs_per_user_p50 === 1 ? "" : "s"}.` : `No complete week has enough ${esc(FILTER.model)} pseudo-users to report intensity.`,
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
  const retNote = FILTER.model ? " Return here is model retention: a pseudo-user counts as returned only if they used this model again the following week." : "";

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
    ${tile("pseudo-users", fmtInt.format(last.pseudo_users ?? 0), fmtWeek(last.week))}
    ${tile(FILTER.model ? "week-over-week return (same model)" : "week-over-week return", fmtPct(lastRet?.return_rate), lastRet ? fmtWeek(lastRet.week) : "no measurable week")}
    ${tile("top-10% share of conversations", fmtPct(last.top10_share), fmtWeek(last.week))}
    ${tile("conversations / pseudo-user (p50)", (last.convs_per_user_p50 ?? 0).toFixed(1), fmtWeek(last.week))}
  </div>`;

  const retLine = preMedian != null
    ? `In the comparable era, April 2023 to September 2024, week-over-week return${FILTER.model ? ` to ${esc(FILTER.model)}` : ""} held at a median of <b>${fmtPct(preMedian)}</b>${postMedian != null ? `; since the collection break it reads ${fmtPct(postMedian)}` : ""}.`
    : postMedian != null
      ? `${esc(FILTER.model)} only has weeks after the collection break, where pseudo-user keys do not persist, so its return rate (median <b>${fmtPct(postMedian)}</b>) understates real return and cannot be compared with earlier models.`
      : `No week has enough ${esc(FILTER.model)} pseudo-users to measure return.`;
  const depthLine = FILTER.model
    ? `<b>${fmtPct0(singleShare)}</b> of ${esc(FILTER.model)} conversations end after one turn; ${fmtPct0(multiByModel[0]?.[1] ?? 0)} run three or more turns.`
    : `<b>${fmtPct0(singleShare)}</b> of all conversations end after one turn. ${esc(multiByModel[0]?.[0] ?? "–")} carries the most multi-turn work (${fmtPct0(multiByModel[0]?.[1])} run three or more turns); ${esc(singleByModel[0]?.[0] ?? "–")} the least (${fmtPct0(singleByModel[0]?.[1])} single-turn).`;
  insight(view, FILTER.model ? `Are ${esc(FILTER.model)} users coming back?` : "Are people coming back?", [
    retLine,
    `From ${fmtMonth(COLLECTION_BREAK)} pseudo-user keys stop persisting in the collection, so return reads near zero afterwards. Treat that as a collection change, not churn.${retNote}`,
    depthLine,
  ], { href: finding(1), text: "Read findings F1, F2 and F4 in the trends report" });

  chart(view, {
    title: "Week-over-week return rate",
    so: lastRet ? `${fmtPct(lastRet.return_rate)} in the ${fmtWeek(lastRet.week)}${preMedian != null ? `, against a pre-break median of ${fmtPct(preMedian)}` : ""}.` : "No week has a measurable return rate.",
    note: `Share of pseudo-users active in a week who are active again the following week. Weeks whose following week is not in the data are drawn as gaps, not zeros.${retNote}`,
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
    title: "Weekly pseudo-users and concentration",
    so: `${fmtInt.format(last.pseudo_users ?? 0)} pseudo-users in the ${fmtWeek(last.week)}; the top 10% of them produced ${fmtPct(last.top10_share)} of that week's conversations.`,
    note: "Top panel: pseudo-users active each week. Bottom panel: share of the week's conversations that came from its 10% most active pseudo-users. A rising share with a falling user count means the remaining usage is concentrated in fewer hands.",
    series: [{ key: "pseudo-users", color: c1 }, { key: "top-10% share", color: c7 }],
    caption: CAPTION_RATES,
    draw: ({ isOn, hover, w }) => {
      const box = document.createElement("div");
      box.className = "panels";
      const both = isOn("pseudo-users") && isOn("top-10% share");
      const users = fillZeros(weekly, { value: "pseudo_users" });
      const share = bridged(weekly, { value: "top10_share" });
      if (isOn("pseudo-users")) box.append(Plot.plot({
        width: w, height: both ? 200 : 260, marginLeft: 60, marginBottom: both ? 10 : 30,
        x: { label: null, axis: both ? null : "bottom" }, y: { label: "pseudo-users / week", grid: true, insetBottom: 8 },
        marks: [...timeMarks(),
          Plot.areaY(users, { x: "week", y: "pseudo_users", fill: c1, fillOpacity: 0.12 * dim(hover, "pseudo-users") }),
          Plot.lineY(users, { x: "week", y: "pseudo_users", stroke: c1, strokeWidth: 1.75, strokeOpacity: dim(hover, "pseudo-users"), tip: TIP })],
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
    title: "Conversations per pseudo-user per week",
    so: `A typical pseudo-user has ${(last.convs_per_user_p50 ?? 0).toFixed(1)} conversations a week; the heaviest tenth have ${(last.convs_per_user_p90 ?? 0).toFixed(1)} or more.`,
    note: "Median (solid) and 90th percentile (dashed) conversations per active pseudo-user per week.",
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
    title: "How long pseudo-users persist",
    so: `Before 2024 Q4, about ${fmtPct0(median(pre.map((r) => r.share_multi_week)))} of a quarter's pseudo-users were active in more than one week; since then, about ${fmtPct(median(post.map((r) => r.share_multi_week)))}.`,
    note: "Share of a quarter's pseudo-users active in more than one week. The drop after 2024 Q3 is a property of the collection (pseudo-user keys stopped persisting), not of user behavior; return rates are not comparable across that boundary.",
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
    `Intent labels cover <b>${fmtPct(meta.intent_share)}</b> of ${FILTER.model ? "all " : ""}conversations. The classifier is ${fmtPct(meta.classifier_accuracy)} accurate against a ${fmtPct(meta.classifier_rater_agreement)} ceiling set by two labeling models disagreeing with each other.`,
    `<b>${fmtPct(notRecordedC)}</b> of ${FILTER.model ? "all " : ""}conversations have no country recorded and another ${fmtPct(smallC)} sit in cells under the ${meta.min_cell}-conversation floor, so geography is directional. Language is nearly complete, but one top-10 label is probably a detector artifact.`,
    `Token counts exist only from ${meta.token_coverage_first_week} and cover ${fmtPct(lastDq.token_usage_coverage)} of ${scopeLabel() === "all models" ? "" : esc(FILTER.model) + " "}conversations in the latest complete week, so token metrics are not reported.`,
  ], { href: finding(6), text: "Read findings F6 and F7 in the trends report" });

  const pii = dq.flatMap((r) => [{ week: r.week, signal: "redacted for PII", rate: r.redacted_rate }, { week: r.week, signal: "empty user input", rate: r.empty_input_rate }]);
  chart(view, {
    title: "PII redaction and empty inputs",
    so: `Latest complete week: ${fmtPct(lastDq.redacted_rate)} of conversations redacted for PII, ${fmtPct(lastDq.empty_input_rate)} with an empty user message.`,
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
    title: "Token usage field coverage",
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
    so: `${esc(countries.find((r) => !isResidual(r.country))?.country ?? "–")} leads. ${fmtPct(notRecordedC)} of conversations have no country recorded and ${fmtPct(smallC)} sit in cells under the floor; both are kept as their own muted bars.`,
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
    so: `${esc(topLang?.language ?? "–")} is ${fmtPct0((topLang?.conversations ?? 0) / total_l)} of conversations. "Yoruba" in the top ten is most likely a language-detector artifact.`,
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
  return el(`<details class="card reliability"><summary><h2>How reliable are these labels?</h2><span class="so">Held-out accuracy ${fmtPct(acc)}, against a ${fmtPct(agree)} inter-rater ceiling. Read a 5-point gap as real; a 2-point gap as noise.</span></summary>
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
    ? `Over the last 12 complete weeks, <b>${esc(riser.intent)}</b> rose most (${fmtPts(riser.delta)}, to ${fmtPct0(riser.now)}) and <b>${esc(faller.intent)}</b> fell most (${fmtPts(faller.delta)}, to ${fmtPct0(faller.now)}) versus the 12 weeks before.`
    : `${esc(FILTER.model)} has fewer than 24 complete weeks, so there is no earlier 12-week window to measure a shift against; the largest class in its last 12 weeks is <b>${esc(deltas.sort((a, b) => b.now - a.now)[0]?.intent ?? "–")}</b>.`;

  const rel = reliabilityCard(meta);
  insight(view, FILTER.model ? `What are people using ${esc(FILTER.model)} for, and what is shifting?` : "What are people using it for, and what is shifting?", [
    `<b>${esc(ranked[0])}</b> is the largest use at ${fmtPct0(overall.get(ranked[0]) / overallN)} of classified ${FILTER.model ? esc(FILTER.model) + " " : ""}conversations, then ${esc(ranked[1])} at ${fmtPct0(overall.get(ranked[1]) / overallN)}.`,
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
    so: `Top ${langOrder.length} languages by volume. Cells under ${meta.min_cell} conversations are suppressed.`,
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
  const signals = ["repeat_rate", "one_and_done_rate", "correction_rate", "refusal_rate"];
  const labels = { repeat_rate: "repeated request", one_and_done_rate: "one-and-done", correction_rate: "correction follow-up", refusal_rate: "assistant refusal" };
  const colors = palette();
  const color = Object.fromEntries(signals.map((s, i) => [labels[s], colors[i]]));
  const long = weekly.flatMap((r) => signals.map((s) => ({ week: r.week, signal: labels[s], rate: r[s] })));
  const avg = (rows, k) => (rows.length ? sum(rows, (r) => r[k]) / rows.length : null);
  const oad = lastVsPrior(weekly, "week", (rows) => avg(rows, "one_and_done_rate"));
  const last = weekly.at(-1) || {};

  let byIntent = [];
  if (meta.intent_coverage !== "none") {
    byIntent = await q(conn, `SELECT intent, model, conversations, repeat_rate, one_and_done_rate, correction_rate, refusal_rate FROM friction_by_intent_model WHERE true${modelWhere()}`);
  }
  const big = byIntent.filter((r) => r.conversations >= 1000);
  const worstRefusal = [...big].sort((a, b) => b.refusal_rate - a.refusal_rate)[0];
  const perIntent = await q(conn, `SELECT intent, sum(conversations)::BIGINT AS n,
      sum(conversations*repeat_rate)/sum(conversations) AS repeat_rate,
      sum(conversations*one_and_done_rate)/sum(conversations) AS one_and_done_rate,
      sum(conversations*correction_rate)/sum(conversations) AS correction_rate,
      sum(conversations*refusal_rate)/sum(conversations) AS refusal_rate
    FROM friction_by_intent_model WHERE true${modelWhere()} GROUP BY intent ORDER BY n DESC`).catch(() => []);
  const realWork = perIntent.filter((r) => r.intent !== "other");
  const mostOad = [...realWork].sort((a, b) => b.one_and_done_rate - a.one_and_done_rate)[0];
  const mostRefused = [...realWork].sort((a, b) => b.refusal_rate - a.refusal_rate)[0];

  insight(view, FILTER.model ? `Where does ${esc(FILTER.model)} fail people most?` : "Where does the assistant fail people most?", [
    worstRefusal ? `Refusals peak in <b>${esc(worstRefusal.intent)}${FILTER.model ? "" : ` on ${esc(worstRefusal.model)}`}</b> at ${fmtPct(worstRefusal.refusal_rate)} of conversations (cells with at least 1,000 conversations).` : byIntent.length ? "No intent × model cell reaches 1,000 conversations, so refusal peaks are not ranked." : "Friction by intent needs intent labels; this build has none.",
    oad.recent != null ? `One-and-done exits averaged <b>${fmtPct(oad.recent)}</b> of conversations over the last 12 complete weeks${oad.enough ? `, ${describeChange(pctChange(oad.recent, oad.prior))} versus the 12 weeks before` : ""}.` : "",
    !mostOad ? ""
      : FILTER.model && worstRefusal && mostRefused.intent === worstRefusal.intent
        ? `Among real requests, <b>${esc(mostOad.intent)}</b> has the most single-turn exits (${fmtPct(mostOad.one_and_done_rate)}).`
        : mostOad.intent === mostRefused.intent
          ? `Among real requests, <b>${esc(mostOad.intent)}</b> both has the most single-turn exits (${fmtPct(mostOad.one_and_done_rate)}) and draws the most refusals (${fmtPct(mostRefused.refusal_rate)}).`
          : `Among real requests, <b>${esc(mostOad.intent)}</b> has the most single-turn exits (${fmtPct(mostOad.one_and_done_rate)}) and <b>${esc(mostRefused.intent)}</b> draws the most refusals (${fmtPct(mostRefused.refusal_rate)}).`,
  ].filter(Boolean), { href: finding(11), text: "Read findings F5 and F11 in the trends report" });

  chart(view, {
    title: "Friction signals over time",
    so: `Latest complete week: one-and-done ${fmtPct(last.one_and_done_rate)}, repeated request ${fmtPct(last.repeat_rate)}, correction ${fmtPct(last.correction_rate)}, refusal ${fmtPct(last.refusal_rate)}.`,
    note: "Each signal is a proxy computed from transcript structure, not a judgment of the reply. Definitions and validated precision are in the metrics framework.",
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

  if (meta.intent_coverage === "none" || byIntent.length === 0) {
    view.append(el(`<div class="card"><h2>Friction by intent</h2><p class="note">Needs intent labels; not available in this build.</p></div>`));
    return;
  }
  const heat = byIntent.flatMap((r) => signals.map((s) => ({ intent: r.intent, model: r.model, signal: labels[s], rate: r[s], conversations: r.conversations })));
  const rowKey = (d) => (FILTER.model ? d.intent : `${d.intent} · ${d.model}`);
  const rowOrder = [...byIntent].sort((a, b) => a.intent.localeCompare(b.intent) || b.conversations - a.conversations).map(rowKey);
  chart(view, {
    title: FILTER.model ? `Friction by intent, ${FILTER.model}` : "Friction by intent and model",
    so: FILTER.model ? "Darker is worse. Isolate one signal to rank intents on it." : "Darker is worse. Isolate one signal to rank every intent × model pair on it.",
    note: `Rate of each friction signal for every intent × model pair with at least ${meta.min_cell} conversations. Rows are grouped by intent and ordered by volume.`,
    series: signals.map((s) => ({ key: labels[s], color: color[labels[s]] })),
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
  const aggFmt = perIntent.map((r) => ({
    intent: r.intent, n: fmtInt.format(r.n),
    repeat_rate: fmtPct(r.repeat_rate), one_and_done_rate: fmtPct(r.one_and_done_rate),
    correction_rate: fmtPct(r.correction_rate), refusal_rate: fmtPct(r.refusal_rate),
  }));
  const tbl = el(`<div class="card"><h2>Friction by intent, ${FILTER.model ? esc(FILTER.model) : "all models"}</h2><p class="note">Conversation-weighted rates.</p></div>`);
  tbl.append(tableEl(aggFmt));
  view.append(tbl);
}
registerRenderer("friction", renderFriction);

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
  location.hash = FILTER.model ? `${name}/${encodeURIComponent(FILTER.model)}` : name;
}

function parseHash() {
  const [view, model] = (location.hash || "#overview").slice(1).split("/");
  return { view: view || "overview", model: model ? decodeURIComponent(model) : null };
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
    paint();
    onChange();
  });
  paint();
  return paint;
}

async function main() {
  try {
    const { conn, meta } = await boot();
    $("#status").hidden = true;
    $("#caveat-population").textContent = meta.population_caveat;
    $("#caveat-users").textContent = meta.pseudo_user_caveat;
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
    console.error(err);
  }
}

main();
