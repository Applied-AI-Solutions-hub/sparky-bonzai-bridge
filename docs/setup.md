# Setup

This assumes OpenClaw already runs in WSL (Ubuntu 24.04, systemd enabled) as
the `openclaw` user, and Tailscale runs on the Windows host.

## 1. Install the bridge (WSL)

```bash
git clone https://github.com/Applied-AI-Solutions-hub/sparky-bonzai-bridge.git ~/projects/sparky-bonzai-bridge
cd ~/projects/sparky-bonzai-bridge
npm ci
npm run check            # typecheck + tests against a fake openclaw
cp .env.example .env     # set BRIDGE_OWNER_NAME to your first name
```

## 2. Create a restricted agent for phone turns (recommended)

Phone requests are written by a small model that may have just read a web
page. Run them under an agent that shares Sparky's workspace (persona, memory,
notes) but cannot act outside the PC.

1. Check the workspace path and deny list in
   [openclaw/sparky-mobile-agent.patch.json5](../openclaw/sparky-mobile-agent.patch.json5)
   against your install.
2. Back up the config and apply the patch (OpenClaw validates it before writing):
   ```bash
   cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.pre-bonzai-bridge
   openclaw config patch --file openclaw/sparky-mobile-agent.patch.json5 --dry-run
   openclaw config patch --file openclaw/sparky-mobile-agent.patch.json5
   systemctl --user restart openclaw-gateway.service
   ```
3. Confirm it shows up: `openclaw agents list`
4. Test it: `openclaw agent --agent sparky-mobile --session-key bonzai-test -m "Reply with: ready" --json`
5. Set `OPENCLAW_AGENT=sparky-mobile` in `.env`.

If you skip this step, the bridge uses `main`. It still works, and every
relayed turn carries a header asking Sparky to confirm with you before
outward-facing actions. That header is only a request to the model, not
enforcement. The tool deny list is enforcement.

## 3. Install the mailbox skill for Sparky

```bash
cp -r openclaw/skills/bonzai-mailbox ~/workspace/skills/
```

This teaches Sparky where notes arrive and how to leave messages for a device.

## 4. Register devices

```bash
npm run device -- add iphone --label Kit
npm run device -- add ipad --label Nox
npm run device -- list
```

Each command prints the device's token **once**. Only a hash is stored. To
rotate a token, run `remove`, then `add` again.

## 5. Run as a service

```bash
./deploy/install.sh
curl -s http://127.0.0.1:8795/healthz
journalctl --user -u sparky-bonzai-bridge -f
```

Logs show the device, tool, duration and HTTP status for each call. They never
include message contents.

## 6. Expose it on the tailnet (Windows)

In PowerShell on the Windows host:

```powershell
tailscale serve --bg --https 8795 http://127.0.0.1:8795
tailscale serve status
```

This is tailnet-only HTTPS. Do **not** use `tailscale funnel`, which would put
the bridge on the public internet.

## 7. Configure BonzAI (each device)

1. Open BonzAI's MCP client settings and add a server.
2. URL: `https://<machine>.<tailnet>.ts.net:8795/mcp`
3. Header: `Authorization: Bearer <that device's token>`
4. Paste the system prompt from [bonzai/system-prompt.md](../bonzai/system-prompt.md), changing the name.
5. Ask: "Is Sparky online?" The model should call `sparky_status`.

The phone must be signed in to the same tailnet (Tailscale iOS app).

## Migrating from the old `sparky-mcp` (command-center repo)

The old bridge runs on Windows at port 8794 and uses one shared token. The new
one runs in WSL at port 8795 with a token per device, so both can run side by
side while you test.

To keep Kit's and Nox's existing Sparky conversations, register the devices
with their old session keys:

```bash
npm run device -- add iphone --label Kit --session mcp-kit-iphone
npm run device -- add ipad   --label Nox --session mcp-nox-ipad
```

Tool mapping:

| Old (`sparky-mcp`) | New |
|---|---|
| `sparky_health` | `sparky_status` |
| `message_sparky` (blocks up to 180 s, `device` argument) | `sparky_ask` (answer or `job_id`; device from token) |
| `note_to_sparky` → `sparky-mcp/mail/sparky/*.json` on Windows | `sparky_note` → `~/workspace/inbox/bonzai/*.md` |
| `inbox_from_sparky` / `ack_sparky_note` (Kit only) | `sparky_inbox` / `sparky_inbox_ack` (every device) |
| `work_map_search` | Not included; see the roadmap in [architecture.md](architecture.md) |
| `peer-bridge.md` written to three places | Removed; use OpenClaw session history |

When the new bridge works from both devices:

1. Remove the old MCP server entry in BonzAI on each device.
2. Stop the old process and free its Tailscale port: `tailscale serve --https=8794 off`.
3. Update the Kit/Nox notes in Sparky's `AGENTS.md` / `MEMORY.md` if you changed session keys.

## Troubleshooting

| Symptom | Check |
|---|---|
| 401 in BonzAI | Token copied exactly? `npm run device -- list` shows the device? |
| `sparky_status` says offline | `openclaw health --json` in WSL; `systemctl --user status openclaw-gateway` |
| Service will not start | `journalctl --user -u sparky-bonzai-bridge -n 50`; rerun `deploy/install.sh` (it creates the sandbox directories) |
| Phone cannot reach the URL | Tailscale connected on the phone? `tailscale serve status` on Windows? |
| Every ask becomes a job | Sparky is slow or the GPU is busy. Raise `BRIDGE_ASK_WAIT_SECONDS` if BonzAI tolerates longer tool calls |
