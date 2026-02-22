"""
Webhook server for Outdoor Status → Yosemite permit auto-booking.

Flow
────
1. Outdoor Status texts your phone when a permit opens.
2. An iOS Shortcut forwards the SMS body to this server's /sms endpoint.
3. We extract the outdoorstatus.com URL, scrape it for every
   date/trailhead pair, and hand them all to book_from_alert().
4. book_from_alert() opens one browser tab per opening and races them;
   the winner posts a Slack notification so you can complete checkout.

Setup (one-time)
────────────────
1. Install deps:
     pip install flask httpx beautifulsoup4

2. Install ngrok (if not already):
     brew install ngrok/ngrok/ngrok
     ngrok config add-authtoken <your-token>

3. Run everything:
     op run --env-file .env.template -- bash start_server.sh

4. Set up an iOS Shortcut automation:
     Trigger: Message → contains "outdoorstatus"
     Action:  Get Contents of URL
       URL:    https://<ngrok-url>/sms
       Method: POST
       Headers: X-Webhook-Secret = <your secret>
       Body (Form): Body = [Message content]
"""

import asyncio
import logging
import os
import re
import threading
import time
from datetime import datetime

import httpx
from bs4 import BeautifulSoup
from flask import Flask, abort, request
from config import (
    CDP_ENDPOINT,
    KEEP_ALIVE_INTERVAL_MINUTES,
    PERMIT_URL,
    SLACK_WEBHOOK_URL,
    TRAILHEAD_MAP,
    WEBHOOK_SECRET,
)

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s")
log = app.logger


# ── SMS / URL helpers ──────────────────────────────────────────────────────────

def extract_url(text: str) -> str | None:
    """Pull the first https URL out of the SMS body."""
    m = re.search(r"https?://\S+", text)
    return m.group(0).rstrip(".,)") if m else None


# ── outdoorstatus.com scraper ──────────────────────────────────────────────────

def parse_date_text(text: str) -> str | None:
    """
    Parse a date string like 'Aug 5, 2026' or 'August 5, 2026' → '2026-08-05'.
    Returns None if parsing fails.
    """
    text = text.strip()
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%b %d %Y", "%B %d %Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def map_trailhead(raw: str) -> str | None:
    """
    Map an outdoorstatus.com trailhead name to its recreation.gov aria-label.

    Tries exact match first, then normalises arrows and retries, then falls
    back to a case-insensitive substring match.  Returns None if unmapped
    (caller logs a warning and skips the opening).
    """
    raw = raw.strip()
    # Exact match
    if raw in TRAILHEAD_MAP:
        return TRAILHEAD_MAP[raw]
    # Normalise arrow variants (→ / –> / ->) then retry
    normalised = raw.replace("→", "->").replace("–>", "->")
    if normalised in TRAILHEAD_MAP:
        return TRAILHEAD_MAP[normalised]
    # Substring match — e.g. "Lyell Canyon" matches "Lyell Canyon (Donohue…)"
    lower = normalised.lower()
    for key, val in TRAILHEAD_MAP.items():
        if lower in key.lower() or key.lower() in lower:
            return val
    return None


