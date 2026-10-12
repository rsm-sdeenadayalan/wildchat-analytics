// Loupe on your own logs, entirely in the browser. Reads a file, normalizes it to conversations,
// computes the same validated signals as the pipeline (loupe/text.py, loupe/attribution.py), and the
// model-or-users comparison. Nothing leaves the page.

// ---------- text rules: ports of loupe/text.py (\b replaced by a Unicode-aware lookahead) ----------
const B = "(?![\\p{L}\\p{N}_])";
const AP = "['’]?";
const CORRECTION = new RegExp(
  `^\\s*(?!no (?:problem|worries|thanks|need))(?:` +
  `no[,.!]|not (?:what|that)|wrong${B}|that${AP}s (?:not|wrong)|i said${B}|i meant${B}|incorrect${B}|` +
  `you didn${AP}t${B}|you did not${B}|try again${B}|` +
  `不对|不是这|不是我(?:要|说)的|错了|` +
  `нет[,.\\s]|неправильно|не то${B}|не так${B}|я сказал|я просил|` +
  `incorrecto${B}|no es eso|eso no${B}|mal[,.!\\s]|` +
  `non[,.!\\s]|ce n${AP}est pas|c${AP}est faux|faux${B}` +
  `)`, "iu");
const WORD_RUN = /[\p{L}\p{N}_]+/gu;
export const REPEAT_THRESHOLD = 0.6;
export const ONE_TURN_MAX_CHARS = 200;
export const MIN_MATCHED_USERS = 30;

const tokens = (s) => new Set(((s || "").match(WORD_RUN) || []).map((t) => t.toLowerCase()));
export function jaccard(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
export const isCorrection = (t) => CORRECTION.test(t || "");
export const isRepeat = (prev, cur) => prev != null && jaccard(prev, cur) >= REPEAT_THRESHOLD;

// ---------- input normalization ----------
const ROLE = (r) => {
  const s = String(r || "").toLowerCase();
  if (["user", "human", "customer", "client", "prompt", "input"].includes(s)) return "user";
  if (["assistant", "ai", "bot", "gpt", "model", "agent", "completion", "output", "chatbot"].includes(s)) return "assistant";
  if (s === "system" || s === "tool" || s === "function") return s;
  return s || null;
};
const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k]; return null; };
const contentOf = (m) => {
  const c = pick(m, ["content", "text", "message", "value", "body"]);
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p.text || p.content || "")).join("\n");
  return c == null ? "" : String(c);
};
const tsOf = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(v > 1e14 ? v / 1e6 : v > 1e11 ? v : v * 1000);
  const n = Number(v); if (!Number.isNaN(n) && /^\d+(\.\d+)?$/.test(String(v))) return tsOf(n);
  const d = new Date(v); return Number.isNaN(+d) ? null : d;
};
const MSG_KEYS = ["conversation", "messages", "turns", "chat", "dialog", "history", "chat_messages"];
const ID_KEYS = ["conversation_id", "conv_id", "conversationId", "thread_id", "threadId", "session_id", "sessionId", "id", "conversation_hash", "chat_id"];
const USER_KEYS = ["user_id", "userId", "user", "pseudo_user", "customer_id", "account_id", "enduser_id", "visitor_id", "hashed_ip", "distinct_id"];
const TS_KEYS = ["timestamp", "created_at", "createdAt", "time", "date", "ts", "start_time", "started_at"];
const MODEL_KEYS = ["model", "model_name", "llm", "engine"];
const VERSION_KEYS = ["prompt_version", "app_version", "release", "version", "deployment", "build"];
const RESP_KEYS = ["responder", "agent", "agent_name", "assistant_name", "name", "model"];

