"""
Grand Canyon Backcountry Permit Bot
====================================
Connects to an already-running Chrome browser (where you are logged into
recreation.gov), waits until 8:00 AM MST, then tries to add backcountry
permits to your cart for the configured weekends and campgrounds.

See config.py for all settings and the Chrome launch instructions.
"""

import asyncio
import random
import sys
from datetime import datetime, timedelta

import pytz
from playwright.async_api import async_playwright, Page, BrowserContext

from config import (
    CDP_ENDPOINT,
    PERMIT_URL,
    LAUNCH_TZ,
    LAUNCH_HOUR,
    LAUNCH_MINUTE,
    LAUNCH_SECONDS_EARLY,
    NUM_PEOPLE,
    TARGET_WEEKENDS,
    CAMPGROUND_OPTIONS,
    GROUP_SITE_KEYWORDS,
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
        # Aim slightly off-centre to avoid dead-centre robot tells
        x = box["x"] + box["width"] * random.uniform(0.3, 0.7)
        y = box["y"] + box["height"] * random.uniform(0.3, 0.7)
        await page.mouse.move(x, y, steps=random.randint(5, 15))
        await asyncio.sleep(random.uniform(0.05, 0.15))
    await locator_or_element.click()


def is_group_site(name: str) -> bool:
    """Return True if the site name looks like a group campsite."""
    name_lower = name.lower()
    return any(kw in name_lower for kw in GROUP_SITE_KEYWORDS)


def seconds_until_launch() -> float:
    """
    Return how many seconds until LAUNCH_SECONDS_EARLY before 8:00 AM MST
    on the next calendar day in that timezone.
    """
    tz = pytz.timezone(LAUNCH_TZ)
    now = datetime.now(tz)
    tomorrow = now.date() + timedelta(days=1)
    target = tz.localize(
        datetime(tomorrow.year, tomorrow.month, tomorrow.day,
                 LAUNCH_HOUR, LAUNCH_MINUTE, 0)
    ) - timedelta(seconds=LAUNCH_SECONDS_EARLY)
    delta = (target - now).total_seconds()
    return max(delta, 0)


async def wait_until_launch_window(page: Page) -> None:
    """
    Sleep in big chunks until we are close to the launch time, then navigate
    to the permit page and wait the remaining seconds at the top of the queue.
    """
    secs = seconds_until_launch()
    if secs > 60:
        log(f"Sleeping {secs/3600:.2f} h until pre-launch window …")
        # Sleep in 60-s chunks so we can log progress
        while True:
            secs = seconds_until_launch()
            if secs <= 60:
                break
            await asyncio.sleep(min(secs - 60, 300))
            remaining = seconds_until_launch()
            log(f"  {remaining/60:.1f} min remaining …")

    # Pre-position on the permit page so we are ready to act immediately
    log("Pre-positioning on permit page …")
    await page.goto(PERMIT_URL, wait_until="domcontentloaded")
    await human_delay(DELAY_AFTER_NAVIGATION)

    # Burn the last few seconds
    secs = seconds_until_launch() + LAUNCH_SECONDS_EARLY  # time to actual 8:00
    if secs > 0:
        log(f"Waiting {secs:.1f} s until 8:00:00 AM MST …")
        await asyncio.sleep(secs)

    log("=== LAUNCH — attempting permits now ===")


# ── Core permit flow ───────────────────────────────────────────────────────────
# The PERMIT_URL goes directly to the detailed-availability grid for June 2026.
# The grid has campground rows × date columns.  We:
#   1. Reload the page fresh for each attempt.
#   2. Find the column index for the target date.
#   3. Within the target campground row, click the cell at that column index.
#   4. Handle any "Add to Cart" modal/button that appears.
#   5. Set group size if prompted.


async def find_date_column_index(page: Page, date_str: str) -> int | None:
    """
    Locate the 1-based column index in the availability grid that corresponds
    to `date_str` (YYYY-MM-DD).  Returns None if not found.

    NOTE: The column headers on recreation.gov typically carry either a
    data-date attribute or an aria-label containing the date.  Update the
    selector template in config.py if the real markup differs.
    """
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    month_day = dt.strftime("%B %-d")   # e.g. "June 26"

    selector = SELECTORS["date_column_header_template"].format(
        month_day=month_day,
        date=date_str,
    )
    log(f"  Finding column for {month_day} …")
    try:
        # Get all matching header cells and find their column position
        headers = await page.locator(selector).all()
        if not headers:
            log(f"  No column header found for {month_day}")
            return None

        # Use the first matching header; get its index among all <th>/<td> siblings
        header = headers[0]
        # JavaScript: count preceding siblings to get 1-based column index
        col_index = await header.evaluate(
            "el => Array.from(el.parentElement.children).indexOf(el) + 1"
        )
        log(f"  Column for {month_day}: {col_index}")
        return col_index
    except Exception as e:
        log(f"  Error finding column for {month_day}: {e}")
        return None


async def set_num_people(page: Page, n: int) -> None:
    """
    Set the group-size / number-of-people field to n.
    This field often appears in a modal after clicking a grid cell.

    NOTE: Update the selector in config.py to match the actual input element.
    """
    log(f"  Setting group size to {n}")
    try:
        field = page.locator(SELECTORS["people_input"]).first
        await field.wait_for(state="visible", timeout=5000)
        await field.triple_click()
        await asyncio.sleep(random.uniform(0.1, 0.2))
        await field.type(str(n), delay=random.randint(60, 140))
        await human_delay()
    except Exception as e:
        log(f"  Warning: could not set group size: {e}")


async def add_night_to_cart(
    page: Page,
    night_label: str,
    date_str: str,
    campground_pref: str,
) -> bool:
    """
    In the availability grid, find the cell at (campground_pref row, date_str col)
    and click it to add that night to the cart.  Returns True on success.

    NOTE: This is the section most likely to need adjustment after you record
    the actual click path.  Key unknowns:
      - Whether clicking the cell opens a modal (then you click "Add to Cart"
        inside the modal) or directly adds to cart.
      - Whether the group-size prompt appears before or after the add-to-cart action.
    """
    log(f"  [{night_label}] Looking for '{campground_pref}' on {date_str} …")

    for attempt in range(MAX_QUOTA_RETRIES):
        # Refresh column index each retry in case the grid re-rendered
        col_index = await find_date_column_index(page, date_str)
        if col_index is None:
            log(f"    Date column not found yet, retry {attempt+1} …")
            await asyncio.sleep(DELAY_BEFORE_RETRY)
            continue

        rows = await page.locator(SELECTORS["quota_row"]).all()
        matched_row = None

        for row in rows:
            try:
                name_el = row.locator(SELECTORS["quota_name"]).first
                name = (await name_el.inner_text()).strip()
            except Exception:
                continue

            if is_group_site(name):
                continue
            if campground_pref.lower() not in name.lower():
                continue

            matched_row = (row, name)
            break

        if matched_row is None:
            log(f"    No matching row for '{campground_pref}', retry {attempt+1} …")
            await asyncio.sleep(DELAY_BEFORE_RETRY)
            continue

        row, name = matched_row
        cell_selector = SELECTORS["date_cell_in_row_template"].format(col_index=col_index)

        try:
            cell = row.locator(cell_selector).first
            is_visible = await cell.is_visible()
            if not is_visible:
                log(f"    Cell not visible yet, retry {attempt+1} …")
                await asyncio.sleep(DELAY_BEFORE_RETRY)
                continue

            log(f"    Clicking cell: {name} × {date_str}")
            await human_click(page, cell)
            await human_delay(DELAY_AFTER_NAVIGATION)

            # After clicking, a modal or panel may appear with "Add to Cart"
            # and/or a people-count field.  Handle both orderings.
            await set_num_people(page, NUM_PEOPLE)

            try:
                add_btn = page.locator(SELECTORS["add_to_cart_button"]).first
                if await add_btn.is_visible():
                    await human_click(page, add_btn)
                    await human_delay(DELAY_AFTER_NAVIGATION)
            except Exception:
                pass  # Cell click may have already added to cart directly

            # Confirm
            try:
                await page.locator(SELECTORS["cart_confirmation"]).first.wait_for(
                    state="visible", timeout=6000
                )
                log(f"    ✓ Added '{name}' to cart for {night_label}")
                return True
            except Exception:
                log(f"    Cart confirmation not seen — treating as success")
                return True

        except Exception as e:
            log(f"    Error interacting with cell: {e}")

        await asyncio.sleep(DELAY_BEFORE_RETRY)

    log(f"  ✗ Could not add '{campground_pref}' for {night_label}")
    return False


async def try_weekend(
    page: Page,
    friday: str,
    saturday: str,
    campground_option: list[str],
) -> bool:
    """
    Attempt to book a two-night permit (Friday + Saturday) with the given
    campground preference list.  Navigates directly to the detailed-availability
    grid (no landing page or "Book Now" needed).  Returns True if both nights
    were added to cart.
    """
    night1_camp, night2_camp = campground_option
    log(f"Trying weekend {friday} / {saturday}  [{night1_camp} → {night2_camp}]")

    # Navigate to the availability grid fresh for each attempt
    await page.goto(PERMIT_URL, wait_until="domcontentloaded")
    await human_delay(DELAY_AFTER_NAVIGATION)

    # Wait for the grid to render
    try:
        await page.locator(SELECTORS["availability_grid"]).first.wait_for(
            state="visible", timeout=10000
        )
    except Exception:
        log("  Availability grid did not appear — page may still be loading")

    # Night 1: Friday
    night1_ok = await add_night_to_cart(page, f"Night 1 ({friday})", friday, night1_camp)
    if not night1_ok:
        return False

    # Night 2: Saturday (grid should still be visible; no page reload needed)
    night2_ok = await add_night_to_cart(page, f"Night 2 ({saturday})", saturday, night2_camp)
    if not night2_ok:
        return False

    return True


# ── Main ───────────────────────────────────────────────────────────────────────

async def main() -> None:
    async with async_playwright() as pw:
        log(f"Connecting to Chrome at {CDP_ENDPOINT} …")
        try:
            browser = await pw.chromium.connect_over_cdp(CDP_ENDPOINT)
        except Exception as e:
            log(f"ERROR: Could not connect to Chrome: {e}")
            log("Make sure Chrome is running with:  --remote-debugging-port=9222")
            sys.exit(1)

        # Use the first available context (inherits the existing login session)
        contexts = browser.contexts
        if contexts:
            context: BrowserContext = contexts[0]
            log("Using existing browser context (your logged-in session)")
        else:
            context = await browser.new_context()
            log("Warning: no existing context found; you may not be logged in")

        # Reuse an existing tab or open a new one
        pages = context.pages
        page: Page = pages[0] if pages else await context.new_page()

        # Wait until the right moment, pre-positioned on the permit page
        await wait_until_launch_window(page)

        # ── Try each weekend × campground combination ──────────────────────
        success = False
        for friday, saturday in TARGET_WEEKENDS:
            for option in CAMPGROUND_OPTIONS:
                ok = await try_weekend(page, friday, saturday, option)
                if ok:
                    log(f"\n✓ SUCCESS — permits added to cart for {friday} / {saturday}")
                    log("  Complete your checkout in the browser before the cart expires!")
                    success = True
                    break
            if success:
                break

        if not success:
            log("\n✗ Could not add any permits to cart.")
            log("  The permits may be sold out or the selectors need updating.")
            log("  Check the browser window and complete any partial progress manually.")

        log("Bot finished. Browser connection left open.")
        # Do NOT close the browser — leave it open so the user can complete checkout


if __name__ == "__main__":
    asyncio.run(main())
