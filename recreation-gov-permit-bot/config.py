"""
Configuration for the Grand Canyon backcountry permit bot.

BEFORE RUNNING:
  1. Launch Chrome with remote debugging enabled:
       google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
     (or on Mac: open -a "Google Chrome" --args --remote-debugging-port=9222)
  2. In that Chrome window, log in to recreation.gov manually.
  3. Run the bot: python bot.py
"""

# ── Recreation.gov permit page ─────────────────────────────────────────────────
# Grand Canyon National Park - Backcountry Permits
PERMIT_URL = "https://www.recreation.gov/permits/234652"

# ── CDP endpoint for the already-running Chrome browser ────────────────────────
CDP_ENDPOINT = "http://localhost:9222"

# ── Scheduling ─────────────────────────────────────────────────────────────────
# Permits open at 8:00 AM Mountain Standard Time (UTC-7).
# The bot will sleep until LAUNCH_SECONDS_EARLY seconds before that, then
# rapidly poll until the window opens.
LAUNCH_TZ = "America/Denver"   # MST/MDT — use Denver to honour DST automatically
LAUNCH_HOUR = 8
LAUNCH_MINUTE = 0
LAUNCH_SECONDS_EARLY = 10     # start hammering the page this many seconds before 8:00

# ── Permit details ─────────────────────────────────────────────────────────────
NUM_PEOPLE = 2

# Weekends (Fri + Sat) in June 2026, excluding the weekend of June 20.
# Each entry is (friday_date_str, saturday_date_str).
# Priority order: bot tries these in order and stops at the first one added to cart.
TARGET_WEEKENDS = [
    ("2026-06-05", "2026-06-06"),   # Weekend 1
    ("2026-06-12", "2026-06-13"),   # Weekend 2
    ("2026-06-26", "2026-06-27"),   # Weekend 3 (June 19-20 is excluded)
]

# Campground preference options per weekend, tried in priority order.
# Each inner list is [night1_campground, night2_campground].
# "Bright Angel" = Bright Angel Campground (non-group sites only)
# "Cottonwood"   = Cottonwood Campground   (non-group sites only)
CAMPGROUND_OPTIONS = [
    ["Bright Angel", "Bright Angel"],   # Preferred: both nights Bright Angel
    ["Bright Angel", "Cottonwood"],     # Fallback:  Bright Angel → Cottonwood
]

# Substrings that identify GROUP sites — the bot will skip any site whose name
# contains one of these (case-insensitive).
GROUP_SITE_KEYWORDS = ["group", "grp"]

# ── Timing / human-simulation ──────────────────────────────────────────────────
# All delay values are in seconds.
DELAY_BETWEEN_ACTIONS = (0.4, 1.2)   # (min, max) uniform random delay
DELAY_AFTER_NAVIGATION = (1.5, 3.0)  # wait for page to settle after nav
DELAY_BEFORE_RETRY = 2.0             # pause between quota-check retries
MAX_QUOTA_RETRIES = 30               # how many times to retry if no quota shown yet

# ── Selectors (update these after recording your click path) ──────────────────
# These are best-guess CSS/text selectors. Recreation.gov uses React so IDs can
# change; aria-labels and visible text are more stable.
#
# To record the actual path:
#   Open DevTools → Elements → right-click the element → Copy → Copy selector
#
SELECTORS = {
    # Button on the permit landing page that opens the date picker / booking flow
    "book_now_button": "text=Book Now",

    # The calendar date cells — rec.gov uses buttons with aria-label like "June 5, 2026"
    "date_cell_template": '[aria-label="{month_day_year}"]',   # fill with e.g. "June 5, 2026"

    # Dropdown or field for number of people / group size
    "people_input": '[aria-label*="people"], [aria-label*="People"], [name*="people"], [name*="groupSize"]',

    # Each available quota row on the availability grid
    # Typically a <tr> or <div> containing the campground name and an "Add to Cart" button
    "quota_row": ".quota-row, [data-component='PermitQuotaRow'], tr.permit-quota",

    # The campground name inside a quota row
    "quota_name": ".quota-name, [data-component='QuotaName'], td.quota-name",

    # The "Add to Cart" button inside a quota row
    "add_to_cart_button": "text=Add to Cart",

    # Confirmation that something was added to cart
    "cart_confirmation": "text=Added to Cart, text=View Cart, [aria-label*='cart']",
}