function fromConversationObjects(objs, notes) {
  const out = [];
  objs.forEach((o, i) => {
    const key = MSG_KEYS.find((k) => Array.isArray(o[k]));
    if (!key) return;
    const msgs = o[key].map((m) => ({ role: ROLE(pick(m, ["role", "author", "from", "speaker", "sender", "type"]) || (m.author && m.author.role)), content: contentOf(m),
      responder: pick(m, RESP_KEYS), ts: tsOf(pick(m, TS_KEYS)) })).filter((m) => m.role === "user" || m.role === "assistant");
    const first = o[key][0] || {};
    out.push({ id: String(pick(o, ID_KEYS) ?? i), user: pick(o, USER_KEYS) ?? pick(first, USER_KEYS), ts: tsOf(pick(o, TS_KEYS)) || msgs.find((m) => m.ts)?.ts || null,
      model: pick(o, MODEL_KEYS) ?? msgs.find((m) => m.role === "assistant" && m.responder)?.responder ?? null, version: pick(o, VERSION_KEYS) ?? pick(first, VERSION_KEYS), messages: msgs });
  });
  notes.push(`Read ${out.length.toLocaleString()} conversation objects (messages under "${MSG_KEYS.find((k) => objs.some((o) => Array.isArray(o[k])))}").`);
  return out;
}

function fromTurnRows(rows, notes) {
  const idKey = ID_KEYS.find((k) => rows.some((r) => r[k] != null));
  const roleKey = ["role", "author", "speaker", "from", "sender"].find((k) => rows.some((r) => r[k] != null));
  if (!idKey || !roleKey) return null;
  const by = new Map();
  rows.forEach((r, i) => {
    const id = String(r[idKey]);
    if (!by.has(id)) by.set(id, { id, user: pick(r, USER_KEYS), ts: tsOf(pick(r, TS_KEYS)), model: pick(r, MODEL_KEYS), messages: [], _order: [] });
    const c = by.get(id);
    const role = ROLE(r[roleKey]);
    if (role !== "user" && role !== "assistant") return;
    const order = Number(pick(r, ["turn", "idx", "index", "position", "seq", "message_index"]));
    c._order.push([Number.isNaN(order) ? i : order, { role, content: contentOf(r), responder: pick(r, RESP_KEYS), ts: tsOf(pick(r, TS_KEYS)) }]);
    c.version = c.version ?? pick(r, VERSION_KEYS);
    c.user = c.user ?? pick(r, USER_KEYS); c.model = c.model ?? (role === "assistant" ? pick(r, MODEL_KEYS) : null);
    const t = tsOf(pick(r, TS_KEYS)); if (t && (!c.ts || t < c.ts)) c.ts = t;
  });
  const out = [...by.values()].map((c) => { c.messages = c._order.sort((a, b) => a[0] - b[0]).map((x) => x[1]); delete c._order; return c; });
  notes.push(`Read ${rows.length.toLocaleString()} message rows grouped into ${out.length.toLocaleString()} conversations by "${idKey}".`);
  return out;
}

