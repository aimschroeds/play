# OpenClaw Pi Sandbox

Run OpenClaw on a Raspberry Pi with sandboxed accounts, capped finances, and kill-switch controls — so the AI agent can act on your behalf without blowing up your life.

## Philosophy

Give the agent **real capabilities** but inside a **blast radius you control**:

- Every account is net-new and disposable — nothing touches your real identity
- Financial exposure is hard-capped by a prepaid card with no overdraft
- The Pi is isolated on your network and hardened at the OS level
- You can kill the agent instantly via SSH or physical power-off
- Every action is logged and auditable

---

## Phase 0: Sandboxed Account Setup (Do This First, From Your Laptop)

Set all of this up **before** the Pi is online. Use a password manager (1Password / Bitwarden) to store everything.

### 0.1 — Burner Email

| Option | Notes |
|---|---|
| ProtonMail (free tier) | End-to-end encrypted, no phone required to sign up |
| Gmail | Requires phone verification — use the burner number below |
| Tutanota | No phone required, EU-based |

Pick one. This email anchors every other account.

### 0.2 — Burner Phone Number

| Option | Cost | Notes |
|---|---|---|
| Google Voice | Free | Needs an existing Google account; US only. Can send/receive SMS and calls |
| Twilio | ~$1.50/mo + per-message | Programmable — OpenClaw can use the API directly for SMS/voice |
| MySudo | $0.99–$14.99/mo | Up to 9 separate phone lines, built for privacy |
| Prepaid SIM (Mint, Ultra, etc.) | $15–30/mo | Physical number, works everywhere. Pop it in an old phone as a dedicated 2FA device |

**Recommendation:** Twilio for programmable SMS/voice (the agent can use the API), plus a cheap prepaid SIM as a backup for accounts that demand a "real" phone number.

### 0.3 — Burner Messaging Accounts

Register these with the burner email + burner phone:

| Platform | Registration needs | OpenClaw channel |
|---|---|---|
| Telegram | Phone number | Built-in Telegram channel |
| WhatsApp | Phone number (prepaid SIM) | Built-in WhatsApp channel |
| Signal | Phone number | Built-in Signal channel |
| Discord | Email | Built-in Discord channel |
| Slack | Email (create a new workspace) | Built-in Slack channel |

**Important:** Do NOT connect your personal accounts. The whole point is isolation.

### 0.4 — Prepaid Payment Card

This is the critical financial guardrail.

| Option | Why |
|---|---|
| **Privacy.com** | Virtual cards with per-card spending limits, pause/close instantly. Free tier gives 12 cards/month. **Best option.** |
| Revolut (prepaid mode) | Virtual + physical cards, set spending limits per card |
| Prepaid Visa/Mastercard (store-bought) | No overdraft by design. Load $50–100. When it's empty, it's empty |
| Cash App card | Debit-only, easy to lock/unlock from phone |

**Recommendation:** Privacy.com — create a dedicated virtual card for the agent with a **$50/month cap**. You can lower or pause it instantly from your phone.

**Rules:**
- No linked bank account with overdraft — ever
- Start with $20–50 loaded, raise only after you trust the setup
- Set up transaction alerts to your real phone (so you see every charge)
- Create separate cards for separate services if the agent needs to pay for multiple things

### 0.5 — Summary Checklist

```
[ ] Burner email created (ProtonMail / Gmail / Tutanota)
[ ] Burner phone number active (Twilio / prepaid SIM)
[ ] Telegram account on burner phone
[ ] WhatsApp account on burner phone
[ ] Signal account on burner phone
[ ] Discord account on burner email
[ ] Privacy.com card created with $50/mo cap
[ ] All credentials stored in password manager
[ ] Transaction alerts enabled to your real phone
```

---

## Phase 1: Raspberry Pi Hardening

Assumes you've already flashed Raspberry Pi OS Lite and can SSH in (see the `raspberry-pi-headless-setup` repo).

### 1.1 — OS Basics

```bash
# Update everything
sudo apt update && sudo apt full-upgrade -y

# Set hostname
sudo hostnamectl set-hostname clawpi

# Set timezone
sudo timedatectl set-timezone America/New_York  # adjust
```

### 1.2 — Dedicated User (Don't Run as Pi)

```bash
# Create a dedicated user for OpenClaw
sudo adduser --disabled-password --gecos "" openclaw

# Give it Docker access (needed later)
sudo usermod -aG docker openclaw
```

### 1.3 — SSH Lockdown

