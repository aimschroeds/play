"""
Grand Canyon Backcountry Permit Bot
====================================
Connects to an already-running Chrome browser (where you are logged into
recreation.gov), waits until 8:00 AM MST, then tries to add backcountry
permits to your cart for the configured weekends and campgrounds.

See config.py for all settings and the Chrome launch instructions.

Flow per weekend attempt
────────────────────────
1. Navigate (fresh) to the detailed-availability grid URL.
2. Wait for the grid to render.
3. Click the correct Starting Area (district) button.
4. Open the group-size counter and set it to NUM_PEOPLE.
5. Click the available date cell for Night 1.
6. Click the available date cell for Night 2 (grid stays open — no reload).
7. Click "Book Now" to start checkout.
8. Leave the browser open for the user to complete payment.
"""

import argparse
import asyncio
import random
import sys
from datetime import datetime, timedelta

import pytz
from playwright.async_api import async_playwright, Page, BrowserContext

from config import (
    CDP_ENDPOINT,
    PERMIT_URL,
    PERMIT_URL_TEMPLATE,
    LAUNCH_TZ,
    LAUNCH_HOUR,
    LAUNCH_MINUTE,
    LAUNCH_SECONDS_EARLY,
    NUM_PEOPLE,
    TARGET_WEEKENDS,
    CAMPGROUND_OPTIONS,
    DISTRICT_FOR_CAMPGROUND,
    DELAY_BETWEEN_ACTIONS,
    DELAY_AFTER_NAVIGATION,
    DELAY_BEFORE_RETRY,
    MAX_QUOTA_RETRIES,
    SELECTORS,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] {msg}", flush=True)


async def human_delay(bounds: tuple[float, float] = DELAY_BETWEEN_ACTIONS) -> None:
    """Sleep for a random duration within bounds to mimic human pacing."""
    await asyncio.sleep(random.uniform(*bounds))


async def human_click(page: Page, locator_or_element) -> None:
    """Move mouse to element then click, like a human would."""
    box = await locator_or_element.bounding_box()
    if box:
        x = box["x"] + box["width"] * random.uniform(0.3, 0.7)
        y = box["y"] + box["height"] * random.uniform(0.3, 0.7)
        await page.mouse.move(x, y, steps=random.randint(5, 15))
        await asyncio.sleep(random.uniform(0.05, 0.15))
    await locator_or_element.click()


def format_date_label(date_str: str) -> str:
    """
    Convert a YYYY-MM-DD string to the format used in cell aria-labels.
    e.g. "2026-06-26" → "June 26, 2026"   (no leading zero on the day)
    """
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return dt.strftime("%B %-d, %Y")


def seconds_until_launch() -> float:
    """
    Return how many seconds until LAUNCH_SECONDS_EARLY before 8:00 AM MST
    (or MDT — we use America/Denver to honour DST automatically).

    Checks today first; if today's window has already passed, waits for
    tomorrow.  Returns 0 if we are already inside the launch window.
    """
    tz = pytz.timezone(LAUNCH_TZ)
    now = datetime.now(tz)

    for day_offset in (0, 1):
        candidate_day = now.date() + timedelta(days=day_offset)
        target = tz.localize(
            datetime(candidate_day.year, candidate_day.month, candidate_day.day,
                     LAUNCH_HOUR, LAUNCH_MINUTE, 0)
        ) - timedelta(seconds=LAUNCH_SECONDS_EARLY)
        delta = (target - now).total_seconds()
        if delta > 0:
            return delta

    return 0.0   # already past both; run immediately


async def wait_until_launch_window(page: Page) -> None:
    """
    Sleep in big chunks until we are close to the launch time, then navigate
    to the permit page and burn the remaining seconds at the top of the queue.
    """
    secs = seconds_until_launch()
    if secs > 60:
        log(f"Sleeping {secs / 3600:.2f} h until pre-launch window …")
        while True:
            secs = seconds_until_launch()
            if secs <= 60:
                break
            await asyncio.sleep(min(secs - 60, 300))
            log(f"  {seconds_until_launch() / 60:.1f} min remaining …")

    # Pre-position on the permit page so we are ready to act at exactly 8:00
    log("Pre-positioning on permit page …")
    await page.goto(PERMIT_URL, wait_until="domcontentloaded")
    await human_delay(DELAY_AFTER_NAVIGATION)

    # Burn the last few seconds
    remaining = seconds_until_launch() + LAUNCH_SECONDS_EARLY  # time to actual 8:00
    if remaining > 0:
        log(f"Waiting {remaining:.1f} s until {LAUNCH_HOUR:02d}:{LAUNCH_MINUTE:02d}:00 …")
        await asyncio.sleep(remaining)

    log("=== LAUNCH — attempting permits now ===")


