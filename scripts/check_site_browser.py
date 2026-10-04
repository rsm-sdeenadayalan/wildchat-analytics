"""Load the built site in a real headless browser and fail on any page error or a dashboard that never renders.

Serves dist/ on a local port, opens the Overview, waits for the status line to clear and tiles to appear,
clicks every tab, and reports page errors, console errors, and failed requests. Requires Playwright and a
Chromium: `uv run playwright install chromium` (CI) or an installed Google Chrome (`--channel chrome`).
"""
from __future__ import annotations

import asyncio
import http.server
import socketserver
import sys
import threading
from pathlib import Path

TABS = ["overview", "intensity", "intent", "friction", "quality", "query"]


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # keep the check's output to findings only
        pass


def _serve(directory: Path, port: int):
    handler = lambda *a, **k: _QuietHandler(*a, directory=str(directory), **k)  # noqa: E731
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


LAYOUT_WIDTHS = (390, 768, 1000, 1100, 1280)


def expected_tiles(dist: Path) -> dict[str, str]:
    """Overview tile values recomputed from dist/aggregates with DuckDB, formatted as the page formats them."""
    import json
    import duckdb

    agg = dist / "aggregates"
    meta = json.loads((agg / "meta.json").read_text())
    con = duckdb.connect()
    convs, turns = con.execute(f"SELECT sum(conversations), sum(turns) FROM '{agg / 'volume_daily_model.parquet'}'").fetchone()
    peak = con.execute(f"SELECT max(pseudo_users) FROM '{agg / 'intensity_weekly.parquet'}'").fetchone()[0]
    ret = con.execute(f"SELECT return_rate FROM '{agg / 'intensity_weekly.parquet'}' WHERE return_rate IS NOT NULL "
                      f"AND week <= DATE '{meta['complete_weeks_through']}' ORDER BY week DESC LIMIT 1").fetchone()[0]
    weeks = con.execute(f"SELECT count(DISTINCT date_trunc('week', date)) FROM '{agg / 'volume_daily_model.parquet'}' "
                        f"WHERE date_trunc('week', date) <= DATE '{meta['complete_weeks_through']}'").fetchone()[0]
    return {
        "conversations": f"{convs:,}",
        "turns": f"{turns:,}",
        "complete weeks with data": f"{weeks:,}",
        "peak weekly pseudo-users": f"{peak:,}",
        "week-over-week return": f"{100 * ret:.1f}%",
        "intent coverage": meta["intent_coverage"],
    }


def location_has_model(hash_value: str, model: str) -> bool:
    return hash_value.endswith("/" + model)