// OpenTelemetry (OTLP/JSON) traces using the GenAI semantic conventions. One trace = one conversation;
// each LLM span contributes the new user message and its reply, attributed to gen_ai.agent.name.
function attrMap(list) {
  const m = {};
  for (const a of list || []) { const v = a.value || {}; m[a.key] = v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? (v.arrayValue ? v.arrayValue.values : null); }
  return m;
}
const parseMaybe = (v) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };
function msgsFromAttr(v) {
  const x = parseMaybe(v);
  if (Array.isArray(x)) return x.map((m) => ({ role: ROLE(m.role), content: contentOf(m.parts ? { content: m.parts.map((p) => p.content || p.text || "") } : m) }));
  if (typeof x === "string") return [{ role: null, content: x }];
  return [];
}
function fromOtlp(doc, notes) {
  const spans = [];
  for (const rs of doc.resourceSpans || []) {
    const res = attrMap(rs.resource && rs.resource.attributes);
    for (const ss of rs.scopeSpans || rs.instrumentationLibrarySpans || []) for (const s of ss.spans || []) spans.push({ s, a: { ...res, ...attrMap(s.attributes) } });
  }
  const llm = spans.filter(({ a }) => Object.keys(a).some((k) => k.startsWith("gen_ai.")));
  const by = new Map();
  for (const { s, a } of llm) { if (!by.has(s.traceId)) by.set(s.traceId, []); by.get(s.traceId).push({ s, a }); }
  const out = [];
  for (const [traceId, list] of by) {
    list.sort((x, y) => Number(BigInt(x.s.startTimeUnixNano || 0) - BigInt(y.s.startTimeUnixNano || 0)));
    const conv = { id: traceId, user: null, ts: null, model: null, messages: [] };
    let lastUser = null;
    for (const { s, a } of list) {
      conv.user = conv.user ?? a["user.id"] ?? a["enduser.id"] ?? a["session.id"] ?? a["gen_ai.conversation.id"] ?? null;
      conv.ts = conv.ts || (s.startTimeUnixNano ? new Date(Number(BigInt(s.startTimeUnixNano) / 1000000n)) : null);
      const model = a["gen_ai.response.model"] ?? a["gen_ai.request.model"] ?? null;
      conv.model = conv.model ?? model;
      conv.version = conv.version ?? a["service.version"] ?? a["app.version"] ?? null;
      const responder = a["gen_ai.agent.name"] ?? s.name ?? model;
      const inputs = msgsFromAttr(a["gen_ai.input.messages"] ?? a["gen_ai.prompt"]);
      const outputs = msgsFromAttr(a["gen_ai.output.messages"] ?? a["gen_ai.completion"]);
      const u = [...inputs].reverse().find((m) => m.role === "user" || m.role === null);
      if (u && u.content && u.content !== lastUser) { conv.messages.push({ role: "user", content: u.content }); lastUser = u.content; }
      const o = outputs.find((m) => m.role !== "user");
      if (o && o.content) conv.messages.push({ role: "assistant", content: o.content, responder });
    }
    if (conv.messages.length) out.push(conv);
  }
  notes.push(`Read ${spans.length.toLocaleString()} spans; ${llm.length.toLocaleString()} carry gen_ai attributes; grouped into ${out.length.toLocaleString()} traces. Each step is attributed to gen_ai.agent.name.`);
  return out;
}

// Personal exports. ChatGPT (Settings > Data controls > Export) stores each conversation as a tree under
// `mapping`; the visible thread is the path from `current_node` back to the root. Hidden context (custom
// instructions), tool calls, tool output and reasoning summaries are skipped. Claude.ai exports use
// `chat_messages` with `sender` and are read by fromConversationObjects.
const isChatGptExport = (objs) => objs.some((o) => o && o.mapping && typeof o.mapping === "object" && "current_node" in o);
const isClaudeExport = (objs) => objs.some((o) => o && (Array.isArray(o.chat_messages) ||
  (o.uuid && MSG_KEYS.some((k) => Array.isArray(o[k]) && o[k].some((m) => m && "sender" in m)))));
const GPT_TEXT = new Set(["text", "multimodal_text", "code"]);
function fromChatGptExport(objs, notes) {
  const out = [];
  let skipped = 0;
  for (const o of objs) {
    if (!o || !o.mapping) continue;
    const path = [];
    let id = o.current_node, guard = 0;
    while (id && o.mapping[id] && guard++ < 100000) { path.push(o.mapping[id]); id = o.mapping[id].parent; }
    path.reverse();
    const messages = [];
    for (const node of path) {
      const m = node.message;
      if (!m || !m.author) continue;
      const role = m.author.role, meta = m.metadata || {}, c = m.content || {};
      if (role !== "user" && role !== "assistant") continue;
      if (meta.is_visually_hidden_from_conversation || !GPT_TEXT.has(c.content_type)) { skipped++; continue; }
      if (role === "assistant" && m.recipient && m.recipient !== "all") { skipped++; continue; }
      const text = c.content_type === "code" ? String(c.text || "") : (c.parts || []).map((p) => (typeof p === "string" ? p : p && p.text ? p.text : "")).join("\n").trim();
      if (!text) continue;
      messages.push({ role, content: text, responder: role === "assistant" ? meta.model_slug || o.default_model_slug || null : null, ts: tsOf(m.create_time) });
    }
    if (!messages.length) continue;
    out.push({ id: String(o.conversation_id || o.id || out.length), user: "you", ts: tsOf(o.create_time) || messages[0].ts,
      model: messages.find((m) => m.role === "assistant" && m.responder)?.responder || o.default_model_slug || null, messages });
  }
  notes.push(`Read ${out.length.toLocaleString()} conversations from a ChatGPT export, following the thread you saw in each (edited branches, tool calls and hidden context skipped).`);
  return out;
}

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1 || r[0]).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
}

