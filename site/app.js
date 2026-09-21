import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm";
import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.17/+esm";

export const AGGREGATES = [
  "volume_daily_model", "volume_weekly_country", "volume_weekly_language",
  "intensity_weekly", "pseudo_user_persistence_quarterly", "depth_by_model",
  "intent_weekly", "intent_by_model", "intent_by_language",
  "friction_by_intent_model", "friction_weekly", "data_quality_weekly",
];

const $ = (sel) => document.querySelector(sel);
const fmtInt = new Intl.NumberFormat("en-US");
const fmtPct = (x) => (x == null ? "–" : (100 * x).toFixed(1) + "%");
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const palette = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--c${i}`));

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
  return table.toArray().map((row) => {
    const o = row.toJSON();
    for (const k in o) if (typeof o[k] === "bigint") o[k] = Number(o[k]);
    return o;
  });
}

function tile(label, value) {
  return `<div class="tile"><b>${value}</b><span>${label}</span></div>`;
}

function card(title, note, figure) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `<h2>${title}</h2><p class="note">${note}</p><figure></figure>`;
  el.querySelector("figure").append(figure);
  return el;
}

function tableEl(rows, limit = 200) {
  if (!rows.length) return Object.assign(document.createElement("p"), { textContent: "No rows." });
  const cols = Object.keys(rows[0]);
  const wrap = document.createElement("div");
  wrap.className = "tablewrap";
  const fmt = (v) => v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "number" && !Number.isInteger(v) ? v.toFixed(4) : String(v ?? "");
  wrap.innerHTML = `<table class="grid"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0, limit).map((r) => `<tr>${cols.map((c) => `<td>${fmt(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return wrap;
}

export async function renderOverview(conn, meta) {
  const view = $("#view-overview");
  const [tot] = await q(conn, `SELECT sum(conversations) AS convs, sum(turns) AS turns, min(date) AS d0, max(date) AS d1 FROM volume_daily_model`);
  const [users] = await q(conn, `SELECT max(pseudo_users) AS peak_users FROM intensity_weekly`);
  const [latest] = await q(conn, `SELECT return_rate FROM intensity_weekly WHERE return_rate IS NOT NULL ORDER BY week DESC LIMIT 1`);
  view.innerHTML = `<div class="tiles">
    ${tile("conversations", fmtInt.format(tot.convs))}
    ${tile("turns", fmtInt.format(tot.turns))}
    ${tile("weeks covered", fmtInt.format(Math.round((tot.d1 - tot.d0) / 86400000 / 7)))}
    ${tile("peak weekly pseudo-users", fmtInt.format(users.peak_users))}
    ${tile("return rate, latest complete week", fmtPct(latest?.return_rate))}
    ${tile("intent coverage", meta.intent_coverage)}
  </div>`;
  const weekly = await q(conn, `SELECT date_trunc('week', date)::DATE AS week, model, sum(conversations) AS conversations FROM volume_daily_model GROUP BY ALL ORDER BY week`);
  view.append(card("Weekly conversations by model", "Volume. Each line is one model family as recorded in the logs.",
    Plot.plot({
      width: Math.min(1060, view.clientWidth), height: 320, marginLeft: 60,
      color: { legend: true, range: palette() },
      x: { label: null }, y: { label: "conversations / week", grid: true },
      marks: [Plot.lineY(weekly, { x: "week", y: "conversations", stroke: "model", tip: true })],
    })));
}

function quarterLabel(d) {
  const dt = new Date(d);
  const quarter = Math.floor(dt.getUTCMonth() / 3) + 1;
  return `${dt.getUTCFullYear()} Q${quarter}`;
}

export async function renderIntensity(conn) {
  const view = $("#view-intensity");
  view.innerHTML = "";
  const w = Math.min(1060, view.clientWidth);
  const weekly = await q(conn, `SELECT * FROM intensity_weekly ORDER BY week`);
  const last = weekly.at(-1) || {};
  view.innerHTML = `<div class="tiles">
    ${tile("latest weekly pseudo-users", fmtInt.format(last.pseudo_users ?? 0))}
    ${tile("latest week-over-week return", fmtPct(last.return_rate))}
    ${tile("latest top-10% share of conversations", fmtPct(last.top10_share))}
    ${tile("latest conversations / pseudo-user (p50)", (last.convs_per_user_p50 ?? 0).toFixed(1))}
  </div>`;
  view.append(card("Week-over-week return rate", "Share of pseudo-users active in a week who are active again the following week. Weeks with a NULL return_rate — no following week present in the data, including the most recent week — are drawn as gaps, not zeros; hover a point near a gap to see next_week_present.",
    Plot.plot({ width: w, height: 260, marginLeft: 50, y: { label: "return rate", grid: true, percent: true }, x: { label: null },
      marks: [Plot.lineY(weekly, { x: "week", y: "return_rate", stroke: css("--c1"), tip: true, channels: { "next week present": "next_week_present" } })] })));
  view.append(card("Weekly pseudo-users and concentration", "Left axis: pseudo-users active. Line color: share of conversations from the top 10% of pseudo-users.",
    Plot.plot({ width: w, height: 260, marginLeft: 60, color: { legend: true, label: "top-10% share", range: [css("--seq-2"), css("--seq-5")] },
      y: { label: "pseudo-users", grid: true }, x: { label: null },
      marks: [Plot.lineY(weekly, { x: "week", y: "pseudo_users", stroke: "top10_share", tip: true })] })));
  view.append(card("Conversations per pseudo-user per week", "Median (solid) and 90th percentile (dashed).",
    Plot.plot({ width: w, height: 240, marginLeft: 50, y: { label: "conversations", grid: true }, x: { label: null },
      marks: [Plot.lineY(weekly, { x: "week", y: "convs_per_user_p50", stroke: css("--c1"), tip: true }),
              Plot.lineY(weekly, { x: "week", y: "convs_per_user_p90", stroke: css("--c1"), strokeDasharray: "4 3", tip: true })] })));
  const persistence = await q(conn, `SELECT * FROM pseudo_user_persistence_quarterly ORDER BY quarter`);
  persistence.forEach((r) => (r.quarter_label = quarterLabel(r.quarter)));
  view.append(card("How long pseudo-users persist", "Share of a quarter's pseudo-users active in more than one week. The sharp drop after 2024-10 is a property of the collection (pseudo-user keys stopped persisting), not of user behavior; return rates are not comparable across that boundary.",
    Plot.plot({ width: w, height: 240, marginLeft: 50, y: { label: "share active in >1 week", grid: true, percent: true }, x: { label: null },
      marks: [Plot.barY(persistence, { x: "quarter_label", y: "share_multi_week", fill: css("--c1"), tip: true })] })));
  const depth = await q(conn, `SELECT model, depth_bucket, conversations FROM depth_by_model`);
  const order = ["1", "2", "3-5", "6-10", "11+"];
  view.append(card("Session depth by model", "Distribution of turns per conversation. A turn is one user message and one reply.",
    Plot.plot({ width: w, height: 240, marginLeft: 60,
      x: { domain: order, label: null }, y: { label: "share of model's conversations", grid: true, percent: true }, fx: { label: null },
      marks: [Plot.barY(depth, Plot.normalizeY("sum", { x: "depth_bucket", y: "conversations", fill: css("--c1"), fx: "model", tip: true }))] })));
}
registerRenderer("intensity", renderIntensity);

export async function renderQuality(conn, meta) {
  const view = $("#view-quality");
  view.innerHTML = `<div class="tiles">
    ${tile("minimum cell size", meta.min_cell)}
    ${tile("shards processed", `${meta.shards} / 86`)}
    ${tile("taxonomy", meta.taxonomy_version)}
    ${tile("aggregates size", (meta.aggregate_bytes / 1e6).toFixed(1) + " MB")}
  </div>`;
  const w = Math.min(1060, view.clientWidth);
  const dq = await q(conn, `SELECT * FROM data_quality_weekly ORDER BY week`);
  view.append(card("PII redaction and empty inputs", "Share of conversations the dataset authors redacted for PII, and share with an empty user message (a quirk of the collection chatbot).",
    Plot.plot({ width: w, height: 240, marginLeft: 50, y: { label: "share", grid: true, percent: true }, x: { label: null }, color: { legend: true, range: [css("--c1"), css("--c2")] },
      marks: [Plot.lineY(dq, { x: "week", y: "redacted_rate", stroke: () => "redacted", tip: true }),
              Plot.lineY(dq, { x: "week", y: "empty_input_rate", stroke: () => "empty input", tip: true })] })));
  view.append(card("Token usage field coverage", "Share of conversations whose logs include token counts. Coverage is 0 before 2024-09-09 (the field did not exist yet) and spotty afterwards; token metrics are only valid where this is high.",
    Plot.plot({ width: w, height: 200, marginLeft: 50, y: { label: "coverage", grid: true, percent: true }, x: { label: null },
      marks: [Plot.areaY(dq, { x: "week", y: "token_usage_coverage", fill: css("--seq-2") }), Plot.lineY(dq, { x: "week", y: "token_usage_coverage", stroke: css("--c1"), tip: true })] })));
  const countries = await q(conn, `SELECT country, sum(conversations) AS conversations FROM volume_weekly_country GROUP BY country ORDER BY 2 DESC LIMIT 15`);
  view.append(card("Top countries", `Any week × country cell with fewer than ${meta.min_cell} conversations, together with conversations that have no country, is rolled into a \`suppressed_or_unknown\` row per week; that row is kept as its own bar here (not dropped) and is large — about 8% of all conversations — because country is frequently missing, not because any one country is being hidden.`,
    Plot.plot({ width: w, height: 360, marginLeft: 130, x: { label: "conversations", grid: true }, y: { label: null },
      marks: [Plot.barX(countries, { y: "country", x: "conversations", fill: css("--c1"), sort: { y: "-x" }, tip: true })] })));
  const langs = await q(conn, `SELECT language, sum(conversations) AS conversations FROM volume_weekly_language GROUP BY language ORDER BY 2 DESC LIMIT 12`);
  view.append(card("Top languages", `Most frequently detected language per conversation. The \`suppressed_or_unknown\` row (missing or below the ${meta.min_cell}-conversation floor) is kept as its own bar, well under 1% of conversations here since language is rarely missing.`,
    Plot.plot({ width: w, height: 320, marginLeft: 110, x: { label: "conversations", grid: true }, y: { label: null },
      marks: [Plot.barX(langs, { y: "language", x: "conversations", fill: css("--c3"), sort: { y: "-x" }, tip: true })] })));
}
registerRenderer("quality", renderQuality);

function showView(name) {
  document.querySelectorAll("main section").forEach((s) => (s.hidden = s.id !== `view-${name}`));
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  location.hash = name;
}

const RENDERERS = { overview: renderOverview };
export function registerRenderer(name, fn) { RENDERERS[name] = fn; }

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
    const rendered = new Set();
    const go = async (name) => {
      showView(name);
      if (!rendered.has(name) && RENDERERS[name]) { await RENDERERS[name](conn, meta); rendered.add(name); }
    };
    document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
    await go((location.hash || "#overview").slice(1));
  } catch (err) {
    $("#status").textContent = `Failed to load: ${err.message}`;
    console.error(err);
  }
}

