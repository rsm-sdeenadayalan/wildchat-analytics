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
            await page.goto(f"http://127.0.0.1:{port}/", wait_until="load")
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
            before = await page.evaluate("document.querySelectorAll('#view-overview .card.chart figure svg path[stroke]').length")
            await page.click('#view-overview .card.chart .legend .chip[data-key]')
            await page.wait_for_timeout(500)
            after = await page.evaluate("document.querySelectorAll('#view-overview .card.chart figure svg path[stroke]').length")
            if not (0 < after < before):
                problems.append(f"legend isolate did not reduce drawn series: {before} -> {after}")
            await page.click('#view-overview .card.chart .legend .chip-all')
            await page.wait_for_timeout(300)
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
