#!/bin/bash
# Start the Outdoor Status webhook server + ngrok tunnel.
#
# Prerequisites (one-time):
#   pip install flask twilio httpx beautifulsoup4
#   brew install ngrok/ngrok/ngrok
#   ngrok config add-authtoken <token>    # free at ngrok.com
#   brew install 1password-cli
#
# Usage (secrets injected by 1Password):
#   op run --env-file .env.template -- bash start_server.sh
#
# Then paste the printed /sms URL into Twilio:
#   Console → Phone Numbers → Manage → <number>
#   → Messaging → "A message comes in" → Webhook → HTTP POST

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-5050}"

# ── Start Flask server ─────────────────────────────────────────────────────────
echo "Starting Flask webhook server on port $PORT …"
python "$SCRIPT_DIR/server.py" &
SERVER_PID=$!

# Give Flask a moment to bind
sleep 1

# ── Start ngrok (skip if NGROK_URL already set — paid static domain) ───────────
NGROK_PID=""
if [[ -n "$NGROK_URL" ]]; then
    echo "Using pre-configured ngrok URL: $NGROK_URL"
else
    echo "Starting ngrok tunnel …"
    ngrok http "$PORT" --log=stdout --log-format=json > /tmp/ngrok-yosemite.log 2>&1 &
    NGROK_PID=$!

    # Wait for ngrok API to be ready
    for i in {1..10}; do
        sleep 1
        NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
            | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for t in data.get('tunnels', []):
        if t.get('proto') == 'https':
            print(t['public_url'])
            break
except Exception:
    pass
" 2>/dev/null)
        [[ -n "$NGROK_URL" ]] && break
    done
fi

# ── Print instructions ─────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ -n "$NGROK_URL" ]]; then
    echo "Twilio webhook URL — paste this into Twilio console:"
    echo ""
    echo "  ${NGROK_URL}/sms"
    echo ""
    echo "Dev/test endpoint (triggers booking with a real alert URL):"
    echo "  ${NGROK_URL}/test?url=<outdoorstatus-alert-url>"
else
    echo "⚠️  Could not get ngrok URL. Check /tmp/ngrok-yosemite.log"
    echo "   Flask is running on http://localhost:${PORT}/sms"
fi
echo ""
echo "Twilio number (outbound): $TWILIO_FROM"
echo "Alert will be sent to:    $ALERT_PHONE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl-C to stop."

cleanup() {
    echo ""
    echo "Stopping …"
    kill "$SERVER_PID" 2>/dev/null || true
    [[ -n "$NGROK_PID" ]] && kill "$NGROK_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait "$SERVER_PID"
