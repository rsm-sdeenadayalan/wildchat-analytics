// Browser port of Loupe's intent classifier: char_wb 2-4 and word 1-2 TF-IDF (sublinear tf, l2 per
// vectorizer, as sklearn's FeatureUnion does) feeding a multinomial logistic regression. Matches
// scikit-learn's analyzers so predictions agree with the Python model; checked by tests/test_try_classifier.py.

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function b64f32(s) {
  const bin = atob(s);
  const buf = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(buf);
}

// sklearn _char_wb_ngrams: collapse runs of 2+ whitespace, split on whitespace, pad each word with one space.
function charWb(text, lo, hi) {
  const out = [];
  const words = text.replace(/\s\s+/gu, " ").split(/\s+/u).filter(Boolean);
  for (const w0 of words) {
    const w = Array.from(" " + w0 + " ");
    const L = w.length;
    for (let n = lo; n <= hi; n++) {
      let off = 0;
      out.push(w.slice(off, off + n).join(""));
      while (off + n < L) { off++; out.push(w.slice(off, off + n).join("")); }
      if (off === 0) break;
    }
  }
  return out;
}

// sklearn default token_pattern (?u)\b\w\w+\b == maximal runs of 2+ word characters.
function wordNgrams(text, lo, hi) {
  const toks = [];
  let cur = "";
  for (const ch of text) {
    if (WORD_CHAR.test(ch)) cur += ch;
    else { if (Array.from(cur).length >= 2) toks.push(cur); cur = ""; }
  }
  if (Array.from(cur).length >= 2) toks.push(cur);
  const out = [];
  for (let n = lo; n <= hi; n++) for (let i = 0; i + n <= toks.length; i++) out.push(toks.slice(i, i + n).join(" "));
  return out;
}

function tfidf(grams, index, idf, offset, into) {
  const counts = new Map();
  for (const g of grams) { const j = index.get(g); if (j !== undefined) counts.set(j, (counts.get(j) || 0) + 1); }
  let norm = 0;
  const vals = [];
  for (const [j, c] of counts) { const v = (1 + Math.log(c)) * idf[j]; vals.push([j, v]); norm += v * v; }
  norm = Math.sqrt(norm) || 1;
  for (const [j, v] of vals) into.push([offset + j, v / norm]);
}

export function loadIntentModel(json) {
  const m = json;
  const charIdx = new Map(m.char.terms.map((t, i) => [t, i]));
  const wordIdx = new Map(m.word.terms.map((t, i) => [t, i]));
  const charIdf = b64f32(m.char.idf), wordIdf = b64f32(m.word.idf);
  const coef = b64f32(m.coef);
  const nChar = m.char.terms.length, nFeat = nChar + m.word.terms.length, K = m.classes.length;
  function proba(text) {
    const t = String(text || "").toLowerCase();
    const x = [];
    tfidf(charWb(t, m.char.ngram[0], m.char.ngram[1]), charIdx, charIdf, 0, x);
    tfidf(wordNgrams(t, m.word.ngram[0], m.word.ngram[1]), wordIdx, wordIdf, nChar, x);
    const z = m.intercept.slice();
    for (let k = 0; k < K; k++) { let s = z[k]; const base = k * nFeat; for (const [j, v] of x) s += coef[base + j] * v; z[k] = s; }
    const mx = Math.max(...z);
    const e = z.map((v) => Math.exp(v - mx));
    const tot = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / tot);
  }
  function predict(text) { const p = proba(text); let b = 0; for (let k = 1; k < p.length; k++) if (p[k] > p[b]) b = k; return { label: m.classes[b], confidence: p[b] }; }
  return { classes: m.classes, proba, predict, accuracy: m.heldout_accuracy, gate: m.gate };
}
