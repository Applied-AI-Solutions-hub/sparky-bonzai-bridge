# Security

## What the bridge exposes

Anyone holding a device token can make Sparky run agent turns. Treat a token
like SSH access to a limited account: a request can reach whatever tools the
configured OpenClaw agent allows.

## Trust boundaries

1. **Network.** The bridge listens on `127.0.0.1` only. Tailscale Serve on the
   Windows host is the only way in, and only for devices on your tailnet.
   Never expose it with Tailscale Funnel or a port forward.
2. **Authentication.** Each device has its own 256-bit random bearer token.
   Only a SHA-256 hash is stored (`devices.json`, mode 600), and tokens are
   compared in constant time. The device identity comes from the token, never
   from a tool argument.
3. **The relayed model.** Requests are written by a small on-device model that
   may have just read untrusted web content. Every relayed turn is framed with
   a header telling Sparky to confirm outward-facing actions with the owner
   directly. That header is advisory. **Enforcement is the OpenClaw tool deny
   list** on the `sparky-mobile` agent ([docs/setup.md](docs/setup.md#2-create-a-restricted-agent-for-phone-turns-recommended)).
4. **Filesystem.** The service runs with `ProtectSystem=strict` and
   `ProtectHome=read-only`, writing only its state directory, the two
   mailboxes and `~/.openclaw`. Mailbox acks reject any id containing a path
   separator, and acknowledged messages are moved, not deleted.

## Limits

- Per device: one running Sparky turn at a time, and `BRIDGE_MAX_ASKS_PER_HOUR`
  asks (default 40).
- Request bodies are capped at 1 MB; questions at 8,000 characters; notes at 4,000.

## What is logged

For each call: device id, tool name, duration and HTTP status. Questions,
answers and notes are **not** logged. They live in job files (pruned after 7
days) and OpenClaw's own session history.

## Losing a device

```bash
npm run device -- remove iphone
```

The token stops working on the next request; no restart is needed.

## Reporting

Open a private security advisory on the GitHub repository rather than a public issue.
