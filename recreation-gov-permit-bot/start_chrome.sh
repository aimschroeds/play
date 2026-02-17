#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start_chrome.sh
# Launch Chrome with remote debugging so bot.py can attach to your session.
#
# USAGE
#   bash start_chrome.sh
#
# After Chrome opens:
#   1. Log in to recreation.gov (if not already logged in via your profile).
#   2. Leave Chrome running.
#   3. In a separate terminal, run:  python bot.py
# ─────────────────────────────────────────────────────────────────────────────

PORT=9222
PROFILE_DIR="$HOME/.chrome-recgov-debug"   # keeps your session between runs

echo "Starting Chrome on remote-debugging port $PORT …"
echo "Profile stored at: $PROFILE_DIR"
echo ""
echo "After Chrome opens:"
echo "  1. Log in to recreation.gov"
echo "  2. Keep this window open"
echo "  3. Run:  python bot.py"
echo ""

# Detect OS and pick the right Chrome binary
if [[ "$OSTYPE" == "darwin"* ]]; then
    CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v google-chrome &>/dev/null; then
    CHROME="google-chrome"
elif command -v chromium-browser &>/dev/null; then
    CHROME="chromium-browser"
elif command -v chromium &>/dev/null; then
    CHROME="chromium"
else
    echo "ERROR: Chrome not found. Install Google Chrome or Chromium."
    exit 1
fi

"$CHROME" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run \
    --no-default-browser-check \
    2>/dev/null &

echo "Chrome PID: $!"