export function normalize(text, filename = "") {
  const notes = [];
  const t = text.replace(/^﻿/, "").trim();
  let convs = null, format = "unknown", personal = false;
  if (/\.csv$/i.test(filename) || (!t.startsWith("{") && !t.startsWith("["))) {
    const rows = parseCsv(t);
    format = "csv"; convs = fromTurnRows(rows, notes);
    if (!convs) throw new Error("This CSV needs a conversation id column and a role column (one row per message).");
  } else {
    let doc = null, lines = null;
    try { doc = JSON.parse(t); } catch { lines = t.split(/\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)); }
    if (doc && doc.resourceSpans) { format = "otlp"; convs = fromOtlp(doc, notes); }
    else if (lines && lines[0] && lines[0].resourceSpans) { format = "otlp"; convs = lines.flatMap((d) => fromOtlp(d, notes)); }
    else {
      const objs = Array.isArray(doc) ? doc : doc && Array.isArray(doc.data) ? doc.data : doc && Array.isArray(doc.conversations) ? doc.conversations : lines || [doc];
      if (isChatGptExport(objs)) { format = "ChatGPT export"; personal = true; convs = fromChatGptExport(objs, notes); }
      else if (isClaudeExport(objs)) {
        format = "Claude export"; personal = true; convs = fromConversationObjects(objs, notes);
        convs.forEach((c) => { c.user = "you"; c.model = null; c.messages.forEach((m) => { m.responder = null; }); });
        notes[notes.length - 1] = `Read ${convs.length.toLocaleString()} conversations from a Claude export. Claude exports do not record which model answered, so there is no per-model view.`;
      }
      else if (objs.some((o) => o && MSG_KEYS.some((k) => Array.isArray(o[k])))) { format = "conversations"; convs = fromConversationObjects(objs, notes); }
      else { format = "message rows"; convs = fromTurnRows(objs, notes); }
    }
  }
  if (!convs || !convs.length) throw new Error("No conversations found. Expected chat conversations (JSON/JSONL), message rows (CSV/JSONL), or OpenTelemetry GenAI traces (OTLP JSON).");
  convs = convs.filter((c) => c.messages.some((m) => m.role === "user"));
  const hasUser = convs.filter((c) => c.user != null && c.user !== "").length / convs.length;
  const hasTs = convs.filter((c) => c.ts).length / convs.length;
  const hasModel = convs.filter((c) => c.model || c.messages.some((m) => m.responder)).length / convs.length;
  if (personal) notes.push("One person's history: Loupe shows what you use it for and where it fails you. The same-people model comparison needs many people, so it is off.");
  else if (hasUser < 0.5) notes.push("No user identifier on most conversations: each conversation is treated as its own person, so return rate and the same-people comparison are unavailable.");
  if (hasTs < 0.5) notes.push("No timestamps on most conversations: weekly trends and return rate are unavailable.");
  if (hasModel < 0.5 && !personal) notes.push("No model or responder field: model comparisons are unavailable.");
  return { format, personal, conversations: convs, notes, coverage: { user: hasUser, ts: hasTs, model: hasModel } };
}

// ---------- analysis ----------
const weekOf = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return +x; };

