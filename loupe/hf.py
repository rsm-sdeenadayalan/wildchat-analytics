"""Hugging Face dataset access via huggingface_hub (listing, resumable download)."""
from __future__ import annotations

from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download

DATASET = "allenai/WildChat-4.8M"


def list_shards() -> list[str]:
    files = HfApi().list_repo_files(DATASET, repo_type="dataset")
    return sorted(f.rsplit("/", 1)[-1] for f in files if f.startswith("data/") and f.endswith(".parquet"))


def select(names: list[str], spec: str) -> list[str]:
    if spec == "all":
        return list(names)
    idx: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            idx.extend(range(int(a), int(b) + 1))
        elif part:
            idx.append(int(part))
    return [names[i] for i in idx]


def label(name: str) -> str:
    return Path(name).stem


def download_shard(name: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    # hf_hub_download preserves the repo path, so the file lands at dest_dir/data/<name>
    path = hf_hub_download(repo_id=DATASET, repo_type="dataset", filename=f"data/{name}", local_dir=str(dest_dir))
    return Path(path)