function noIntent(view) {
  view.innerHTML = `<div class="card"><h2>Intent not available</h2><p class="note">The classify stage has not produced intent labels for this build. See Data quality → coverage.</p></div>`;
}

export async function renderIntent(conn, meta) {
  const view = $("#view-intent");
  if (meta.intent_coverage === "none") return noIntent(view);
  view.innerHTML = "";
  const w = Math.min(1060, view.clientWidth);
  const weekly = await q(conn, `SELECT week, intent, conversations FROM intent_weekly ORDER BY week`);
  view.append(card("What people ask for, over time", "Share of each week's classified conversations by intent. Classes are defined in the metrics framework.",
    Plot.plot({ width: w, height: 340, marginLeft: 50, color: { legend: true, range: palette().concat(palette()) },
      y: { label: "share of week", grid: true, percent: true }, x: { label: null },
      marks: [Plot.areaY(weekly, Plot.stackY({ offset: "normalize" }, { x: "week", y: "conversations", fill: "intent", tip: true }))] })));
  const byModel = await q(conn, `SELECT model, intent, conversations FROM intent_by_model`);
  view.append(card("Intent mix by model", "Which models people reached for, by what they were trying to do.",
    Plot.plot({ width: w, height: 320, marginLeft: 100, color: { legend: true, range: palette().concat(palette()) },
      x: { label: "share of model's conversations", grid: true, percent: true }, y: { label: null },
      marks: [Plot.barX(byModel, Plot.stackX({ offset: "normalize" }, { y: "model", x: "conversations", fill: "intent", tip: true }))] })));
  const byLang = await q(conn, `SELECT language, intent, conversations FROM intent_by_language`);
  view.append(card("Intent mix by language (top 10 languages)", `Cells under ${meta.min_cell} conversations are suppressed.`,
    Plot.plot({ width: w, height: 360, marginLeft: 100, color: { legend: true, range: palette().concat(palette()) },
      x: { label: "share of language's conversations", grid: true, percent: true }, y: { label: null },
      marks: [Plot.barX(byLang, Plot.stackX({ offset: "normalize" }, { y: "language", x: "conversations", fill: "intent", tip: true }))] })));
}
registerRenderer("intent", renderIntent);

