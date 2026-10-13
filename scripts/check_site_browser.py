"""Load the built site in a real headless browser and fail on any page error or a dashboard that never renders.

Serves dist/ on a local port, opens the Overview, waits for the status line to clear and tiles to appear,
clicks every tab, and reports page errors, console errors, and failed requests. Requires Playwright and a
Chromium: `uv run playwright install chromium` (CI) or an installed Google Chrome (`--channel chrome`).
"""
from __future__ import annotations

import asyncio
import http.server
import math
import socketserver
import sys
import threading
from pathlib import Path

TABS = ["overview", "next", "intent", "friction", "intensity", "quality", "query"]
ANALYTIC_TABS = ["overview", "intensity", "intent", "friction", "quality"]


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # keep the check's output to findings only
        pass


def _serve(directory: Path, port: int):
    handler = lambda *a, **k: _QuietHandler(*a, directory=str(directory), **k)  # noqa: E731
    socketserver.TCPServer.allow_reuse_address = True  # back-to-back runs otherwise hit the port's TIME_WAIT
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
            for tab in ANALYTIC_TABS:
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
            await page.click('.tabs button[data-view="friction"]')
            await page.wait_for_timeout(1500)
            if await page.evaluate("document.querySelectorAll('#view-friction .card.built, #view-friction .card.contract').length"):
                problems.append("friction: the withdrawn routing card or the folded contract card is back")
            if not await page.evaluate("document.querySelectorAll('#view-friction .card.chart').length >= 4"):
                problems.append("friction: the per-responder chart did not render")
            # Next steps: fix list with a backlog download, the same-people check, the eval scorer, the withdrawn routing card.
            await page.click('.tabs button[data-view="next"]')
            await page.wait_for_timeout(1500)
            if await page.evaluate("document.querySelectorAll('#view-next .card.next').length") != 4:
                problems.append("next: expected four next-step cards")
            if await page.evaluate("document.querySelectorAll('#view-next table.fix tbody tr').length") < 4:
                problems.append("next: fix list has fewer than four intents")
            if await page.evaluate("document.querySelectorAll('#view-next table.mixcheck .vd').length") != 4:
                problems.append("next: same-people check should show four verdicts")
            async with page.expect_download() as dl:
                await page.click('#fix-csv')
            if not (await dl.value).suggested_filename.endswith(".csv"):
                problems.append("next: backlog download is not a csv")
            await page.click('#view-next .withdrawn summary')
            before = await page.evaluate("document.querySelector('#view-next .era-so').textContent")
            await page.click('#view-next .era-tabs [data-era="A"]')
            await page.wait_for_timeout(200)
            after = await page.evaluate("document.querySelector('#view-next .era-so').textContent")
            if before == after or "null result" not in after:
                problems.append("next: era toggle did not switch to the era A null result")
            await page.set_viewport_size({"width": 390, "height": 844})
            await page.wait_for_timeout(300)
            sw, cw = await page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            if sw > cw:
                problems.append(f"next: horizontal overflow on a phone ({sw} > {cw})")
            await page.set_viewport_size({"width": 1280, "height": 900})
            await page.wait_for_timeout(300)
            w0 = await page.evaluate("document.querySelector('#ev-weighted').textContent")
            await page.fill('#view-next tr[data-intent="coding"] input', "1")
            await page.wait_for_timeout(200)
            w1 = await page.evaluate("document.querySelector('#ev-weighted').textContent")
            if w0 == "–" or w0 == w1:
                problems.append(f"next: eval scorer did not recompute ({w0!r} -> {w1!r})")
            await page.fill('#view-next tr[data-intent="coding"] input', "0.4")
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
            # Analytics: the tracker helper exists on every page type and never throws (localhost = no-op, elsewhere PostHog).
            if not await story.evaluate("typeof window.loupeTrack === 'function'"):
                problems.append("analytics: window.loupeTrack missing on the story page")
            if not await page.evaluate("typeof window.loupeTrack === 'function'"):
                problems.append("analytics: window.loupeTrack missing on the dashboard")
            await story.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await story.wait_for_timeout(1500)
            beat, answered = await story.evaluate("[document.querySelector('#stage').dataset.beat, document.querySelectorAll('.qtile.answered').length]")
            if beat != "5" or answered != 4:
                problems.append(f"story: at the end expected the WildChat canvas on the finding (beat 5) with 4 answered tiles, got beat {beat} with {answered}")
            # The finding settles on the same-people numbers, and the sequence ends on its last step with the next-steps link.
            pin_beat, step, va, gap = await story.evaluate("[document.querySelector('#story').dataset.beat, document.querySelector('#how-stage')?.dataset.step, document.querySelector('#how-va')?.textContent || '', document.querySelector('#how-gapv')?.textContent || '']")
            if pin_beat != "9" or step != "3" or not va.endswith("%") or "23" in gap:
                problems.append(f"story: expected to end on beat 9 / step 3 with the gap collapsed, got beat {pin_beat!r}, step {step!r}, value {va!r}, gap {gap!r}")
            # One gesture, one step: a trackpad-like flick (a burst of wheel events) moves exactly one stop, momentum included.
            top = await story.evaluate("document.querySelector('#story').closest('.pin-spacer').getBoundingClientRect().top + scrollY")
            await story.evaluate(f"window.scrollTo(0, {top})")
            await story.wait_for_timeout(800)
            await story.mouse.move(400, 400)
            for _ in range(2):
                for d in (60, 45, 30, 18, 10, 5):
                    await story.mouse.wheel(0, d)
                    await story.wait_for_timeout(16)
                await story.wait_for_timeout(2000)
            stop, in_story = await story.evaluate("[document.querySelector('#story').dataset.stop, document.body.classList.contains('in-story')]")
            if stop != "2" or not in_story:
                problems.append(f"story: two flicks should land on stop 2 with the frame full screen, got stop {stop!r}, full screen {in_story}")
            # Real trackpad input: swipes ramp up, then momentum decays for ~1.8 s, longer than a scene. Each swipe must play
            # exactly one scene, even when it starts while the last one's momentum is still arriving; one hard swipe and one
            # long steady scroll must each play one scene.
            def swipe(peak=40):
                n = int(1.8 / 0.016)
                return [max(1, round(peak * (i + 1) / 5)) for i in range(5)] + [max(1, round(peak * math.exp(-4.0 * i / n))) for i in range(n)]
            async def play(deltas):
                for d in deltas:
                    await story.mouse.wheel(0, d)
                    await story.wait_for_timeout(16)
            stops_at = lambda: story.evaluate("+document.querySelector('#story').dataset.stop")
            for label, expect, gesture in [
                ("three swipes 1.6 s apart", 3, [swipe()[:100], swipe()[:100], swipe()]),
                ("one hard swipe", 1, [swipe(120)]),
                ("a steady 3 s scroll", 1, [[12, 7, 16, 11, 9, 14, 13, 8, 15, 10] * 19]),
            ]:
                await story.evaluate(f"window.scrollTo(0, {top})")
                await story.wait_for_timeout(1500)
                s0 = await stops_at()
                for g in gesture:
                    await play(g)
                await story.wait_for_timeout(4500)
                moved = await stops_at() - s0
                if moved != expect:
                    problems.append(f"story: {label} should move {expect} scene(s), moved {moved}")
            # Reversing mid-scene takes effect at once: scroll down, then up a moment later, and the page must not
            # keep travelling down to finish the downward scene; it returns to where it started.
            await story.evaluate(f"window.scrollTo(0, {top})")
            await story.wait_for_timeout(1500)
            await play(swipe()[:6])
            await story.wait_for_timeout(300)
            await story.evaluate("window.__lowest = scrollY; (function f(){ window.__lowest = Math.max(window.__lowest, scrollY); if (!window.__stopLow) requestAnimationFrame(f); })()")
            y_at_up = await story.evaluate("scrollY")
            await play([-d for d in swipe()])
            await story.wait_for_timeout(2500)
            lowest, back = await story.evaluate("window.__stopLow = true; [window.__lowest, scrollY]")
            if lowest - y_at_up > 80 or abs(back - top) > 4:
                problems.append(f"story: after reversing mid-scene the page went {lowest - y_at_up:.0f}px further down and ended {back - top:.0f}px from the start")
            # "Skip the story" jumps straight past it to the finale, with the top bar back.
            await story.evaluate(f"window.scrollTo(0, {top})")
            await story.wait_for_timeout(1500)
            await story.click("#skip-story")
            await story.wait_for_timeout(1000)
            fin_top, in_story = await story.evaluate("[Math.round(document.querySelector('#finale').getBoundingClientRect().top), document.body.classList.contains('in-story')]")
            if abs(fin_top) > 4 or in_story:
                problems.append(f"story: skip link should land on the finale (top {fin_top}px) with the story released (in story: {in_story})")
            # Past the last scene, a whole trackpad scroll (which starts with tiny deltas) must move the page, not just its first event.
            span = await story.evaluate("document.querySelector('#story').closest('.pin-spacer').offsetHeight - innerHeight")
            await story.evaluate(f"window.scrollTo(0, {top} + 0.9963 * {span})")
            await story.wait_for_timeout(1500)
            y0 = await story.evaluate("scrollY")
            for d in (2, 4, 8, 14, 22, 30, 34, 30, 24, 18, 13, 9, 6, 4, 3, 2, 1, 1):
                await story.mouse.wheel(0, d)
                await story.wait_for_timeout(16)
            await story.wait_for_timeout(1200)
            moved = await story.evaluate("scrollY") - y0
            if moved < 100:
                problems.append(f"story: a trackpad scroll past the last scene moved the page only {moved:.0f}px")
            hrefs = await story.evaluate("[...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))")
            if not any(h in ("app/", "./app/", "app/#next") for h in hrefs):
                problems.append("story: no link to the dashboard at app/")
            sw, cw = await story.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            if sw > cw:
                problems.append(f"story: horizontal overflow {sw} > {cw}")
            # Try page: a sample chat log reaches the user-mix verdict; a sample agent trace singles out the writer sub-agent.
            tp = await browser.new_page()
            tp.on("pageerror", lambda e: problems.append(f"try pageerror: {e}"))
            await tp.goto(f"http://127.0.0.1:{port}/try/", wait_until="load")
            await tp.click('[data-sample="chat-sample.jsonl"]')
            try:
                await tp.wait_for_function("document.querySelector('#cmp .verdict .badge')", timeout=timeout_s * 1000)
                badge = await tp.evaluate("document.querySelector('#cmp .verdict .badge').textContent")
                if badge.strip().lower() != "user mix":
                    problems.append(f"try: chat sample verdict should be 'User mix', got {badge!r}")
            except Exception:
                problems.append("try: chat sample never produced a verdict")
            # The planted prompt change (v1 -> v2) cuts corrections, so the before/after check must call it an improvement.
            chg = await tp.evaluate("document.querySelector('#chg .verdict .badge')?.textContent || ''")
            if chg.strip().lower() != "improved":
                problems.append(f"try: change check on the chat sample should say 'Improved', got {chg!r}")
            for kind, head, lines in (("jsonl", '{"id"', 10), ("promptfoo", "# Loupe regression cases", 10), ("csv", "theme,responder", 3)):
                async with tp.expect_download() as dl:
                    await tp.click(f'[data-export="{kind}"]')
                body = Path(await (await dl.value).path()).read_text()
                if not body.startswith(head) or body.count("\n") < lines:
                    problems.append(f"try: {kind} export looks wrong: {body[:60]!r}")
            await tp.click('[data-sample="agent-traces.otlp.json"]')
            await tp.wait_for_timeout(4000)
            so = await tp.evaluate("document.querySelector('#resp-so')?.textContent || ''")
            if not so.startswith("writer"):
                problems.append(f"try: agent sample should single out the writer sub-agent, got {so[:60]!r}")
            # A personal ChatGPT export switches to the one-person view and the summary copies.
            await tp.click('[data-sample="chatgpt-export-sample.json"]')
            try:
                await tp.wait_for_function("document.querySelector('#compare-card').hidden && /^You push back on/.test(document.querySelector('#resp-so')?.textContent || '')", timeout=timeout_s * 1000)
            except Exception:
                problems.append("try: ChatGPT export sample did not switch to the personal view")
            chg = await tp.evaluate("document.querySelector('#change-card').hidden ? '' : (document.querySelector('#chg .verdict .badge')?.textContent || '')")
            if not chg or chg.strip().lower() == "too few conversations":
                problems.append(f"try: personal change check should open on a readable comparison, got {chg!r}")
            fx = await tp.evaluate("document.querySelector('#fx-card').hidden ? '' : document.querySelector('#fx-so').textContent")
            if "of your conversations had" not in fx:
                problems.append(f"try: personal failures card missing or wrong: {fx[:60]!r}")
            await tp.click("#copy-sum")
            await tp.wait_for_timeout(300)
            summ = await tp.evaluate("document.querySelector('#sum-text').textContent")
            if not summ.startswith("My AI use, read by Loupe") or "loupe.shankard.com/try/" not in summ:
                problems.append(f"try: copy summary looks wrong: {summ[:80]!r}")
            sw, cw = await tp.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            if sw > cw:
                problems.append(f"try: horizontal overflow {sw} > {cw}")
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
