"""
Configuration for the Yosemite Wilderness permit bot.

BEFORE RUNNING:
  1. Launch Chrome with remote debugging enabled:
       bash start_chrome.sh
     (or manually: google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug)
  2. In that Chrome window, log in to recreation.gov manually.
  3. Run the bot: python bot.py
"""

# ── Recreation.gov permit page ─────────────────────────────────────────────────
# Yosemite National Park - Wilderness Permits
# Base URL for the detailed availability grid.
# No eapLotteryId parameter needed for Yosemite.
# The date= parameter sets the grid start date.
#
# PERMIT_URL      — used for pre-positioning before launch (starts at Aug 1)
# PERMIT_URL_TEMPLATE — used per-window scan; fill {date} with the window start
PERMIT_URL = (
    "https://www.recreation.gov/permits/445859/registration/detailed-availability"
    "?date=2026-08-01"
    "&type=overnight-permit"
)
PERMIT_URL_TEMPLATE = (
    "https://www.recreation.gov/permits/445859/registration/detailed-availability"
    "?date={date}"
    "&type=overnight-permit"
)

# ── CDP endpoint for the already-running Chrome browser ────────────────────────
CDP_ENDPOINT = "http://localhost:9222"

# ── Scheduling ─────────────────────────────────────────────────────────────────
# Permits open at 9:00 AM Pacific Time.
# The bot will sleep until LAUNCH_SECONDS_EARLY seconds before that, then
# rapidly poll until the window opens.
LAUNCH_TZ = "America/Los_Angeles"   # PST/PDT — honours DST automatically
LAUNCH_HOUR = 9
LAUNCH_MINUTE = 0
LAUNCH_SECONDS_EARLY = 10     # start hammering the page this many seconds before 9:00

# ── Permit details ─────────────────────────────────────────────────────────────
NUM_PEOPLE = 3

# Earliest date to look for availability (YYYY-MM-DD).
START_DATE = "2026-08-01"

# Trailheads to try, in priority order.
# Each string must exactly match the aria-label on the trailhead's row button
# in the availability grid.
TRAILHEAD_PRIORITY = [
    "Lyell Canyon (Donohue Pass Eligible)",
    "Happy Isles->Past LYV (Donohue Pass Eligible)",
    "Yosemite Creek",
]

# How many 5-day grid windows to scan before giving up.
# 2 windows × 5 days ≈ 8-10 days of coverage starting from START_DATE.
MAX_DATE_WINDOWS = 2

# ── Timing / human-simulation ──────────────────────────────────────────────────
# All delay values are in seconds.
DELAY_BETWEEN_ACTIONS = (0.4, 1.2)   # (min, max) uniform random delay
DELAY_AFTER_NAVIGATION = (1.5, 3.0)  # wait for page to settle after nav
DELAY_BEFORE_RETRY = 2.0             # pause between quota-check retries
MAX_QUOTA_RETRIES = 30               # how many times to retry if no quota shown yet

# ── Selectors ─────────────────────────────────────────────────────────────────
# Derived from the Yosemite detailed-availability DOM.
# Key difference from Grand Canyon: the grid aria-label is
# "Availability by Sites and Dates" (not "by Site or Zone and Dates").
# Cell aria-labels do NOT contain the trailhead name; instead the trailhead
# is identified by a row-level button with aria-label matching the trailhead.
#
SELECTORS = {

    # ── Availability grid ─────────────────────────────────────────────────────
    # The main (non-sticky) grid container.
    #   <div data-component="Grid" role="grid"
    #        aria-label="Availability by Sites and Dates" …>
    "availability_grid": '[aria-label="Availability by Sites and Dates"]',

    # ── Guest / group-size counter ────────────────────────────────────────────
    # Same DOM structure as Grand Canyon.
    "guest_counter_button":   "button#guest-counter",
    "guest_counter_popup":    "#guest-counter-popup",
    "guest_counter_decrement": 'button[aria-label="Remove Peoples"]',
    "guest_counter_increment": 'button[aria-label="Add Peoples"]',
    "guest_counter_close":    ".sarsa-dropdown-base-popup-actions-content > .sarsa-button",

    # ── Grid date-window navigation ───────────────────────────────────────────
    # Same DOM structure as Grand Canyon: "Next 5 Days" / "Prev 5 Days" buttons.
    "grid_next_button": 'button.sarsa-button-xs:has-text("Next")',
    "grid_prev_button": 'button.sarsa-button-xs:has-text("Prev")',

    # ── Book Now button ───────────────────────────────────────────────────────
    "book_now_button": 'button.sarsa-button-primary:has-text("Book Now")',

    # ── Date picker input ─────────────────────────────────────────────────────
    # Recreation.gov ignores the ?date= URL parameter at runtime and resets the
    # grid to today's date.  We interact with the date picker directly instead.
    # Accepts MM/DD/YYYY input.
    "date_input": 'input[aria-label="Start Date"]',

    # ── Grid column header (used to read the currently-displayed start date) ──
    # The first column header contains a screen-reader-only span with the full
    # date: "Monday, August 1, 2026".  We use this to check whether the grid
    # is already showing the desired start date.
    "grid_first_column_header_sr": (
        '[aria-label="Availability by Sites and Dates"] '
        '[role="columnheader"] .rec-sr-only'
    ),

    # ── Trailhead row and available cell selectors ────────────────────────────
    # Trailhead rows are identified by a named button inside a [role="row"] div.
    # Template — fill {trailhead} with the exact aria-label string.
    #
    # available_cell_in_row: we do NOT filter by a parent CSS class (.available)
    # because Yosemite uses multiple states for bookable cells (.available,
    # .walk-up, …).  We rely on the button being enabled and exclude NR cells
    # (Not Released) whose aria-label says "not yet released" — clicking those
    # opens a modal and blocks checkout.
    "trailhead_row_template": '[role="row"]:has(button[aria-label="{trailhead}"])',
    "available_cell_in_row": (
        'button.rec-availability-date'
        ':not(:disabled)'
        ':not([aria-label*="not yet released"])'
    ),
}
