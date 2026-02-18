"""
Configuration for the Grand Canyon backcountry permit bot.

BEFORE RUNNING:
  1. Launch Chrome with remote debugging enabled:
       bash start_chrome.sh
     (or manually: google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug)
  2. In that Chrome window, log in to recreation.gov manually.
  3. Run the bot: python bot.py
"""

# ── Recreation.gov permit page ─────────────────────────────────────────────────
# Grand Canyon National Park - Backcountry Permits
# Base URL for the detailed availability grid.
# The eapLotteryId parameter must be kept — it gates the EAP access window.
# The date= parameter sets the grid start date (4-day window).  We pass the
# Friday date for each weekend attempt so both Friday AND Saturday are visible
# in the grid from the moment we land on the page.
#
# PERMIT_URL      — used for pre-positioning before launch (starts at June 1)
# PERMIT_URL_TEMPLATE — used per-weekend; fill {date} with the Friday date
PERMIT_URL = (
    "https://www.recreation.gov/permits/4675337/registration/detailed-availability"
    "?date=2026-06-01"
    "&eapLotteryId=d955c3d0-b6a9-4674-a07a-7832965a09ec"
)
PERMIT_URL_TEMPLATE = (
    "https://www.recreation.gov/permits/4675337/registration/detailed-availability"
    "?date={date}"
    "&eapLotteryId=d955c3d0-b6a9-4674-a07a-7832965a09ec"
)

# ── CDP endpoint for the already-running Chrome browser ────────────────────────
CDP_ENDPOINT = "http://localhost:9222"

# ── Scheduling ─────────────────────────────────────────────────────────────────
# Permits open at 8:00 AM Mountain Standard Time (UTC-7).
# The bot will sleep until LAUNCH_SECONDS_EARLY seconds before that, then
# rapidly poll until the window opens.
LAUNCH_TZ = "America/Denver"   # MST/MDT — Denver honours DST automatically
LAUNCH_HOUR = 8
LAUNCH_MINUTE = 0
LAUNCH_SECONDS_EARLY = 10     # start hammering the page this many seconds before 8:00

# ── Permit details ─────────────────────────────────────────────────────────────
NUM_PEOPLE = 2

# Weekends (Fri + Sat) in June 2026, excluding the weekend of June 20.
# Each entry is (friday_date_str, saturday_date_str).
# Priority order: bot tries these in order and stops at the first one added to cart.
TARGET_WEEKENDS = [
    ("2026-06-26", "2026-06-27"),   # Weekend 3 (June 19-20 is excluded)
    ("2026-06-12", "2026-06-13"),   # Weekend 2
    ("2026-06-05", "2026-06-06"),   # Weekend 1
]

# Campground preference options per weekend, tried in priority order.
# Each inner list is [night1_campground_keyword, night2_campground_keyword].
# The keyword must appear in the site's aria-label on the availability grid.
# "Bright Angel"      → CBG - Bright Angel Campground  (South Rim district)
# "Havasupai Gardens" → CIG - Havasupai Gardens Campground (South Rim district)
CAMPGROUND_OPTIONS = [
    ["Bright Angel",      "Bright Angel"],        # Preferred: both nights Bright Angel
    ["Havasupai Gardens", "Bright Angel"],        # Fallback:  Havasupai Gardens night 1
    ["Bright Angel",      "Havasupai Gardens"],   # Fallback:  Havasupai Gardens night 2
]

# Which Starting Area (district) each campground keyword belongs to.
# Must exactly match the button text shown on the permit page.
DISTRICT_FOR_CAMPGROUND = {
    "Bright Angel":       "Classic GC Hike - via South Rim",
    "Havasupai Gardens":  "Classic GC Hike - via South Rim",
    "Cottonwood":         "Classic GC Hike - via North Rim",
}

# Substrings that identify GROUP sites — skipped via :not() in the aria-label selector.
GROUP_SITE_KEYWORDS = ["LARGE GROUP"]

# ── Timing / human-simulation ──────────────────────────────────────────────────
# All delay values are in seconds.
DELAY_BETWEEN_ACTIONS = (0.4, 1.2)   # (min, max) uniform random delay
DELAY_AFTER_NAVIGATION = (1.5, 3.0)  # wait for page to settle after nav
DELAY_BEFORE_RETRY = 2.0             # pause between quota-check retries
MAX_QUOTA_RETRIES = 30               # how many times to retry if no quota shown yet

