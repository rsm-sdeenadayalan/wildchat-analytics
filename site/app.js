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
  const [users] = await q(conn, `SELECT max(pseudo_users) AS peak_users, avg(return_rate) AS avg_return FROM intensity_weekly`);
  view.innerHTML = `<div class="tiles">
    ${tile("conversations", fmtInt.format(tot.convs))}
    ${tile("turns", fmtInt.format(tot.turns))}
    ${tile("weeks covered", fmtInt.format(Math.round((tot.d1 - tot.d0) / 86400000 / 7)))}
    ${tile("peak weekly pseudo-users", fmtInt.format(users.peak_users))}
    ${tile("avg week-over-week return", fmtPct(users.avg_return))}
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

main();
