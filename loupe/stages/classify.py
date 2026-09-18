"""Stage 3b: train a char n-gram classifier on LLM labels; predict intent for every conversation."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb
import joblib
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

from loupe import schema


def _pipeline() -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=2, max_features=400_000, sublinear_tf=True)),
        ("clf", LogisticRegression(max_iter=2000, C=4.0)),
    ])


def train(texts: list[str], labels: list[str], seed: int = 7) -> tuple[Pipeline, dict]:
    x_tr, x_te, y_tr, y_te = train_test_split(texts, labels, test_size=0.2, random_state=seed, stratify=labels)
    model = _pipeline().fit(x_tr, y_tr)
    pred = model.predict(x_te)
    classes = sorted(set(labels))
    rep = classification_report(y_te, pred, labels=classes, output_dict=True, zero_division=0)
    report = {
        "n_train": len(x_tr), "n_test": len(x_te),
        "accuracy": float(accuracy_score(y_te, pred)),
        "macro_f1": float(f1_score(y_te, pred, average="macro", labels=classes, zero_division=0)),
        "classes": classes,
        "per_class": {c: {"precision": float(rep[c]["precision"]), "recall": float(rep[c]["recall"]),
                          "f1": float(rep[c]["f1-score"]), "support": int(rep[c]["support"])} for c in classes},
        "confusion": confusion_matrix(y_te, pred, labels=classes).tolist(),
    }
    return model, report


def _write_report(report_path: Path, report: dict) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2))


def run(labels_path: Path = Path("samples/intent_labels.parquet"), flat_dir: Path = Path("data/flat"),
        out_dir: Path = Path("data/flat/intent"), model_path: Path = Path("data/models/intent.joblib"),
        report_path: Path = Path("aggregates/intent_classifier_report.json"), threshold: float = 0.85,
        force: bool = False, extra_training: tuple[list[str], list[str]] | None = None) -> dict:
    con = duckdb.connect()
    rows = con.execute(f"""
      SELECT l.conv_id, c.intent_text, l.intent
      FROM read_parquet('{labels_path}') l JOIN read_parquet('{flat_dir}/conversations/*.parquet') c USING (conv_id)
    """).fetchall()
    texts = [r[1] for r in rows]
    labels = [r[2] for r in rows]
    if extra_training:  # test hook only
        texts += extra_training[0]
        labels += extra_training[1]
    model, report = train(texts, labels)
    report["threshold"] = threshold
    report["predicted"] = False
    report["forced"] = False
    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, model_path)
    print(f"held-out accuracy {report['accuracy']:.3f}, macro F1 {report['macro_f1']:.3f} (threshold {threshold})", file=sys.stderr)

    if report["accuracy"] < threshold and not force:
        print("below threshold; not predicting. Use --force to override (marks coverage as sample_only).", file=sys.stderr)
        _write_report(report_path, report)
        con.close()
        return report

    out_dir.mkdir(parents=True, exist_ok=True)
    shards = [r[0] for r in con.execute(f"SELECT DISTINCT shard FROM read_parquet('{flat_dir}/conversations/*.parquet') ORDER BY 1").fetchall()]
    for shard in shards:
        data = con.execute(f"""
          SELECT conv_id, intent_text, has_empty_user_input FROM read_parquet('{flat_dir}/conversations/{shard}.parquet')
        """).fetchall()
        ids = [d[0] for d in data]
        mask = np.array([not d[2] and len(d[1] or "") >= 5 for d in data])
        intents: list[str | None] = [None] * len(data)
        probas = np.zeros(len(data), dtype=np.float32)
        if mask.any():
            xs = [data[i][1] for i in np.flatnonzero(mask)]
            proba = model.predict_proba(xs)
            pred = model.classes_[proba.argmax(axis=1)]
            for k, i in enumerate(np.flatnonzero(mask)):
                intents[i] = str(pred[k])
                probas[i] = float(proba[k].max())
        table = pa.Table.from_pydict({"conv_id": ids, "intent": intents, "proba_max": probas.tolist(),
                                      "shard": [shard] * len(ids)}, schema=schema.INTENT)
        pq.write_table(table, out_dir / f"{shard}.parquet", compression="zstd")
    report["predicted"] = True
    report["forced"] = bool(force and report["accuracy"] < threshold)
    _write_report(report_path, report)
    con.close()
    return report
