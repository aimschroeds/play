"""
Yosemite Wilderness Permit Bot
================================
Connects to an already-running Chrome browser (where you are logged into
recreation.gov), waits until 9:00 AM PT, then scans the availability grid
for the first open date at one of the priority trailheads and books it.

See config.py for all settings and the Chrome launch instructions.

Flow
────
1. Wait until 9:00 AM PT (or run immediately with --now).
2. Reload the permit page — cells are NR (Not Released) until 9 AM, so a
   hard reload is required to reveal the newly-available slots.
3. Use the calendar date picker to jump to START_DATE in ~6 clicks (much
   faster than clicking "Next 5 Days" ~33 times from today).
4. Set group size to NUM_PEOPLE.
5. Scan up to MAX_DATE_WINDOWS × 5-day windows:
   a. For each trailhead in TRAILHEAD_PRIORITY:
      - Find the trailhead's row in the grid.
      - Look for an available (green) cell in that row.
      - If found: click it and proceed to Book Now.
   b. If nothing found in this window, click "Next 5 Days" and repeat.
6. Click "Book Now" to start checkout.
7. Leave the browser open for the user to complete payment.
"""

import argparse
import asyncio
import re
import random
import sys
from datetime import datetime, timedelta

import pytz
from playwright.async_api import async_playwright, Page, BrowserContext