def scrape_openings(url: str) -> list[dict]:
    """
    Fetch an outdoorstatus.com alert page and return every opening as:
        {"date": "2026-08-05",
         "trailhead": "Happy Isles->Past LYV (Donohue Pass Eligible)"}

    The page structure was reverse-engineered from the screenshot; if
    outdoorstatus.com changes its layout, update the selectors below.

    Strategy
    ────────
    Rather than relying on brittle CSS classes, we:
      1. Find all date-like strings on the page ("Aug 5, 2026").
      2. For each date, walk nearby text nodes to find a trailhead name.
      3. Map the trailhead name through TRAILHEAD_MAP.
    This is intentionally broad so it catches both the primary opening
    and any "Other openings" listed further down the page.
    """
    resp = httpx.get(url, follow_redirects=True, timeout=15,
                     headers={"User-Agent": "Mozilla/5.0 (compatible; permit-bot/1.0)"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove script/style noise
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    openings: list[dict] = []
    seen: set[tuple] = set()

    # ── Strategy 1: look for labelled fields ──────────────────────────────────
    # The page appears to show fields like:
    #   "Start date"  →  "Aug 5, 2026"
    #   "Trailhead"   →  "Happy Isles → Past LYV"
    # Try to find them as label/value pairs in the DOM.
    date_re = re.compile(
        r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
        r"\s+\d{1,2},?\s+20\d{2}\b",
        re.IGNORECASE,
    )

    for date_node in soup.find_all(string=date_re):
        date_match = date_re.search(date_node)
        if not date_match:
            continue
        date_parsed = parse_date_text(date_match.group(0))
        if not date_parsed:
            continue

        # Walk sibling and parent text to find a trailhead name near this date.
        # The trailhead is usually within the same card/container.
        container = date_node.parent
        for _ in range(4):  # walk up at most 4 levels
            if container is None:
                break
            text_block = container.get_text(" ", strip=True)
            # Look for "Trailhead" label followed by a name
            trail_m = re.search(
                r"[Tt]railhead\s*[:\-]?\s*([A-Za-z\s\->→–]+?)(?:\s*[-–]|\s*\d+\s*opening|\s*$)",
                text_block,
            )
            if trail_m:
                raw_trail = trail_m.group(1).strip().rstrip("-–>→ ")
                mapped = map_trailhead(raw_trail)
                if mapped and (date_parsed, mapped) not in seen:
                    seen.add((date_parsed, mapped))
                    openings.append({"date": date_parsed, "trailhead": mapped})
                break
            container = container.parent

    # ── Strategy 2: parse "Other openings" inline text ────────────────────────
    # Typical format: "Aug 6, 2026 for Lyell Canyon - 10 openings"
    for node in soup.find_all(string=re.compile(r"[Oo]ther opening")):
        block = node.parent.get_text(" ", strip=True) if node.parent else ""
        for chunk in re.split(r"[•·\n]+", block):
            date_m = date_re.search(chunk)
            if not date_m:
                continue
            date_parsed = parse_date_text(date_m.group(0))
            if not date_parsed:
                continue
            # "… for <TrailheadName> - N openings"
            for_m = re.search(r"\bfor\s+([A-Za-z\s\->→–]+?)(?:\s*[-–]\s*\d|\s*$)", chunk)
            if for_m:
                raw_trail = for_m.group(1).strip().rstrip("-–>→ ")
                mapped = map_trailhead(raw_trail)
                if mapped and (date_parsed, mapped) not in seen:
                    seen.add((date_parsed, mapped))
                    openings.append({"date": date_parsed, "trailhead": mapped})

    if not openings:
        log.warning(
            "Could not parse any openings from %s — "
            "page structure may have changed. Full text:\n%s",
            url,
            soup.get_text(" ", strip=True)[:2000],
        )

    return openings


# ── Slack notification helper ─────────────────────────────────────────────────

def notify_slack(msg: str) -> None:
    """Post a message to the configured Slack incoming webhook."""
    if not SLACK_WEBHOOK_URL:
        log.warning("Slack webhook not configured — cannot send: %s", msg)
        return
    try:
        httpx.post(SLACK_WEBHOOK_URL, json={"text": msg}, timeout=10)
    except Exception as e:
        log.error("Slack notification failed: %s", e)


# ── Recreation.gov session keep-alive ─────────────────────────────────────────

async def _keep_alive_once() -> None:
    """
    Connect to Chrome via CDP, load the permit page, and check we're still
    logged in.  Alerts via Slack if the session is expired or Chrome is down.
    """
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(CDP_ENDPOINT)
        contexts = browser.contexts
        if not contexts:
            notify_slack(
                "⚠️ Yosemite bot: Chrome has no browser context. "
                "Open Chrome and log into recreation.gov."
            )
            return

        context = contexts[0]
        page = context.pages[0] if context.pages else await context.new_page()

        await page.goto(PERMIT_URL, wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)

        # recreation.gov shows a "Log In" nav link when signed out
        login_link = page.locator('a[href*="/login"], button:has-text("Log In")')
        if await login_link.count() > 0:
            notify_slack(
                "⚠️ Yosemite bot: recreation.gov session expired! "
                "Open Chrome and log back in."
            )
            log.warning("Keep-alive: session expired — Slack alert sent")
        else:
            log.info("Keep-alive: session OK")


async def _keep_alive_with_timeout() -> None:
    """Run _keep_alive_once with a 60-second timeout to prevent hangs."""
    await asyncio.wait_for(_keep_alive_once(), timeout=60)


def _keep_alive_loop() -> None:
    """Run _keep_alive_once() on a fixed interval. Runs in a daemon thread."""
    interval = KEEP_ALIVE_INTERVAL_MINUTES * 60
    while True:
        time.sleep(interval)
        try:
            asyncio.run(_keep_alive_with_timeout())
        except Exception as e:
            log.error("Keep-alive failed: %s", e)
            notify_slack(
                f"⚠️ Yosemite bot: keep-alive check failed — {e}. "
                "Is Chrome running with start_chrome.sh?"
            )


# Start the keep-alive thread on import (server startup)
threading.Thread(target=_keep_alive_loop, daemon=True, name="keep-alive").start()


# ── SMS webhook (iOS Shortcut → ngrok → here) ────────────────────────────────

@app.route("/sms", methods=["POST"])
def handle_sms():
    # Validate shared secret (prevents random hits on the public ngrok URL)
    if WEBHOOK_SECRET:
        if request.headers.get("X-Webhook-Secret") != WEBHOOK_SECRET:
            log.warning("Invalid or missing webhook secret — request rejected")
            abort(403)

    body = request.form.get("Body", "")
    log.info("SMS received: %r", body[:200])

    # Only act on Outdoor Status permit alerts
    if "Yosemite" not in body and "outdoorstatus" not in body.lower():
        log.info("Not a Yosemite alert — ignoring")
        return ("", 204)

    alert_url = extract_url(body)
    if not alert_url:
        log.warning("No URL found in SMS body")
        return ("", 204)

    try:
        openings = scrape_openings(alert_url)
    except Exception as exc:
        log.error("Failed to scrape %s: %s", alert_url, exc)
        return ("", 204)

    if not openings:
        log.warning("No mappable openings found on the alert page")
        return ("", 204)

    log.info("Triggering booking for %d opening(s): %s", len(openings), openings)

    # Run the async booking flow in a background thread (Flask is sync)
    threading.Thread(
        target=lambda: asyncio.run(_run_booking(openings)),
        daemon=True,
        name="booking",
    ).start()

    return ("", 204)


async def _run_booking(openings: list[dict]) -> None:
    from bot import book_from_alert
    await book_from_alert(openings)


# ── Dev helper: simulate an alert without a real SMS ──────────────────────────

@app.route("/test", methods=["GET"])
def test_booking():
    """
    GET /test?url=https://outdoorstatus.com/...
    Fetch that page, parse openings, and trigger the booking flow.
    Useful for testing without waiting for a real Outdoor Status alert.
    """
    url = request.args.get("url")
    if not url:
        return ("Pass ?url=<outdoorstatus-alert-url>", 400)
    try:
        openings = scrape_openings(url)
    except Exception as exc:
        return (f"Scrape failed: {exc}", 500)
    if not openings:
        return ("No openings found", 200)
    threading.Thread(
        target=lambda: asyncio.run(_run_booking(openings)),
        daemon=True,
        name="booking-test",
    ).start()
    return (f"Triggered booking for: {openings}", 200)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="127.0.0.1", port=port, debug=False)
