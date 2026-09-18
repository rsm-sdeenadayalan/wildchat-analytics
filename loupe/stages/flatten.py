"""Stage 1: shards -> data/flat/{conversations,turns}/<label>.parquet"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pyarrow.parquet as pq

from loupe import hf
from loupe.adapters.wildchat import flatten_shard


def _outputs(out_dir: Path, lab: str) -> tuple[Path, Path]:
    return out_dir / "conversations" / f"{lab}.parquet", out_dir / "turns" / f"{lab}.parquet"


def _process(path: Path, lab: str, out_dir: Path) -> None:
    c_path, t_path = _outputs(out_dir, lab)
    c_path.parent.mkdir(parents=True, exist_ok=True)
    t_path.parent.mkdir(parents=True, exist_ok=True)
    convs, turns = flatten_shard(path, lab)
    pq.write_table(convs, c_path, compression="zstd")
    pq.write_table(turns, t_path, compression="zstd")


def run(shards: str = "all", raw_dir: Path = Path("data/raw"), out_dir: Path = Path("data/flat"),
        keep_raw: bool = False, local_paths: list[Path] | None = None) -> list[str]:
    done: list[str] = []
    if local_paths is not None:
        for p in local_paths:
            lab = hf.label(p.name)
            if all(x.exists() for x in _outputs(out_dir, lab)):
                continue
            _process(Path(p), lab, out_dir)
            done.append(lab)
        return done

    names = hf.select(hf.list_shards(), shards)
    for k, name in enumerate(names, 1):
        lab = hf.label(name)
        if all(x.exists() for x in _outputs(out_dir, lab)):
            print(f"[{k}/{len(names)}] {lab} exists, skip", file=sys.stderr)
            continue
        t = time.time()
        path = hf.download_shard(name, raw_dir)
        _process(path, lab, out_dir)
        if not keep_raw:
            path.unlink(missing_ok=True)
        print(f"[{k}/{len(names)}] {lab} done in {time.time() - t:.0f}s", file=sys.stderr)
        done.append(lab)
    return done
