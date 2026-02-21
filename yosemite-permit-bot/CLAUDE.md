# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Automated bot for booking Yosemite wilderness permits from recreation.gov. Two modes:
1. **Standard**: Waits for 9 AM PT release window, scans availability grid, books first available permit
2. **Alert-triggered**: Receives SMS alerts from Outdoor Status via Twilio webhook, races multiple openings in parallel

## Running

```bash
# Start Chrome with remote debugging (log in to recreation.gov manually)
bash start_chrome.sh

# Run bot (waits until 9 AM PT, then scans and books)
op run --env-file .env.template -- python bot.py
op run --env-file .env.template -- python bot.py --now         # skip timer
op run --env-file .env.template -- python bot.py --date YYYY-MM-DD

# Run webhook server (for alert-triggered bookings)
op run --env-file .env.template -- bash start_server.sh
```

## Setup

```bash
pip install -r requirements.txt
brew install 1password-cli
brew install ngrok/ngrok/ngrok
ngrok config add-authtoken <token>
```

Secrets are stored in 1Password (vault: "Development", item: "twilio-yosemite-bot") and injected at runtime via `op run --env-file .env.template`. No `.env` file needed.

## Architecture

All code lives in the root directory — no nested packages.

- **`bot.py`** — Core booking automation. Connects to Chrome via CDP (`localhost:9222`), uses Playwright async API for all browser interaction. `main()` is the standard workflow entry point; `book_from_alert(openings)` is the parallel-race entry point called by the server.
- **`server.py`** — Flask webhook server. `POST /sms` receives Twilio webhooks, scrapes the Outdoor Status alert page for permit details, then spawns async booking in a background thread. `GET /test?url=` simulates alerts for dev testing.
- **`config.py`** — All configuration: permit targeting (dates, trailheads, group size), timing constants, recreation.gov CSS/ARIA selectors, and the `TRAILHEAD_MAP` that translates Outdoor Status names to recreation.gov aria-labels.
- **`start_chrome.sh`** — Launches Chrome with `--remote-debugging-port=9222` and a persistent profile at `~/.chrome-recgov-debug`.
- **`start_server.sh`** — Starts Flask + ngrok tunnel, validates env vars, prints webhook URL.

## Key Patterns

- **Async-first**: All browser interaction uses `asyncio` + Playwright async. The Flask server bridges sync→async via background threads.
- **Human-like behavior**: `human_delay()` and `human_click()` add randomized timing and mouse movement to avoid bot detection.
- **Parallel racing** (alert mode): Opens one browser tab per opening, races concurrently via `asyncio`. First tab to reach checkout sets a shared `asyncio.Event`; others abandon.
- **Calendar picker navigation**: `set_date_via_picker()` uses month/year dropdowns (~6 clicks) instead of Next button (~33 clicks) for fast date jumping.
- **Bot stops at "Book Now"**: Intentionally does not complete payment — user finishes checkout manually to keep session valid.
- **Timezone handling**: All scheduling uses `pytz` with `America/Los_Angeles` for DST-aware 9 AM PT targeting.

## Config Knobs (config.py)

Key values to adjust per trip: `START_DATE`, `NUM_PEOPLE`, `TRAILHEAD_PRIORITY`, `MAX_DATE_WINDOWS`. DOM selectors are also here and will need updating if recreation.gov changes their markup.

## Secrets (`.env.template`)

Managed via 1Password. The `.env.template` contains `op://` secret references resolved at runtime by `op run`. Fields: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `ALERT_PHONE`, optional `NGROK_URL`.