# ── Setup steps (run once per weekend attempt) ─────────────────────────────────

async def ensure_district(page: Page, campground_keyword: str) -> None:
    """
    Click the Starting Area (district) pill button that contains the campgrounds
    for `campground_keyword`, unless it is already selected.

    The district buttons look like:
        <button class="district-picker-button" aria-pressed="true">
          Classic GC Hike - via South Rim
        </button>
    """
    district = DISTRICT_FOR_CAMPGROUND.get(campground_keyword)
    if not district:
        log(f"  No district mapping for '{campground_keyword}' — skipping district click")
        return

    selector = SELECTORS["district_button_template"].format(district=district)
    log(f"  Ensuring district '{district}' is selected …")
    try:
        btn = page.locator(selector).first
        await btn.wait_for(state="visible", timeout=8000)
        pressed = await btn.get_attribute("aria-pressed")
        if pressed == "true":
            log("  District already selected.")
        else:
            await human_click(page, btn)
            await human_delay(DELAY_AFTER_NAVIGATION)
            log("  District button clicked.")
    except Exception as e:
        log(f"  Warning: could not click district button: {e}")


async def set_group_size(page: Page, n: int) -> None:
    """
    Open the group-size counter dropdown, adjust to n people, then close it.

    The popup structure (from observed DOM):
        [Guest counter button] → opens dialog
        Inside dialog:
            ⊖ button  |  count display  |  ⊕ button
            [Close]
    """
    log(f"  Setting group size to {n} …")
    try:
        # Open the counter dropdown
        counter_btn = page.locator(SELECTORS["guest_counter_button"]).first
        await counter_btn.wait_for(state="visible", timeout=8000)
        await human_click(page, counter_btn)
        await human_delay((0.5, 1.0))

        # Wait for the popup to appear — use .first to avoid strict-mode
        # violation (the DOM contains a second hidden empty clone of the dialog)
        popup = page.locator(SELECTORS["guest_counter_popup"]).first
        await popup.wait_for(state="visible", timeout=5000)

        # Read the current count from the number input inside the popup
        current = 0
        try:
            val = await popup.locator("#guest-counter-number-field-People").get_attribute("value")
            current = int(val) if val is not None and val.isdigit() else 0
            log(f"    Current count (from input): {current}")
        except Exception:
            log("    Could not read current count; assuming 0")

        # Click ⊕ or ⊖ to reach the target.
        # Buttons inside the popup (scoped to avoid the hidden clone):
        #   child(1) = ⊖  child(3) = ⊕  (matching .sarsa-button-subtle)
        delta = n - current
        if delta > 0:
            inc_btn = popup.locator(SELECTORS["guest_counter_increment"])
            for _ in range(delta):
                await human_click(page, inc_btn)
                await asyncio.sleep(random.uniform(0.2, 0.4))
        elif delta < 0:
            dec_btn = popup.locator(SELECTORS["guest_counter_decrement"])
            for _ in range(abs(delta)):
                await human_click(page, dec_btn)
                await asyncio.sleep(random.uniform(0.2, 0.4))

        # Close the popup
        close_btn = popup.locator(SELECTORS["guest_counter_close"])
        await human_click(page, close_btn)
        await human_delay((0.3, 0.7))
        log(f"    Group size set to {n}.")

    except Exception as e:
        log(f"  Warning: could not set group size: {e}")


# ── Core permit-selection flow ──────────────────────────────────────────────────

