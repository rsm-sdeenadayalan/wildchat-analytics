"""Train a browser-sized intent classifier and export it for the Try-it page.

Same labels, same 80/20 split and seed as loupe/stages/classify.py, same feature families
(char_wb 2-4 and word 1-2 TF-IDF, logistic regression), capped vocabularies so the model ships
as a ~1 MB file. It is only exported if its held-out accuracy clears the same gate as the
production model (90% of measured inter-rater agreement). Writes site/try/intent-model.json,
including self-test strings with the Python predictions so the JavaScript port can be checked
for exact parity.
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import duckdb
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import FeatureUnion, Pipeline

from loupe.stages.classify import effective_threshold, label_mapping

SELFTEST = [
    "write a python function that reverses a linked list", "hi", "test", "translate this to french: good morning",
    "Write a short poem about the ocean at night", "what is the capital of australia and why", "fix this sql query select * from users where",
    "generate a midjourney prompt for a cyberpunk city", "help me rewrite my cover letter for a product manager role",
    "Explain quantum entanglement like I'm five", "我想让你扮演一个文字冒险游戏", "как написать письмо начальнику",
    "roleplay as a medieval knight", "summarise this article for me", "asdfgh", "def foo(x): return x ** 2  why is this slow",
]


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.asarray(a, dtype="<f4").tobytes()).decode()


def main(char_k: int = 30_000, word_k: int = 30_000, out: Path = Path("site/try/intent-model.json")) -> int:
    con = duckdb.connect()
    rows = con.execute("""SELECT c.intent_text, l.intent FROM read_parquet('samples/intent_labels.parquet') l
                          JOIN read_parquet('data/flat/conversations/*.parquet') c USING (conv_id)""").fetchall()
    mapping = label_mapping()
    texts = [r[0] or "" for r in rows]
    labels = [mapping.get(r[1], r[1]) for r in rows]
    x_tr, x_te, y_tr, y_te = train_test_split(texts, labels, test_size=0.2, random_state=7, stratify=labels)
    pipe = Pipeline([
        ("tfidf", FeatureUnion([
            ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=2, max_features=char_k, sublinear_tf=True)),
            ("word", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), min_df=2, max_features=word_k, sublinear_tf=True)),
        ])),
        ("clf", LogisticRegression(max_iter=3000, C=4.0)),
    ]).fit(x_tr, y_tr)
    acc = accuracy_score(y_te, pipe.predict(x_te))
    gate, study = effective_threshold(0.85)
    print(f"browser model ({char_k}+{word_k} features): held-out accuracy {acc:.4f}, gate {gate}", file=sys.stderr)
    if acc < gate:
        print("below the gate; not exported", file=sys.stderr)
        return 1
    fu = pipe.named_steps["tfidf"]; clf = pipe.named_steps["clf"]
    def vec(v):
        inv = sorted(v.vocabulary_.items(), key=lambda kv: kv[1])
        return {"terms": [t for t, _ in inv], "idf": b64(v.idf_)}
    char_v, word_v = dict(fu.transformer_list)["char"], dict(fu.transformer_list)["word"]
    probs = pipe.predict_proba(SELFTEST)
    model = {
        "format": "loupe-intent-browser-v1",
        "classes": list(clf.classes_),
        "char": {"ngram": [2, 4], **vec(char_v)}, "word": {"ngram": [1, 2], **vec(word_v)},
        "coef": b64(clf.coef_), "intercept": [float(x) for x in clf.intercept_],
        "n_features": [len(char_v.vocabulary_), len(word_v.vocabulary_)],
        "heldout_accuracy": round(float(acc), 4), "gate": gate, "n_test": len(y_te),
        "rater_agreement": study["agreement_current_taxonomy"] if study else None,
        "selftest": [{"text": t, "label": clf.classes_[int(np.argmax(p))], "proba": [round(float(x), 6) for x in p]} for t, p in zip(SELFTEST, probs)],
    }
    out.write_text(json.dumps(model, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size/1e6:.2f} MB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(*(int(a) for a in sys.argv[1:3])))
