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
# This URL goes directly to the detailed availability grid for June 2026.
# The eapLotteryId parameter must be kept — it gates the EAP access window.
# The date= parameter sets the grid view to start at June 1; all target weekends
# fall within this view so we never need to change it.
PERMIT_URL = (
    "https://www.recreation.gov/permits/4675337/registration/detailed-availability"
    "?date=2026-06-01"
    "&eapLotteryId=d955c3d0-b6a9-4674-a07a-7832965a09ec"
)

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
    ("2026-06-26", "2026-06-27"),   # Weekend 3 (June 19-20 is excluded)
    ("2026-06-12", "2026-06-13"),   # Weekend 2
    ("2026-06-05", "2026-06-06"),   # Weekend 1
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
# These are best-guess CSS/text selectors for the DETAILED-AVAILABILITY GRID.
# Recreation.gov uses React so generated class names change; prefer aria-labels
# and data attributes.
#
# HOW TO FIND THE REAL SELECTORS:
#   1. Open the permit URL in Chrome (logged in).
#   2. Open DevTools → Elements.
#   3. Hover over the element you want, right-click → Inspect.
#   4. Right-click the highlighted node → Copy → Copy selector  (or Copy → Copy XPath).
#   5. Paste the value into the relevant key below.
#
SELECTORS = {
    # ── Availability grid ──────────────────────────────────────────────────────
    # The outer table / grid container
    "availability_grid": (
        ".rec-availability-grid, "
        "[data-component='AvailabilityGrid'], "
        "table.availability-table"
    ),

    # Each row in the grid (one per campground / quota zone)
    # NOTE: adjust after inspecting the actual grid rows
    "quota_row": (
        ".rec-availability-grid tbody tr, "
        "[data-component='PermitQuotaRow'], "
        "tr.availability-row"
    ),

    # The campground/zone name cell inside a row (first <td> or labelled cell)
    "quota_name": (
        "td:first-child, "
        "[data-component='QuotaName'], "
        ".quota-name, "
        "th.availability-label"
    ),

    # A specific date cell within a row.
    # rec.gov typically puts the date in a <th> column header with aria-label
    # like "Friday, June 26, 2026" and each data cell has a matching data-date
    # attribute.  Both patterns are tried.
    # Template: fill {date} with "2026-06-26" (YYYY-MM-DD).
    "date_column_header_template": (
        '[aria-label*="{month_day}"], '   # e.g. aria-label contains "June 26"
        'th[data-date="{date}"], '
        'td[data-date="{date}"]'
    ),

    # The clickable availability cell at (row=campground, col=date).
    # After finding the correct column index from the header, we select the
    # <td> at that index inside the quota row.
    # Template: fill {col_index} with the 1-based column number.
    "date_cell_in_row_template": "td:nth-child({col_index})",

    # Button or link inside an availability cell that triggers Add-to-Cart
    "add_to_cart_button": (
        "text=Add to Cart, "
        "button[aria-label*='Add'], "
        "a[aria-label*='Add']"
    ),

    # Dropdown or field for number of people / group size
    # (may appear in a modal after clicking an available cell)
    "people_input": (
        '[aria-label*="people"], [aria-label*="People"], '
        '[name*="people"], [name*="groupSize"], '
        'input[id*="number-of-people"]'
    ),

    # Confirmation that something was added to cart
    "cart_confirmation": (
        "text=Added to Cart, "
        "text=View Cart, "
        "[aria-label*='cart'], "
        ".cart-notification"
    ),
}