```bash
# On your laptop — copy your key to the new user
ssh-copy-id openclaw@clawpi.local

# On the Pi — disable password auth
sudo sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

### 1.4 — Firewall

```bash
sudo apt install ufw -y

# Default deny incoming
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH only
sudo ufw allow ssh

# Enable
sudo ufw enable
sudo ufw status
```

**Do NOT expose port 18789 (OpenClaw Gateway) to the network.** Access it via SSH tunnel only:

```bash
# From your laptop — tunnel the Gateway UI to localhost:18789
ssh -L 18789:127.0.0.1:18789 openclaw@clawpi.local
```

### 1.5 — Automatic Security Updates

```bash
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## Phase 2: Install OpenClaw

### 2.1 — Install Node.js 22

```bash
# Switch to the openclaw user
sudo -u openclaw -i

# Install Node via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
node --version  # should be 22.x
```

### 2.2 — Install OpenClaw

```bash
npm install -g openclaw@latest

# Run the onboarding wizard
openclaw onboard
```

The wizard will walk you through:
1. **Gateway setup** — bind to `127.0.0.1:18789` (loopback only!)
2. **Workspace** — creates `~/.openclaw/`
3. **LLM provider** — enter your Anthropic/OpenAI API key
4. **Channels** — skip for now, we'll add them manually

### 2.3 — Bind to Loopback Only

After onboarding, verify the gateway only listens on localhost:

```bash
# Check the config
grep -r "host" ~/.openclaw/gateway.*

# If it says 0.0.0.0, change it to 127.0.0.1
# The Gateway should NEVER be exposed to the network
```

### 2.4 — Install as Systemd Service

```bash
openclaw onboard --install-daemon
# This creates a systemd user service that auto-starts on boot
```

---

## Phase 3: Connect Sandboxed Channels

Only connect the burner accounts from Phase 0.

### 3.1 — Telegram (Primary Control Channel)

Telegram is the easiest to set up and a good primary interface:

```bash
# Via the OpenClaw CLI or Gateway UI
# 1. Create a Telegram bot via @BotFather on the burner Telegram account
# 2. Get the bot token
# 3. Add it to OpenClaw config
```

### 3.2 — Email (IMAP/SMTP via Himalaya)

```bash
# Install the himalaya email skill
# Configure with the burner email's IMAP/SMTP credentials
# This lets the agent read and send email as the burner identity
```

### 3.3 — SMS/Voice via Twilio

```bash
# Install the Twilio skill from ClawHub (after vetting — see Phase 5)
# Configure with Twilio Account SID, Auth Token, and burner phone number
# Set rate limits in Twilio dashboard:
#   - Max 10 SMS/hour
#   - Max 5 voice calls/hour
#   - Monthly spend cap: $10
```

### 3.4 — Payments

The agent doesn't get direct card credentials. Instead:

1. Use Privacy.com's API (if available) or configure specific merchant accounts
2. The agent can request purchases, but the actual card number stays in 1Password — not in OpenClaw's config
3. For services that need a card on file: use the capped Privacy.com virtual card

---

## Phase 4: Permission Guardrails

### 4.1 — Agent System Prompt

In your workspace config, set clear boundaries:

```markdown
## Rules

- You MUST NOT send more than 20 messages per hour across all channels
- You MUST NOT make purchases over $10 without asking me first via Telegram
- You MUST NOT sign up for recurring subscriptions
- You MUST NOT share personal information, real name, or real contact details
- You MUST NOT execute shell commands that modify system files
- You MUST log every external action (email sent, message sent, payment made)
- If uncertain about an action, ask me via Telegram before proceeding
```

### 4.2 — OpenClaw Permission Controls

```yaml
# In workspace config — restrict dangerous tools
tools:
  shell:
    enabled: false          # No raw shell access
  browser:
    enabled: true
    sandbox: docker         # Run browser in Docker container
  cron:
    enabled: true
    max_jobs: 5             # Limit scheduled tasks
```

### 4.3 — Twilio Rate Limits (External Guardrail)

Set these in the Twilio dashboard — the agent can't override them:

- SMS: 10/hour, 50/day
- Voice: 5/hour, 20/day
- Monthly spend: $10 hard cap

### 4.4 — Privacy.com Spending Limits (External Guardrail)

- Per-transaction limit: $10
- Monthly limit: $50
- Pause card from your phone instantly

---

## Phase 5: Skill Vetting (Critical)