async def check(dist: Path = Path("dist"), port: int = 8771, channel: str | None = None, timeout_s: int = 90) -> list[str]:
    from playwright.async_api import async_playwright

    problems: list[str] = []
    httpd = _serve(dist, port)
    try:
        async with async_playwright() as p:
            browser = await (p.chromium.launch(channel=channel, headless=True) if channel else p.chromium.launch(headless=True))
            page = await browser.new_page()
            page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
            page.on("console", lambda m: problems.append(f"console.error: {m.text[:200]}") if m.type == "error" else None)
            page.on("requestfailed", lambda r: problems.append(f"requestfailed: {r.url}"))
            await page.goto(f"http://127.0.0.1:{port}/app/", wait_until="load")
            try:
                await page.wait_for_function("document.querySelector('#status').hidden && document.querySelectorAll('.tile').length > 0",
                                             timeout=timeout_s * 1000)
            except Exception:
                status = await page.evaluate("document.querySelector('#status')?.textContent")
                problems.append(f"dashboard never rendered; status still: {status!r}")
            epoch_ticks = await page.evaluate(
                "[...document.querySelectorAll('#view-overview svg text')].map(t => t.textContent).filter(t => /^\\d{1,3}(,\\d{3}){3,}$/.test(t))")
            if epoch_ticks:
                problems.append(f"overview axis shows epoch milliseconds instead of dates: {epoch_ticks[:3]}")
            for tab in TABS[1:]:
                await page.click(f'.tabs button[data-view="{tab}"]')
                await page.wait_for_timeout(1500)
                n = await page.evaluate(f"document.querySelectorAll('#view-{tab} .card, #view-{tab} .tile').length")
                if n == 0:
                    problems.append(f"view {tab}: rendered nothing")
            # Product surface: every analytic view opens with an insight card, and every chart has a clickable legend
            # whose chips isolate a series (the drawn series count must drop).
            for tab in TABS[:-1]:
                n_insight = await page.evaluate(f"document.querySelectorAll('#view-{tab} .card.insight').length")
                if n_insight != 1:
                    problems.append(f"view {tab}: expected one insight card, found {n_insight}")
                n_charts, n_legends = await page.evaluate(
                    f"[document.querySelectorAll('#view-{tab} .card.chart').length, document.querySelectorAll('#view-{tab} .card.chart .legend .chip[data-key]').length]")
                if n_charts == 0 or n_legends < n_charts:
                    problems.append(f"view {tab}: {n_charts} charts but only {n_legends} legend chips")
            await page.click('.tabs button[data-view="overview"]')
            await page.wait_for_timeout(300)
            before = await page.evaluate("document.querySelectorAll('#view-overview .card.chart figure svg g[aria-label=\"area\"] path').length")
            await page.click('#view-overview .card.chart .legend .chip[data-key]')
            await page.wait_for_timeout(500)
            after = await page.evaluate("document.querySelectorAll('#view-overview .card.chart figure svg g[aria-label=\"area\"] path').length")
            if not (0 < after < before):
                problems.append(f"legend isolate did not reduce drawn series: {before} -> {after}")
            await page.click('#view-overview .card.chart .legend .chip-all')
            await page.wait_for_timeout(300)
            # Tiles must equal the same quantities computed straight from the published aggregates.
            await page.click('.tabs button[data-view="overview"]')
            await page.wait_for_timeout(500)
            tiles = await page.evaluate("Object.fromEntries([...document.querySelectorAll('#view-overview .tile')].map(t => [t.querySelector('span').textContent, t.querySelector('b').textContent]))")
            for label, want in expected_tiles(dist).items():
                if tiles.get(label) != want:
                    problems.append(f"tile {label!r} shows {tiles.get(label)!r}, aggregates say {want!r}")
            # Cross-view model filter: picking a model re-renders every view for that model only.
            await page.click('#model-picker button[data-model="gpt-4o"]')
            await page.wait_for_timeout(1500)
            banner = await page.evaluate("document.querySelector('#scope-banner')?.textContent || ''")
            if "gpt-4o" not in banner or not location_has_model(await page.evaluate("location.hash"), "gpt-4o"):
                problems.append(f"model filter: banner/hash did not reflect gpt-4o: {banner!r}")
            n_series = await page.evaluate("document.querySelectorAll('#view-overview .card.chart figure svg g[aria-label=\"area\"] path').length")
            if n_series != 1:
                problems.append(f"model filter: overview volume chart should draw one series, drew {n_series}")
            heading = await page.evaluate("document.querySelector('#view-overview .card.insight h2')?.textContent || ''")
            if "gpt-4o" not in heading:
                problems.append(f"model filter: overview insight did not mention the model: {heading!r}")
            for tab in TABS[1:-1]:
                await page.click(f'.tabs button[data-view="{tab}"]')
                await page.wait_for_timeout(1500)
                n = await page.evaluate(f"document.querySelectorAll('#view-{tab} .card').length")
                if n == 0:
                    problems.append(f"model filter: view {tab} rendered nothing for gpt-4o")
            n_scope = await page.evaluate("document.querySelectorAll('#view-quality .card.chart .scope').length")
            if n_scope < 2:
                problems.append(f"model filter: unfiltered charts should carry an 'All models' tag, found {n_scope}")
            await page.click('#model-picker button[data-model=""]')
            await page.wait_for_timeout(500)
            await page.click('.tabs button[data-view="overview"]')
            await page.wait_for_timeout(1500)
            n_series = await page.evaluate("document.querySelectorAll('#view-overview .card.chart figure svg g[aria-label=\"area\"] path').length")
            if n_series < 2:
                problems.append(f"model filter: reset did not restore all series ({n_series})")
            # Layout: at common widths no horizontal page scroll, and no KPI number wider than its tile.
            for width in LAYOUT_WIDTHS:
                await page.set_viewport_size({"width": width, "height": 900})
                await page.click('.tabs button[data-view="overview"]')
                await page.wait_for_timeout(300)
                sw, cw = await page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
                if sw > cw:
                    problems.append(f"horizontal overflow at {width}px: scrollWidth {sw} > {cw}")
                clipped = await page.evaluate(
                    "[...document.querySelectorAll('.tile b')].filter(b => b.scrollWidth > b.clientWidth + 1 || b.getClientRects().length > 1).map(b => b.textContent)")
                if clipped:
                    problems.append(f"KPI numbers wrap or clip at {width}px: {clipped[:3]}")
            # The story page: paints beat 1 without the database, carries the live numbers, pins and scrolls to beat 4
            # with all four tiles answered, and hands off to the dashboard.
            story = await browser.new_page()
            story.on("pageerror", lambda e: problems.append(f"story pageerror: {e}"))
            story.on("console", lambda m: problems.append(f"story console.error: {m.text[:200]}") if m.type == "error" else None)
            await story.goto(f"http://127.0.0.1:{port}/", wait_until="domcontentloaded")
            if await story.evaluate("document.querySelector('#stage')?.dataset.beat") != "1":
                problems.append("story: first paint should show beat 1")
            try:
                await story.wait_for_function("document.querySelectorAll('#story-map circle').length > 20 && document.querySelectorAll('#ledger a').length === 4", timeout=timeout_s * 1000)
            except Exception:
                problems.append("story: map dots or ledger did not render")
            if not await story.evaluate("/\\d/.test(document.querySelector('#s-users')?.textContent || '')"):
                problems.append("story: live numbers did not fill in")
            if not await story.evaluate("!!document.querySelector('#lens-chart svg path')"):
                problems.append("story: loupe sparkline did not render")
            await story.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await story.wait_for_timeout(1500)
            beat, answered = await story.evaluate("[document.querySelector('#stage').dataset.beat, document.querySelectorAll('.qtile.answered').length]")
            if beat != "4" or answered != 4:
                problems.append(f"story: at the end expected beat 4 with 4 answers, got beat {beat} with {answered}")
            hrefs = await story.evaluate("[...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))")
            if not any(h in ("app/", "./app/") for h in hrefs):
                problems.append("story: no link to the dashboard at app/")
            sw, cw = await story.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            if sw > cw:
                problems.append(f"story: horizontal overflow {sw} > {cw}")
            await browser.close()
    finally:
        httpd.shutdown()
    return problems


def main() -> int:
    channel = sys.argv[1] if len(sys.argv) > 1 else None
    problems = asyncio.run(check(channel=channel))
    for pr in problems:
        print(pr)
    print("browser check:", "OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
