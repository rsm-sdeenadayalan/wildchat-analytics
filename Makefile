.PHONY: setup test flatten sample label classify metrics all clean-raw site serve

SHARDS ?= all
MIN_CELL ?= 20

setup:
	uv python install 3.12
	uv sync --extra dev

test:
	uv run pytest -q

flatten:
	uv run loupe flatten --shards $(SHARDS)

sample:
	uv run loupe sample --n 20000

label:
	uv run loupe label

classify:
	uv run loupe classify

metrics:
	uv run loupe metrics --min-cell $(MIN_CELL)

all: flatten sample label classify metrics

clean-raw:
	rm -rf data/raw

site:
	uv run python scripts/build_site.py
	uv run python scripts/check_site.py

serve: site
	python3 -m http.server -d dist 8000
