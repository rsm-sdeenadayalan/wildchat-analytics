"""Real-browser smoke test of the built site. Skips when Playwright or a browser is unavailable."""
import asyncio
import subprocess
import sys
from pathlib import Path

import pytest

pytest.importorskip("playwright")


def _browser_channel():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        for channel in (None, "chrome"):
            try:
                b = p.chromium.launch(channel=channel, headless=True) if channel else p.chromium.launch(headless=True)
                b.close()
                return channel or "bundled"
            except Exception:
                continue
    return None


def test_dashboard_renders_every_view_without_page_errors():
    channel = _browser_channel()
    if channel is None:
        pytest.skip("no Chromium available for Playwright")
    subprocess.run([sys.executable, "scripts/build_site.py"], check=True, capture_output=True)
    from scripts.check_site_browser import check
    problems = asyncio.run(check(Path("dist"), port=8772, channel=None if channel == "bundled" else channel))
    assert problems == [], problems
