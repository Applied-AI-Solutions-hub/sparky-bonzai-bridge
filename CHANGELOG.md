# Changelog

## 0.1.0 — 2026-09-22

First release. Replaces the `sparky-mcp` folder in `applied-ai-command-center`.

- Stateless MCP server (Streamable HTTP, JSON responses) running in WSL next to OpenClaw.
- Six tools: `sparky_ask`, `sparky_job_result`, `sparky_note`, `sparky_inbox`, `sparky_inbox_ack`, `sparky_status`.
- Per-device bearer tokens, stored as hashes; device identity comes from the token.
- Slow asks become jobs instead of blocking the phone.
- File mailboxes in Sparky's workspace, plus the `bonzai-mailbox` OpenClaw skill.
- systemd user unit with filesystem sandboxing; tailnet-only exposure via Tailscale Serve.