export function analyze(norm, classifier) {
  const convs = norm.conversations;
  const rows = convs.map((c, i) => {
    const user = c.user != null && c.user !== "" ? String(c.user) : `conv:${c.id}:${i}`;
    let prevUser = null, prevResp = null, rep = false, corr = false, lastAssistantLen = 0, nUser = 0;
    const charges = [];
    for (const m of c.messages) {
      if (m.role === "user") {
        nUser++;
        const r = isRepeat(prevUser, m.content), k = isCorrection(m.content);
        rep ||= r; corr ||= k;
        if (prevResp != null) charges.push({ responder: prevResp, repeat: r, correction: k });
        prevUser = m.content;
      } else {
        prevResp = m.responder || c.model || "assistant";
        charges.push({ responder: prevResp, reply: true });
        lastAssistantLen = m.content.length;
      }
    }
    const firstTwo = c.messages.filter((m) => m.role === "user").slice(0, 2).map((m) => m.content).join("\n").slice(0, 2000);
    const intent = classifier ? classifier.predict(firstTwo).label : null;
    return { idx: i, user, ts: c.ts, model: c.model || null, version: c.version != null && c.version !== "" ? String(c.version) : null, intent, turns: nUser, repeat: rep, correction: corr,
             oneTurn: nUser === 1 && lastAssistantLen < ONE_TURN_MAX_CHARS, charges };
  });
  const users = new Map(); for (const r of rows) users.set(r.user, (users.get(r.user) || 0) + 1);
  const realUsers = norm.coverage.user >= 0.5;
  const counts = [...users.values()].sort((a, b) => b - a);
  const top = counts.slice(0, Math.max(1, Math.ceil(counts.length * 0.1))).reduce((a, b) => a + b, 0);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const share = (k, subset = rows) => mean(subset.map((r) => (r[k] ? 1 : 0)));

  // weekly return: of users active in week w, share active in w+1 (only when the next week has any traffic)
  let weekly = [];
  if (realUsers && norm.coverage.ts >= 0.5) {
    const wk = new Map();
    for (const r of rows) if (r.ts) { const w = weekOf(r.ts); if (!wk.has(w)) wk.set(w, new Set()); wk.get(w).add(r.user); }
    const weeks = [...wk.keys()].sort((a, b) => a - b);
    weekly = weeks.map((w) => { const next = wk.get(w + 7 * 864e5); const cur = wk.get(w);
      return { week: new Date(w), users: cur.size, conversations: rows.filter((r) => r.ts && weekOf(r.ts) === w).length,
               return_rate: next ? [...cur].filter((u) => next.has(u)).length / cur.size : null }; });
  }
  const intents = {};
  if (classifier) for (const r of rows) intents[r.intent] = (intents[r.intent] || 0) + 1;
  const byIntent = classifier ? Object.keys(intents).map((i) => { const s = rows.filter((r) => r.intent === i);
    return { intent: i, n: s.length, share: s.length / rows.length, repeat: share("repeat", s), correction: share("correction", s), oneTurn: share("oneTurn", s) }; }).sort((a, b) => b.n - a.n) : [];

  // per-responder friction, charged to the reply the user reacted to
  const resp = new Map();
  for (const r of rows) for (const ch of r.charges) {
    if (!resp.has(ch.responder)) resp.set(ch.responder, { responder: ch.responder, replies: 0, repeats: 0, corrections: 0 });
    const x = resp.get(ch.responder);
    if (ch.reply) x.replies++; else { if (ch.repeat) x.repeats++; if (ch.correction) x.corrections++; }
  }
  const responders = [...resp.values()].filter((x) => x.replies > 0).map((x) => ({ ...x, repeatPer1k: 1000 * x.repeats / x.replies, correctionPer1k: 1000 * x.corrections / x.replies })).sort((a, b) => b.replies - a.replies);

  return {
    rows, realUsers, n: rows.length, nUsers: users.size, top10Share: counts.length ? top / rows.length : null,
    convsPerUserMedian: counts.length ? counts[Math.floor(counts.length / 2)] : null,
    span: (() => { const t = rows.map((r) => r.ts).filter(Boolean).sort((a, b) => a - b); return t.length ? [t[0], t[t.length - 1]] : null; })(),
    weekly, intents: byIntent, responders,
    repeat: share("repeat"), correction: share("correction"), oneTurn: share("oneTurn"),
    models: [...new Set(rows.map((r) => r.model).filter(Boolean))],
  };
}