export async function renderFriction(conn, meta) {
  const view = $("#view-friction");
  view.innerHTML = "";
  const w = Math.min(1060, view.clientWidth);
  const weekly = await q(conn, `SELECT * FROM friction_weekly ORDER BY week`);
  const series = ["repeat_rate", "one_and_done_rate", "correction_rate", "refusal_rate"];
  const labels = { repeat_rate: "repeated request", one_and_done_rate: "one-and-done", correction_rate: "correction follow-up", refusal_rate: "assistant refusal" };
  const long = weekly.flatMap((r) => series.map((s) => ({ week: r.week, signal: labels[s], rate: r[s] })));
  view.append(card("Friction signals over time", "Each is a proxy computed from transcript structure, not a judgment of the reply. Definitions and validated precision are in the metrics framework.",
    Plot.plot({ width: w, height: 300, marginLeft: 50, color: { legend: true, range: palette() },
      y: { label: "share of conversations", grid: true, percent: true }, x: { label: null },
      marks: [Plot.lineY(long, { x: "week", y: "rate", stroke: "signal", tip: true })] })));
  if (meta.intent_coverage === "none") {
    view.append(card("Friction by intent", "Needs intent labels; not available in this build.", document.createElement("div")));
    return;
  }
  const byIntent = await q(conn, `SELECT intent, model, conversations, repeat_rate, one_and_done_rate, correction_rate, refusal_rate FROM friction_by_intent_model`);
  if (byIntent.length === 0) {
    view.append(card("Friction by intent", "No rows in this build.", document.createElement("div")));
    return;
  }
  const heat = byIntent.flatMap((r) => series.map((s) => ({ intent: r.intent, model: r.model, signal: labels[s], rate: r[s] })));
  view.append(card("Friction by intent and model", "Darker is worse. Use this to find where the assistant fails people most.",
    Plot.plot({ width: w, height: 60 + 26 * new Set(heat.map((d) => d.intent + d.model)).size, marginLeft: 200, padding: 0,
      color: { legend: true, label: "rate", range: [css("--seq-1"), css("--seq-5")], percent: true },
      x: { label: null, axis: "top" }, y: { label: null },
      marks: [Plot.cell(heat, { x: "signal", y: (d) => `${d.intent} · ${d.model}`, fill: "rate", tip: true, inset: 0.5 })] })));
  const agg = await q(conn, `SELECT intent, sum(conversations) AS n,
      sum(conversations*repeat_rate)/sum(conversations) AS repeat_rate,
      sum(conversations*one_and_done_rate)/sum(conversations) AS one_and_done_rate,
      sum(conversations*correction_rate)/sum(conversations) AS correction_rate,
      sum(conversations*refusal_rate)/sum(conversations) AS refusal_rate
    FROM friction_by_intent_model GROUP BY intent ORDER BY n DESC`);
  const aggFmt = agg.map((r) => ({
    intent: r.intent, n: r.n,
    repeat_rate: fmtPct(r.repeat_rate), one_and_done_rate: fmtPct(r.one_and_done_rate),
    correction_rate: fmtPct(r.correction_rate), refusal_rate: fmtPct(r.refusal_rate),
  }));
  view.append(card("Friction by intent, all models", "Conversation-weighted rates.", tableEl(aggFmt)));
}
registerRenderer("friction", renderFriction);

main();