**12–20% of ClawHub skills are malicious** (per Cisco security research). Do NOT enable auto-install.

### Rules:
1. **Never** enable ClawHub auto-install (`clawhub.auto_install: false`)
2. **Read the source** of every skill before installing — check the SKILL.md and any TypeScript
3. **Pin versions** — don't auto-update skills
4. **Start with official bundled skills only** — there are 53 of them
5. Only add community skills after reading the code yourself

```yaml
# In workspace config
clawhub:
  auto_install: false
  auto_update: false
```

---

## Phase 6: Monitoring & Kill Switch

### 6.1 — Action Log

OpenClaw stores conversations as Markdown in `~/.openclaw/`. Set up a cron job to sync logs:

```bash
# Cron: sync logs to your laptop every hour
# On your laptop's crontab:
0 * * * * rsync -az openclaw@clawpi.local:~/.openclaw/workspaces/ ~/openclaw-logs/
```

### 6.2 — Alerts

Set up notifications for critical events:

- **Privacy.com**: Transaction alerts to your real phone (already enabled)
- **Twilio**: Usage alerts when approaching limits
- **Telegram**: Pin a "status" chat where the agent reports what it did every hour

### 6.3 — Kill Switches (Multiple Layers)

| Method | Speed | Scope |
|---|---|---|
| `ssh openclaw@clawpi.local 'systemctl --user stop openclaw'` | Instant | Stops the agent, keeps Pi running |
| Privacy.com: pause card from phone | Instant | Blocks all payments |
| Twilio: suspend account from dashboard | Instant | Blocks all SMS/voice |
| `ssh openclaw@clawpi.local 'sudo shutdown -h now'` | ~10 seconds | Full Pi shutdown |
| Unplug the Pi | Instant | Nuclear option |

### 6.4 — Weekly Review Routine

```
[ ] Check ~/.openclaw/ logs — what did the agent do?
[ ] Review Privacy.com transaction history
[ ] Review Twilio usage log
[ ] Check for OpenClaw updates / security advisories
[ ] Rotate API keys if anything looks off
```

---

## Phase 7: Suggested Starting Use Cases

Start small. Don't enable everything at once.

**Week 1 — Read only:**
- Agent can read emails and summarize them via Telegram
- Agent can check news/RSS feeds and brief you

**Week 2 — Low-stakes writes:**
- Agent can draft email replies (you approve before sending)
- Agent can send you Telegram reminders

**Week 3 — Supervised actions:**
- Agent can send emails on your behalf (to contacts you whitelist)
- Agent can send SMS via Twilio (rate-limited)

**Week 4+ — Expand gradually:**
- Payments (with $10/transaction cap)
- Scheduling calls
- More channel integrations

---

## Cost Estimate

| Item | Monthly cost |
|---|---|
| LLM API (Anthropic/OpenAI) | $20–60 depending on usage |
| Twilio (SMS/Voice) | ~$5–15 |
| Privacy.com | Free (capped at $50 spend) |
| Prepaid SIM (optional) | $15–30 |
| ProtonMail | Free |
| **Total** | **~$40–105/mo** (plus whatever you let the agent spend) |

The Pi itself costs nothing to run (< $5/year electricity).

---

## File Structure

```
openclaw-pi-sandbox/
├── README.md              ← this file (setup plan)
├── config/
│   ├── gateway.yaml       ← OpenClaw gateway config (loopback-only)
│   ├── workspace.yaml     ← Agent permissions and tool restrictions
│   └── skills.yaml        ← Vetted skill allowlist
├── scripts/
│   ├── harden-pi.sh       ← OS hardening automation
│   ├── install-openclaw.sh← Automated install
│   ├── backup-logs.sh     ← Log sync to laptop
│   └── kill-agent.sh      ← Emergency stop
└── docs/
    └── account-setup.md   ← Detailed account creation walkthrough
```

---

## Security Checklist

```
[ ] Pi firewall enabled, only SSH open
[ ] Gateway bound to 127.0.0.1 (loopback only)
[ ] Dedicated 'openclaw' user (not root, not pi)
[ ] SSH key-only auth, passwords disabled
[ ] All accounts are burner/sandboxed
[ ] No real financial accounts connected
[ ] Prepaid card has hard spending cap, no overdraft
[ ] ClawHub auto-install disabled
[ ] All skills manually vetted before install
[ ] Transaction alerts going to your real phone
[ ] Log sync running
[ ] Kill switch tested and working
[ ] Automatic OS security updates enabled
```