// ---------- model or users? ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// Naive gap across everyone vs the gap for the same people seen on both sides, with a bootstrap interval.
// side(r) returns "a", "b" or null; the gap is a minus b.
function paired(subset, side, metric) {
  const val = (r) => (r[metric] ? 1 : 0);
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const A = subset.filter((r) => side(r) === "a"), Bs = subset.filter((r) => side(r) === "b");
  const naiveA = avg(A.map(val)), naiveB = avg(Bs.map(val));
  const per = new Map();
  for (const r of subset) { const s = side(r); if (!s) continue; if (!per.has(r.user)) per.set(r.user, { a: [], b: [] }); per.get(r.user)[s].push(val(r)); }
  const diffs = [], la = [], lb = [];
  for (const v of per.values()) if (v.a.length && v.b.length) { const x = avg(v.a), y = avg(v.b); diffs.push(x - y); la.push(x); lb.push(y); }
  const out = { nA: A.length, nB: Bs.length, naiveA, naiveB, naiveGap: naiveA != null && naiveB != null ? naiveA - naiveB : null, matchedUsers: diffs.length };
  if (diffs.length >= MIN_MATCHED_USERS) {
    const R = rng(7), boots = [];
    for (let i = 0; i < 2000; i++) { let s = 0; for (let j = 0; j < diffs.length; j++) s += diffs[Math.floor(R() * diffs.length)]; boots.push(s / diffs.length); }
    boots.sort((x, y) => x - y);
    Object.assign(out, { matchedA: avg(la), matchedB: avg(lb), matchedGap: avg(diffs), ci: [boots[Math.floor(0.025 * boots.length)], boots[Math.floor(0.975 * boots.length)]] });
  }
  return out;
}

export function compareModels(rows, a, b, metric, intent = null) {
  const subset = rows.filter((r) => (r.model === a || r.model === b) && (!intent || r.intent === intent));
  const out = { a, b, metric, intent, ...paired(subset, (r) => (r.model === a ? "a" : r.model === b ? "b" : null), metric) };
  out.verdict = verdict(out);
  return out;
}

// ---------- did my change help? ----------
// Release points: the first time each version label appears, in time order.
export function versionChanges(rows, key = "version") {
  const first = new Map();
  for (const r of rows) { const v = r[key]; if (v && r.ts && (!first.has(v) || r.ts < first.get(v))) first.set(v, r.ts); }
  const list = [...first].sort((x, y) => x[1] - y[1]);
  return list.slice(1).map(([v, at], i) => ({ version: v, previous: list[i][0], at }));
}

// Same people before and after a date. A placebo run at the midpoint of the "before" period checks
// whether a similar shift was already under way, which a before/after comparison cannot otherwise rule out.
// One person's history has no "same people" to hold fixed: compare conversations before and after instead,
// bootstrapping each side, and say so in the verdict.
function unpaired(subset, side, metric) {
  const val = (r) => (r[metric] ? 1 : 0);
  const A = subset.filter((r) => side(r) === "a").map(val), Bs = subset.filter((r) => side(r) === "b").map(val);
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const out = { nA: A.length, nB: Bs.length, naiveA: avg(A), naiveB: avg(Bs), naiveGap: A.length && Bs.length ? avg(A) - avg(Bs) : null, matchedUsers: null };
  if (A.length >= MIN_MATCHED_USERS && Bs.length >= MIN_MATCHED_USERS) {
    const R = rng(7), boots = [];
    const draw = (xs) => { let s = 0; for (let j = 0; j < xs.length; j++) s += xs[Math.floor(R() * xs.length)]; return s / xs.length; };
    for (let i = 0; i < 2000; i++) boots.push(draw(A) - draw(Bs));
    boots.sort((x, y) => x - y);
    Object.assign(out, { matchedA: out.naiveA, matchedB: out.naiveB, matchedGap: out.naiveGap, ci: [boots[50], boots[1950]] });
  }
  return out;
}