# ── Selectors ─────────────────────────────────────────────────────────────────
# All selectors are derived from the actual Recreation.gov detailed-availability
# DOM observed on 2026-02-18.  The site uses React/Sarsaparilla components with
# stable data-testid and aria-label attributes that should survive JS re-renders.
#
SELECTORS = {

    # ── Starting Area / District picker ───────────────────────────────────────
    # Pill buttons above the grid.  The active one has aria-pressed="true".
    # "Classic GC Hike - via South Rim" covers Bright Angel & Havasupai Gardens
    # and is the default, but we click it explicitly to be safe.
    #   <button class="... district-picker-button" aria-pressed="true">
    #     Classic GC Hike - via South Rim
    #   </button>
    "district_button_template": 'button.district-picker-button:has-text("{district}")',

    # ── Guest / group-size counter ────────────────────────────────────────────
    # The dropdown button that shows e.g. "2 Group Members".
    #   <button id="guest-counter" aria-haspopup="dialog" aria-controls="guest-counter-popup">
    "guest_counter_button": "button#guest-counter",

    # The popup dialog that opens when you click the guest counter button.
    #   <div id="guest-counter-popup" role="dialog">
    "guest_counter_popup": "#guest-counter-popup",

    # Inside the popup: ⊖  <count>  ⊕  layout.
    # The decrement (⊖) and increment (⊕) are the first two buttons in the popup
    # that are NOT the "Close" button.  We target them by their SVG path content
    # (circle-minus / circle-plus icons from the Sarsaparilla icon set) or by
    # falling back to positional nth-child ordering.
    # ⊖ is the 1st .sarsa-button-subtle child; ⊕ is the 3rd.
    # These are scoped to the already-resolved popup locator in code, so no
    # "#guest-counter-popup" prefix is needed here.
    "guest_counter_decrement": ".sarsa-button-subtle:nth-child(1)",
    "guest_counter_increment": ".sarsa-button-subtle:nth-child(3)",
    # "Close" button lives inside .sarsa-dropdown-base-popup-actions-content
    "guest_counter_close": ".sarsa-dropdown-base-popup-actions-content > .sarsa-button",

    # ── Availability grid ─────────────────────────────────────────────────────
    # The main (non-sticky) grid container.
    #   <div data-component="Grid" role="grid"
    #        aria-label="Availability by Site or Zone and Dates" …>
    "availability_grid": '[aria-label="Availability by Site or Zone and Dates"]',

    # Each campground/zone row (div-based grid, NOT <tr>).
    #   <div data-testid="division-availability-row" role="row" …>
    "quota_row": '[data-testid="division-availability-row"]',

    # ── Direct available-cell targeting by aria-label ─────────────────────────
    # Each clickable date cell button carries a descriptive aria-label:
    #   "CBG - Bright Angel Campground on June 26, 2026 - Available"
    #   "CIG - Havasupai Gardens Campground on June 26, 2026 - Unavailable"
    #
    # Templates — fill {campground} (keyword) and {date_label} ("June 26, 2026").
    # :not([aria-label*="LARGE GROUP"]) skips group/large-group sites.
    "available_cell_button_template": (
        'button.rec-availability-date'
        '[aria-label*="{campground}"]'
        '[aria-label*="{date_label}"]'
        '[aria-label*="Available"]'
        ':not([aria-label*="LARGE GROUP"])'
    ),
    # Unavailable variant (used to detect when a date is fully booked)
    "unavailable_cell_button_template": (
        'button.rec-availability-date'
        '[aria-label*="{campground}"]'
        '[aria-label*="{date_label}"]'
        '[aria-label*="Unavailable"]'
    ),

    # ── Book Now button ───────────────────────────────────────────────────────
    # Sits at the bottom of the page in a sticky bar.  Disabled until at least
    # one date cell has been selected in the itinerary.
    #   <button class="sarsa-button sarsa-button-primary …">Book Now</button>
    "book_now_button": 'button.sarsa-button-primary:has-text("Book Now")',

    # ── Grid date-window navigation ───────────────────────────────────────────
    # After Night 1 is selected the grid may show a different window than the
    # one containing Night 2.  These buttons scroll the grid forward/backward
    # without reloading the page (itinerary state is preserved).
    #
    # Confirmed from live DOM (2026-02-18): button text is "Next 5 Days" /
    # "Prev 5 Days" in the expanded (full-width) view.  We match on the
    # xs-sized button class + "Next"/"Prev" substring so the selector survives
    # if the site ever changes the step count.
    #
    #   <button class="sarsa-button sarsa-button-link sarsa-button-xs …">
    #     <span class="rec-sr-only">View </span>Next 5 Days
    #   </button>
    #
    # Two copies exist (main + sticky header); .first picks the main one.
    "grid_next_button": 'button.sarsa-button-xs:has-text("Next")',
    "grid_prev_button": 'button.sarsa-button-xs:has-text("Prev")',
    # "Clear Dates" button — resets the itinerary (used only if we need to retry)
    "clear_dates_button": 'button:has-text("Clear Dates")',

    # ── Legacy / fallback selectors ───────────────────────────────────────────
    # Kept for reference but not used in the main flow.
    "quota_name":              "button.sarsa-button-link",
    "date_cell_in_row":        '[data-testid="division-availability-cell"]',
    "add_to_cart_button": (
        'button:has-text("Add to Cart"), '
        'button[aria-label*="Add to Cart"]'
    ),
    "cart_confirmation": (
        'text=Added to Cart, '
        'text=View Cart, '
        '[aria-label*="cart"], '
        '.cart-notification'
    ),
}
