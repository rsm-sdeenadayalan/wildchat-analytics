.PHONY: setup test flatten sample label classify metrics all clean-raw

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
