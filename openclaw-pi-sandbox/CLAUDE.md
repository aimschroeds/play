# OpenClaw Pi Sandbox

Config templates and scripts for running OpenClaw on a Raspberry Pi 5.

## Pi Access

- **Admin user:** `ssh pi@192.168.0.243`
- **OpenClaw user:** `ssh openclaw@192.168.0.243`
- Hostname: `clawpi.local`

## Key Details

- OpenClaw version: 2026.2.21-2
- Systemd service: `openclaw-gateway`
- Gateway: loopback only (`127.0.0.1:18789`)
- Channel: Telegram (live)
- Primary model: `anthropic/claude-sonnet-4-6`
- Fallback model: `google-gemini/gemini-2.5-pro`

## OpenClaw Config (on Pi)

- Config home: `~/.openclaw/`
- Auth profiles: `~/.openclaw/agents/main/agent/auth-profiles.json`
- Auth config: `~/.openclaw/agents/main/agent/auth.json`
- Workspace configs: `~/.openclaw/workspaces/` (SOUL.md, HEARTBEAT.md, TOOLS.md, USER.md)

## Workflow Preferences

- NEVER suggest commands that echo API keys or secrets in terminal output
- Commit early and often