async def click_available_night(
    page: Page,
    night_label: str,
    date_str: str,
    campground_keyword: str,
) -> bool:
    """
    Find and click the available date-cell button for (campground_keyword, date_str).

    Cell buttons carry aria-labels like:
        "CBG - Bright Angel Campground on June 26, 2026 - Available"

    We match by the campground keyword (e.g. "Bright Angel") and the formatted
    date label (e.g. "June 26, 2026"), excluding LARGE GROUP sites.

    Returns True if the cell was found and clicked, False after MAX_QUOTA_RETRIES.
    """
    date_label = format_date_label(date_str)
    selector = SELECTORS["available_cell_button_template"].format(
        campground=campground_keyword,
        date_label=date_label,
    )
    log(f"  [{night_label}] Looking for '{campground_keyword}' on {date_label} …")

    for attempt in range(1, MAX_QUOTA_RETRIES + 1):
        try:
            btn = page.locator(selector).first
            is_vis = await btn.is_visible()
            if not is_vis:
                log(f"    Cell not visible yet (attempt {attempt}) — retrying …")
                await asyncio.sleep(DELAY_BEFORE_RETRY)
                continue

            is_enabled = await btn.is_enabled()
            if not is_enabled:
                log(f"    Cell disabled (attempt {attempt}) — retrying …")
                await asyncio.sleep(DELAY_BEFORE_RETRY)
                continue

            log(f"    Clicking cell: '{campground_keyword}' × {date_label}")
            await human_click(page, btn)
            await human_delay(DELAY_AFTER_NAVIGATION)
            log(f"    ✓ Night selected: {night_label}")
            return True

        except Exception as e:
            log(f"    Error on attempt {attempt}: {e}")
            await asyncio.sleep(DELAY_BEFORE_RETRY)

    log(f"  ✗ Could not select '{campground_keyword}' for {night_label} after {MAX_QUOTA_RETRIES} tries")
    return False


async def navigate_grid_to_date(page: Page, date_str: str) -> bool:
    """
    Ensure `date_str` (YYYY-MM-DD) is visible in the 4-day grid window.

    Key insight from observed DOM: after selecting Night 1 the grid may scroll
    to a different window.  Night 2 must be the consecutive night; we need to
    scroll forward (or backward) until the target date column is rendered.

    We detect visibility by checking whether ANY rec-availability-date button
    whose aria-label contains the formatted date exists in the DOM.  We click
    "Next 4 Days" (or "Prev") up to 20 times to reach it.

    Returns True if the date was found, False if we gave up.
    """
    date_label = format_date_label(date_str)
    # Any button for this date (regardless of availability status)
    any_cell_selector = f'button.rec-availability-date[aria-label*="{date_label}"]'

    log(f"  Navigating grid to show {date_label} …")
    for step in range(20):
        count = await page.locator(any_cell_selector).count()
        if count > 0:
            log(f"  Date {date_label} is now visible in grid (step {step}).")
            return True

        # Decide which direction to go by comparing target date to the first
        # visible date header in the grid.
        try:
            first_sr = await page.locator(
                '[aria-label="Availability by Site or Zone and Dates"] '
                '[role="columnheader"] .rec-sr-only'
            ).first.inner_text(timeout=2000)
            # "Monday, June 1, 2026" → parse and compare to target
            first_dt = datetime.strptime(first_sr.strip(), "%A, %B %d, %Y")
            target_dt = datetime.strptime(date_str, "%Y-%m-%d")
            go_next = target_dt >= first_dt
        except Exception:
            go_next = True  # default: go forward

        btn_key = "grid_next_button" if go_next else "grid_prev_button"
        try:
            nav_btn = page.locator(SELECTORS[btn_key]).first
            await nav_btn.wait_for(state="visible", timeout=5000)
            await human_click(page, nav_btn)
            await human_delay((0.6, 1.2))
        except Exception as e:
            log(f"  Could not click nav button: {e}")
            break

    log(f"  Warning: could not navigate grid to {date_label} after 20 steps")
    return False


async def click_book_now(page: Page) -> bool:
    """
    Click the "Book Now" button in the sticky bottom bar.
    The button is only enabled after at least one night has been selected.
    Returns True if clicked successfully.
    """
    log("  Clicking 'Book Now' …")
    try:
        btn = page.locator(SELECTORS["book_now_button"]).first
        await btn.wait_for(state="visible", timeout=8000)
        # Wait for it to become enabled (it starts disabled)
        for _ in range(20):
            if await btn.is_enabled():
                break
            await asyncio.sleep(0.3)
        await human_click(page, btn)
        await human_delay(DELAY_AFTER_NAVIGATION)
        log("  ✓ 'Book Now' clicked — checkout page should be loading")
        return True
    except Exception as e:
        log(f"  Warning: could not click 'Book Now': {e}")
        return False


