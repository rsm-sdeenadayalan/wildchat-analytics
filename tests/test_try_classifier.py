"""The browser intent classifier must reproduce the Python model's predictions exactly."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

MODEL = Path("site/try/intent-model.json")


@pytest.mark.skipif(shutil.which("node") is None or not MODEL.exists(), reason="needs node and the exported model")
def test_js_port_matches_python_selftest():
    script = """
      import { loadIntentModel } from './site/try/intent.js';
      import fs from 'node:fs';
      globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
      const m = JSON.parse(fs.readFileSync('site/try/intent-model.json', 'utf8'));
      const c = loadIntentModel(m);
      let worst = 0, mism = [];
      for (const t of m.selftest) {
        const p = c.proba(t.text);
        for (let k = 0; k < p.length; k++) worst = Math.max(worst, Math.abs(p[k] - t.proba[k]));
        if (c.predict(t.text).label !== t.label) mism.push(t.text);
      }
      console.log(JSON.stringify({ worst, mism, n: m.selftest.length }));
    """
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout
    res = json.loads(out)
    assert res["mism"] == [], res
    assert res["worst"] < 1e-4, res
