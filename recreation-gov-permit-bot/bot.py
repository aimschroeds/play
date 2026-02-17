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
from datetime import datetime, date, timedelta

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

async def select_date(page: Page, date_str: str) -> bool:
    """
    Click the calendar cell for the given date (YYYY-MM-DD).
    Returns True on success.

    NOTE: Update this function after recording the actual click path on
    recreation.gov.  The aria-label format may differ.
    """
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    # recreation.gov aria-labels look like "June 5, 2026"
    aria_label = dt.strftime("%B %-d, %Y")   # e.g. "June 5, 2026"
    selector = SELECTORS["date_cell_template"].format(month_day_year=aria_label)

    log(f"  Selecting date: {aria_label}")
    try:
        cell = page.locator(selector).first
        await cell.wait_for(state="visible", timeout=5000)
        await human_click(page, cell)
        await human_delay()
        return True
    except Exception as e:
        log(f"  Could not find date cell for {aria_label}: {e}")
        return False


async def set_num_people(page: Page, n: int) -> None:
    """
    Set the group-size / number-of-people field to n.

    NOTE: Update selectors in config.py to match the actual input element.
    """
    log(f"  Setting group size to {n}")
    try:
        field = page.locator(SELECTORS["people_input"]).first
        await field.wait_for(state="visible", timeout=5000)
        await field.triple_click()            # select all existing text
        await asyncio.sleep(random.uniform(0.1, 0.2))
        await field.type(str(n), delay=random.randint(60, 140))
        await human_delay()
    except Exception as e:
        log(f"  Warning: could not set group size: {e}")


async def find_and_add_quota(
    page: Page,
    night_label: str,
    campground_pref: str,
) -> bool:
    """
    On the availability grid for `night_label` (e.g. "Night 1 – June 5"),
    find a non-group site matching `campground_pref` and click Add to Cart.
    Returns True if a site was successfully added.

    NOTE: This is the section most likely to need adjustment after recording
    the actual click path.  The quota row structure varies by permit type.
    """
    log(f"  Looking for '{campground_pref}' quota on {night_label} …")

    for attempt in range(MAX_QUOTA_RETRIES):
        rows = await page.locator(SELECTORS["quota_row"]).all()

        for row in rows:
            # Get campground name text
            try:
                name_el = row.locator(SELECTORS["quota_name"]).first
                name = (await name_el.inner_text()).strip()
            except Exception:
                continue

            if is_group_site(name):
                continue
            if campground_pref.lower() not in name.lower():
                continue

            # Found a matching, non-group row — try to click Add to Cart
            try:
                btn = row.locator(SELECTORS["add_to_cart_button"]).first
                is_visible = await btn.is_visible()
                is_disabled = await btn.is_disabled()
                if not is_visible or is_disabled:
                    log(f"    '{name}' found but button not available yet")
                    break   # break inner, retry outer
                log(f"    Adding to cart: {name}")
                await human_click(page, btn)
                await human_delay(DELAY_AFTER_NAVIGATION)
                # Confirm cart addition
                try:
                    await page.locator(SELECTORS["cart_confirmation"]).first.wait_for(
                        state="visible", timeout=6000
                    )
                    log(f"    ✓ Added '{name}' to cart for {night_label}")
                    return True
                except Exception:
                    log(f"    Cart confirmation not seen — may still have worked")
                    return True   # optimistic: proceed
            except Exception as e:
                log(f"    Error clicking Add to Cart for '{name}': {e}")

        if attempt < MAX_QUOTA_RETRIES - 1:
            log(f"    Quota not yet available, retry {attempt+1}/{MAX_QUOTA_RETRIES} …")
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
    campground preference list.  Returns True if both nights were added.
    """
    night1_camp, night2_camp = campground_option
    log(f"Trying weekend {friday} / {saturday}  [{night1_camp} → {night2_camp}]")

    # Reload the permit page to get a fresh booking form
    await page.goto(PERMIT_URL, wait_until="domcontentloaded")
    await human_delay(DELAY_AFTER_NAVIGATION)

    # Click "Book Now" to open the booking flow
    try:
        book_btn = page.locator(SELECTORS["book_now_button"]).first
        await book_btn.wait_for(state="visible", timeout=8000)
        await human_click(page, book_btn)
        await human_delay(DELAY_AFTER_NAVIGATION)
    except Exception as e:
        log(f"  Could not click Book Now: {e}")
        return False

    # Select the entry date (Friday)
    if not await select_date(page, friday):
        return False

    # Select the exit date (Sunday = Friday + 2 days) or number-of-nights = 2
    # recreation.gov may show a calendar for exit date or a nights selector.
    # Try selecting Saturday first (end of 2-night stay), then Sunday.
    # Adjust this section based on your recorded click path.
    sunday = (datetime.strptime(saturday, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    exit_selected = await select_date(page, sunday)
    if not exit_selected:
        # Fallback: maybe the site uses number-of-nights instead of exit date
        log("  Exit date click failed; trying to set nights = 2 via input")
        try:
            nights_field = page.locator('[aria-label*="nights"], [name*="nights"]').first
            await nights_field.triple_click()
            await nights_field.type("2", delay=random.randint(60, 140))
        except Exception:
            log("  Warning: could not set number of nights")

    await human_delay()

    # Set group size
    await set_num_people(page, NUM_PEOPLE)

    # Submit the search / availability check
    try:
        search_btn = page.locator('text=Search, text=Check Availability, [type="submit"]').first
        if await search_btn.is_visible():
            await human_click(page, search_btn)
            await human_delay(DELAY_AFTER_NAVIGATION)
    except Exception:
        pass  # Not all flows have an explicit Search button

    # Handle each night's quota selection
    night1_ok = await find_and_add_quota(page, f"Night 1 – {friday}", night1_camp)
    if not night1_ok:
        return False

    night2_ok = await find_and_add_quota(page, f"Night 2 – {saturday}", night2_camp)
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