async def try_weekend(
    page: Page,
    friday: str,
    saturday: str,
    campground_option: list[str],
) -> bool:
    """
    Attempt to book a two-night permit (Friday + Saturday) with the given
    campground preference pair.

    Steps:
      1. Navigate fresh to the detailed-availability grid.
      2. Click the correct Starting Area district button.
      3. Set the group size via the guest counter.
      4. Click Night 1 (Friday) cell.
      5. Click Night 2 (Saturday) cell.
      6. Click "Book Now".

    Returns True if all steps succeeded.
    """
    night1_camp, night2_camp = campground_option
    log(f"Trying {friday} / {saturday}  [{night1_camp} → {night2_camp}]")

    # Navigate fresh with date=<friday> so the grid opens with both Fri+Sat
    # already in the 4-day window — no scrolling needed to see Night 1.
    weekend_url = PERMIT_URL_TEMPLATE.format(date=friday)
    await page.goto(weekend_url, wait_until="domcontentloaded")
    await human_delay(DELAY_AFTER_NAVIGATION)

    # Wait for the grid to render
    try:
        await page.locator(SELECTORS["availability_grid"]).first.wait_for(
            state="visible", timeout=15000
        )
    except Exception:
        log("  Availability grid did not appear — page may still be loading")

    # ── Step 1: Select the correct Starting Area ───────────────────────────────
    # Night 1 determines which district we need (both nights should be same district
    # for the options in CAMPGROUND_OPTIONS, but we switch between cells on the same
    # page — the district picker filters which rows are shown).
    await ensure_district(page, night1_camp)

    # ── Step 2: Set group size ─────────────────────────────────────────────────
    await set_group_size(page, NUM_PEOPLE)

    # ── Step 3: Select Night 1 (Friday) ───────────────────────────────────────
    night1_ok = await click_available_night(
        page, f"Night 1 Fri {friday}", friday, night1_camp
    )
    if not night1_ok:
        return False

    # ── Step 4: Select Night 2 (Saturday) — no page reload needed ─────────────
    # After Night 1 is selected the grid may have shifted to a different date
    # window (observed: the grid sometimes scrolls away from the target date).
    # Navigate the grid so that Saturday's column is visible before clicking.
    await navigate_grid_to_date(page, saturday)

    # After Night 1, the grid shows ALL districts simultaneously, so we don't
    # need to switch the district picker for Night 2 (the site will be visible
    # regardless of which district pill is currently selected).

    night2_ok = await click_available_night(
        page, f"Night 2 Sat {saturday}", saturday, night2_camp
    )
    if not night2_ok:
        return False

    # ── Step 5: Book Now ───────────────────────────────────────────────────────
    booked = await click_book_now(page)
    return booked


# ── Main ───────────────────────────────────────────────────────────────────────

async def main(skip_timer: bool = False) -> None:
    async with async_playwright() as pw:
        log(f"Connecting to Chrome at {CDP_ENDPOINT} …")
        try:
            browser = await pw.chromium.connect_over_cdp(CDP_ENDPOINT)
        except Exception as e:
            log(f"ERROR: Could not connect to Chrome: {e}")
            log("Make sure Chrome is running with:  bash start_chrome.sh")
            sys.exit(1)

        # Reuse the existing context (inherits the logged-in session)
        contexts = browser.contexts
        if contexts:
            context: BrowserContext = contexts[0]
            log("Using existing browser context (your logged-in session)")
        else:
            context = await browser.new_context()
            log("Warning: no existing context found; you may not be logged in")

        pages = context.pages
        page: Page = pages[0] if pages else await context.new_page()

        # Wait until the launch window, pre-positioned on the permit page
        if skip_timer:
            log("--now flag set — skipping timer, running immediately")
        else:
            await wait_until_launch_window(page)

        # ── Try each weekend × campground combination ──────────────────────────
        success = False
        for friday, saturday in TARGET_WEEKENDS:
            for option in CAMPGROUND_OPTIONS:
                ok = await try_weekend(page, friday, saturday, option)
                if ok:
                    log(f"\n✓ SUCCESS — 'Book Now' clicked for {friday} / {saturday}")
                    log("  Complete checkout in the browser before the session expires!")
                    success = True
                    break
            if success:
                break

        if not success:
            log("\n✗ Could not book any permit combination.")
            log("  Permits may be sold out or selectors need updating.")
            log("  Check the browser window and complete any partial progress manually.")

        log("Bot finished. Browser left open for checkout.")
        # Do NOT close the browser — leave it for the user to complete payment


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Recreation.gov permit bot")
    parser.add_argument(
        "--now", action="store_true",
        help="Skip the 8 AM timer and run immediately"
    )
    args = parser.parse_args()
    asyncio.run(main(skip_timer=args.now))