export function beforeAfter(rows, at, metric, intent = null, unit = "person") {
  const t0 = +at;
  const cmp = unit === "conversation" ? unpaired : paired;
  const subset = rows.filter((r) => r.ts && (!intent || r.intent === intent));
  const out = { at: new Date(t0), metric, intent, unit, ...cmp(subset, (r) => (+r.ts >= t0 ? "a" : "b"), metric) };
  const pre = subset.filter((r) => +r.ts < t0);
  if (pre.length) {
    const mid = (Math.min(...pre.map((r) => +r.ts)) + t0) / 2;
    const pl = cmp(pre, (r) => (+r.ts >= mid ? "a" : "b"), metric);
    out.placebo = { at: new Date(mid), gap: pl.matchedGap ?? null, ci: pl.ci ?? null, users: pl.matchedUsers };
  }
  out.verdict = changeVerdict(out);
  return out;
}

const SIGNAL = { repeat: "repeated requests", correction: "corrections", oneTurn: "conversations ending in one turn" };
const excludes0Of = (ci) => ci[0] > 0 || ci[1] < 0;
export function changeVerdict(c) {
  const p = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;
  if (c.naiveA === 0 && c.naiveB === 0) return { key: "none", title: "Nothing to compare", text: `No ${SIGNAL[c.metric]} on either side of this date.` };
  const conv = c.unit === "conversation";
  if (c.matchedGap == null && conv) return { key: "overlap", title: "Too few conversations", text: `${c.nB} conversations before and ${c.nA} after; a read needs at least ${MIN_MATCHED_USERS} on each side. Pick a date nearer the middle of your history.` };
  if (c.matchedGap == null) return { key: "overlap", title: "Not enough returning people", text: `Only ${c.matchedUsers} people were active both before and after. A before/after read needs at least ${MIN_MATCHED_USERS}; randomize the change in an experiment instead.` };
  const excludes0 = c.ci[0] > 0 || c.ci[1] < 0;
  // Minimum detectable effect at 80% power: (1.96 + 0.84) standard errors, the SE read off the 95% interval.
  const mde = ((c.ci[1] - c.ci[0]) / (2 * 1.96)) * 2.8 * 100;
  // A pre-existing trend only undermines a real shift in the same direction; a lone placebo hit is a 1-in-20 chance.
  const pl = excludes0Of(c.ci) && c.placebo && c.placebo.ci && excludes0Of(c.placebo.ci) && Math.sign(c.placebo.gap) === Math.sign(c.matchedGap);
  const warn = pl ? ` Caution: the same test run earlier, at ${c.placebo.at.toISOString().slice(0, 10)}, also shows a shift (${p(c.placebo.gap)} pts), so part of this may be a trend that was already under way.` : "";
  const range = `${p(c.ci[0])} to ${p(c.ci[1])}`;
  const caveat = " This compares your conversations, not a controlled test: what you asked about may have changed too.";
  if (!excludes0 && conv) return { key: "none", title: "No detectable change", text: `Across your ${c.nB.toLocaleString()} conversations before and ${c.nA.toLocaleString()} after, ${SIGNAL[c.metric]} moved ${p(c.matchedGap)} pts (95% interval ${range}). With this many conversations, only a change of about ${mde.toFixed(1)} pts or more would reliably show up.` + warn };
  if (!excludes0) return { key: "none", title: "No detectable change", text: `For the ${c.matchedUsers.toLocaleString()} people active on both sides, ${SIGNAL[c.metric]} moved ${p(c.matchedGap)} pts (95% interval ${range}). With this many people, only a change of about ${mde.toFixed(1)} pts or more would reliably show up; a smaller effect needs more traffic or an experiment.` + warn };
  const better = c.metric === "oneTurn" ? null : c.matchedGap < 0;
  const title = better == null ? (c.matchedGap < 0 ? "Fewer ended in one turn" : "More ended in one turn") : better ? "Improved" : "Got worse";
  if (conv) return { key: pl ? "trend" : better === false ? "worse" : "real", title, text: `Across your conversations, ${SIGNAL[c.metric]} moved ${p(c.matchedGap)} pts after this date (95% interval ${range}).` + caveat + warn };
  return { key: pl ? "trend" : better === false ? "worse" : "real", title, text: `For the same ${c.matchedUsers.toLocaleString()} people, ${SIGNAL[c.metric]} moved ${p(c.matchedGap)} pts after the change (95% interval ${range}).` + warn };
}

