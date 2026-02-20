"""
Webhook server for Outdoor Status SMS → Yosemite permit auto-booking.

Flow
────
1. Outdoor Status texts your Twilio number when a permit opens.
2. Twilio POSTs the SMS body to this server's /sms endpoint.
3. We extract the outdoorstatus.com URL from the SMS, scrape it for
   every date/trailhead pair, and hand them all to book_from_alert().
4. book_from_alert() opens one browser tab per opening and races them;
   the winner sends you an alert SMS to complete checkout.

Setup (one-time)
────────────────
1. Set env vars — copy .env.example to .env, fill in values, then:
     source .env          (or add exports to ~/.zshrc)

2. Install deps:
     pip install flask twilio httpx beautifulsoup4

3. Install ngrok (if not already):
     brew install ngrok/ngrok/ngrok
     ngrok config add-authtoken <your-token>   # free at ngrok.com

4. Run everything:
     bash start_server.sh

5. Paste the printed ngrok URL (e.g. https://abc123.ngrok-free.app/sms)
   into the Twilio console:
     Phone Numbers → Manage → <your Twilio number>
     → Messaging → "A message comes in" → Webhook → HTTP POST

6. Update your Outdoor Status account to send alerts to your Twilio number
   instead of your personal phone.
"""

import asyncio
import logging
import os
import re
import threading
from datetime import datetime

import httpx
from bs4 import BeautifulSoup
from flask import Flask, abort, request
from twilio.request_validator import RequestValidator

from config import TRAILHEAD_MAP, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN

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


# ── Twilio webhook ─────────────────────────────────────────────────────────────

@app.route("/sms", methods=["POST"])
def handle_sms():
    # Validate the request is genuinely from Twilio (prevents spoofing)
    if TWILIO_AUTH_TOKEN:
        validator = RequestValidator(TWILIO_AUTH_TOKEN)
        if not validator.validate(
            request.url,
            request.form.to_dict(),
            request.headers.get("X-Twilio-Signature", ""),
        ):
            log.warning("Invalid Twilio signature — request rejected")
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