from config import (
    CDP_ENDPOINT,
    PERMIT_URL,
    PERMIT_URL_TEMPLATE,
    START_DATE,
    LAUNCH_TZ,
    LAUNCH_HOUR,
    LAUNCH_MINUTE,
    LAUNCH_SECONDS_EARLY,
    NUM_PEOPLE,
    TRAILHEAD_PRIORITY,
    MAX_DATE_WINDOWS,
    DELAY_BETWEEN_ACTIONS,
    DELAY_AFTER_NAVIGATION,
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


def seconds_until_launch() -> float:
    """
    Return how many seconds until LAUNCH_SECONDS_EARLY before 9:00 AM PT.
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
    Sleep until just before 9 AM PT, load the permit page while idle, then
    fire.  We do NOT pre-navigate the date grid here — cells are NR (Not
    Released) until 9 AM anyway, so a full page reload is required at launch.
    scan_and_book() handles the reload + fast date-picker jump at 9 AM.
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

    # Load the permit page now so we are already authenticated and on-site.
    # We will reload it at 9 AM sharp to get fresh permit availability.
    log("Pre-loading permit page (idle until launch) …")
    await page.goto(PERMIT_URL, wait_until="domcontentloaded")
    await human_delay(DELAY_AFTER_NAVIGATION)

    # Burn the last few seconds
    remaining = seconds_until_launch() + LAUNCH_SECONDS_EARLY  # time to actual 9:00
    if remaining > 0:
        log(f"Waiting {remaining:.1f} s until {LAUNCH_HOUR:02d}:{LAUNCH_MINUTE:02d}:00 …")
        await asyncio.sleep(remaining)

    log("=== LAUNCH — attempting permits now ===")


# ── Setup steps ────────────────────────────────────────────────────────────────

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

        # Wait for the increment button to appear — confirms popup is open
        inc_btn = page.locator(SELECTORS["guest_counter_increment"]).first
        await inc_btn.wait_for(state="visible", timeout=5000)

        # Read the current count from the number input
        current = 0
        try:
            val = await page.locator("#guest-counter-number-field-People").first.get_attribute("value")
            current = int(val) if val is not None and val.isdigit() else 0
            log(f"    Current count (from input): {current}")
        except Exception:
            log("    Could not read current count; assuming 0")

        # Click ⊕ or ⊖ to reach the target
        delta = n - current
        if delta > 0:
            for _ in range(delta):
                await human_click(page, inc_btn)
                await asyncio.sleep(random.uniform(0.2, 0.4))
        elif delta < 0:
            dec_btn = page.locator(SELECTORS["guest_counter_decrement"]).first
            for _ in range(abs(delta)):
                await human_click(page, dec_btn)
                await asyncio.sleep(random.uniform(0.2, 0.4))

        # Close the popup
        close_btn = page.locator(SELECTORS["guest_counter_close"]).first
        await human_click(page, close_btn)
        await human_delay((0.3, 0.7))
        log(f"    Group size set to {n}.")

    except Exception as e:
        log(f"  Warning: could not set group size: {e}")


# ── Core permit-selection flow ──────────────────────────────────────────────────

async def set_date_via_picker(page: Page, date_str: str) -> bool:
    """
    Jump the availability grid to date_str (YYYY-MM-DD) using the calendar
    date picker — much faster than clicking "Next 5 Days" ~33 times.

    Steps:
    1. Click the date input to open the calendar popup.
    2. Navigate months (< / >) until the target month/year is shown.
       Each click is ~0.15 s — reaching Aug 2026 from Feb 2026 takes ~6 clicks.
    3. Click the target day button (exact match to avoid "1" hitting "10"/"21").
    4. Wait briefly for the grid to re-render.
    """
    target_dt = datetime.strptime(date_str, "%Y-%m-%d")
    log(f"  Opening date picker → {target_dt.strftime('%B %Y')}, day {target_dt.day} …")
    try:
        date_input = page.locator(SELECTORS["date_input"]).first
        await date_input.wait_for(state="visible", timeout=8000)
        await date_input.click()
        await asyncio.sleep(0.3)

        # Navigate months until we reach the target month/year
        for _ in range(24):
            header_el = page.locator(SELECTORS["date_picker_month_header"]).first
            header_text = (await header_el.inner_text(timeout=2000)).strip()
            try:
                cur_dt = datetime.strptime(header_text, "%B %Y")
            except ValueError:
                log(f"    Unexpected calendar header text: '{header_text}'")
                break

            if cur_dt.year == target_dt.year and cur_dt.month == target_dt.month:
                break

            go_next = (cur_dt.year, cur_dt.month) < (target_dt.year, target_dt.month)
            btn_key = "date_picker_next_month" if go_next else "date_picker_prev_month"
            await page.locator(SELECTORS[btn_key]).first.click()
            await asyncio.sleep(0.15)  # calendar re-renders fast; keep it tight

        # Click the exact day — use regex to avoid "1" matching "10", "21", etc.
        day_btn = page.locator(SELECTORS["date_picker_day"]).filter(
            has_text=re.compile(rf"^\s*{target_dt.day}\s*$")
        ).first
        await day_btn.wait_for(state="visible", timeout=3000)
        await day_btn.click()
        await asyncio.sleep(0.4)  # wait for grid to re-render with new date window
        log(f"  ✓ Date picker set to {date_str}")
        return True

    except Exception as e:
        log(f"  Warning: date picker navigation failed: {e}")
        return False


async def find_available_cell_in_window(page: Page, trailhead: str):
    """
    Search the current 5-day grid window for an available cell in the
    given trailhead's row.

    Yosemite's grid row structure:
        <div role="row">
          <button aria-label="Lyell Canyon (Donohue Pass Eligible)">…</button>
          <!-- date cells -->
          <div class="rec-grid-grid-cell available">
            <button class="rec-availability-date" …>SAT 1\\nPeople: 4 out of 15</button>
          </div>
        </div>

    Returns the cell button locator if found and visible, None otherwise.
    """
    row_selector = SELECTORS["trailhead_row_template"].format(trailhead=trailhead)
    cell_selector = SELECTORS["available_cell_in_row"]

    try:
        row = page.locator(row_selector).first
        row_count = await row.count()
        if row_count == 0:
            log(f"    Row not found for trailhead: '{trailhead}'")
            return None

        cell = row.locator(cell_selector).first
        cell_count = await cell.count()
        if cell_count == 0:
            return None

        is_visible = await cell.is_visible()
        if not is_visible:
            return None

        return cell

    except Exception as e:
        log(f"    Error scanning trailhead '{trailhead}': {e}")
        return None


async def click_book_now(page: Page) -> bool:
    """
    Click the "Book Now" button in the sticky bottom bar.
    The button is only enabled after at least one date has been selected.
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


async def scan_and_book(page: Page) -> bool:
    """
    Reload the permit page (to reveal cells that just flipped from NR→Available
    at 9 AM), jump to START_DATE via the calendar picker, set group size, then
    scan up to MAX_DATE_WINDOWS 5-day windows for an available permit.

    Returns True if a cell was clicked and "Book Now" was hit successfully.
    """
    # ── Reload to get fresh 9 AM availability ─────────────────────────────────
    # Cells show as "Not Released" until 9 AM.  A reload is required to see them
    # flip to Available — a stale pre-loaded page won't show them.
    if "445859" in page.url:
        log("Reloading permit page to reveal newly-released permits …")
        await page.reload(wait_until="domcontentloaded")
    else:
        log(f"Navigating to permit page: {PERMIT_URL}")
        await page.goto(PERMIT_URL, wait_until="domcontentloaded")

    log("Waiting for availability grid …")
    try:
        await page.locator(SELECTORS["availability_grid"]).first.wait_for(
            state="visible", timeout=20000
        )
        log("  Grid is visible.")
    except Exception:
        log("  Warning: availability grid did not appear in time — continuing anyway")

    # ── Jump to target date via calendar picker (fast: ~6 clicks) ─────────────
    await set_date_via_picker(page, START_DATE)

    # ── Set group size ─────────────────────────────────────────────────────────
    await set_group_size(page, NUM_PEOPLE)
    await asyncio.sleep(0.5)  # brief settle — keep it tight

    clicked_cell = False

    for window_idx in range(MAX_DATE_WINDOWS):
        log(f"Scanning date window {window_idx + 1} of {MAX_DATE_WINDOWS} …")

        for trailhead in TRAILHEAD_PRIORITY:
            log(f"  Checking trailhead: '{trailhead}' …")
            cell = await find_available_cell_in_window(page, trailhead)
            if cell is not None:
                try:
                    label = await cell.get_attribute("aria-label") or "(unknown date)"
                except Exception:
                    label = "(unknown date)"
                log(f"  ✓ Available cell found — trailhead='{trailhead}', cell='{label}'")
                await human_click(page, cell)
                await asyncio.sleep(0.4)  # brief settle before Book Now
                clicked_cell = True
                break

        if clicked_cell:
            break

        # No availability in this window — advance to next 5-day window
        if window_idx < MAX_DATE_WINDOWS - 1:
            log("  No availability in this window — advancing to next 5 days …")
            try:
                next_btn = page.locator(SELECTORS["grid_next_button"]).first
                await next_btn.wait_for(state="visible", timeout=5000)
                await human_click(page, next_btn)
                await asyncio.sleep(0.5)
            except Exception as e:
                log(f"  Warning: could not click 'Next' button: {e}")
                break

    if not clicked_cell:
        log("✗ No available permit found in the scanned date windows.")
        return False

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

        # Wait until the launch window (or skip if --now)
        if skip_timer:
            log("--now flag set — skipping timer, running immediately")
        else:
            await wait_until_launch_window(page)

        # Run the scan-and-book flow
        success = await scan_and_book(page)

        if success:
            log("\n✓ SUCCESS — 'Book Now' clicked!")
            log("  Complete checkout in the browser before the session expires!")
        else:
            log("\n✗ Could not book a permit.")
            log("  Permits may be sold out or selectors need updating.")
            log("  Check the browser window and complete any partial progress manually.")

        log("Bot finished. Browser left open for checkout.")
        # Do NOT close the browser — leave it for the user to complete payment


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Recreation.gov Yosemite permit bot")
    parser.add_argument(
        "--now", action="store_true",
        help="Skip the 9 AM timer and run immediately"
    )
    args = parser.parse_args()
    asyncio.run(main(skip_timer=args.now))