// ---------- failures to tests ----------
// The first repeat or correction in each conversation becomes a case: the conversation up to the failing reply,
// the reply itself, and what the person said next.
export function failureCases(norm, a) {
  const cases = [];
  norm.conversations.forEach((c, i) => {
    const row = a.rows[i];
    let prevUser = null, lastReply = -1;
    for (let j = 0; j < c.messages.length; j++) {
      const m = c.messages[j];
      if (m.role === "assistant") { lastReply = j; continue; }
      const r = isRepeat(prevUser, m.content), k = isCorrection(m.content);
      if ((r || k) && lastReply >= 0) {
        const reply = c.messages[lastReply];
        cases.push({ id: c.id, intent: row.intent, responder: reply.responder || c.model || "assistant", failure: k ? "correction" : "repeat",
          context: c.messages.slice(0, lastReply).map((x) => ({ role: x.role, content: x.content })), bad_reply: reply.content, user_feedback: m.content, version: row.version });
        break;
      }
      prevUser = m.content;
    }
  });
  return cases;
}

// Backlog themes: failures grouped by intent (and by responder when byResponder), with the opening asks of failed
// conversations as examples. The rate's denominator is conversations of that intent the responder replied in.
export function backlog(cases, a, byResponder = true) {
  const denom = new Map();
  for (const r of a.rows) {
    const resp = byResponder ? new Set(r.charges.filter((c) => c.reply).map((c) => c.responder)) : new Set([null]);
    for (const x of resp) { const k = `${r.intent}\u0000${x}`; denom.set(k, (denom.get(k) || 0) + 1); }
  }
  const g = new Map();
  for (const c of cases) {
    const resp = byResponder ? c.responder : null;
    const k = `${c.intent}\u0000${resp}`;
    if (!g.has(k)) g.set(k, { intent: c.intent, responder: resp, failures: 0, corrections: 0, repeats: 0, examples: [], conversations: denom.get(k) || null });
    const x = g.get(k);
    x.failures++; x[c.failure === "correction" ? "corrections" : "repeats"]++;
    const ask = c.context.find((m) => m.role === "user");  // the task the conversation started with
    if (ask && x.examples.length < 3) x.examples.push(ask.content.replace(/\s+/g, " ").slice(0, 160));
  }
  return [...g.values()].map((x) => ({ ...x, share: x.conversations ? x.failures / x.conversations : null })).sort((p, q) => q.failures - p.failures);
}

export function verdict(c) {
  if (c.matchedGap == null) return { key: "overlap", title: "Not enough overlap", text: `Only ${c.matchedUsers} people used both. Usage logs can't separate the model from the users here; randomize the model in an experiment instead.` };
  const excludes0 = c.ci[0] > 0 || c.ci[1] < 0;
  if (excludes0) return { key: "real", title: "Real difference", text: `Holding the person fixed, the gap is ${(c.matchedGap * 100).toFixed(1)} points (95% interval ${(c.ci[0] * 100).toFixed(1)} to ${(c.ci[1] * 100).toFixed(1)}). It survives the same-people test.` };
  if (c.naiveGap != null && Math.abs(c.naiveGap) >= 0.03 && Math.abs(c.matchedGap) < Math.abs(c.naiveGap) / 3)
    return { key: "mix", title: "User mix", text: `The ${(c.naiveGap * 100).toFixed(1)}-point gap shrinks to ${(c.matchedGap * 100).toFixed(1)} for the same people (interval ${(c.ci[0] * 100).toFixed(1)} to ${(c.ci[1] * 100).toFixed(1)}). Different people use these models; don't act on the dashboard gap.` };
  return { key: "none", title: "No clear difference", text: `For the same people the gap is ${(c.matchedGap * 100).toFixed(1)} points, interval ${(c.ci[0] * 100).toFixed(1)} to ${(c.ci[1] * 100).toFixed(1)}. Not distinguishable from zero.` };
}
