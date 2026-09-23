#!/usr/bin/env bash
# Install the bridge as a systemd user service inside WSL.
# Safe to re-run: it rewrites the unit and restarts the service.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
UNIT_DIR="$HOME/.config/systemd/user"

node -e 'const [maj] = process.versions.node.split("."); if (+maj < 24) { console.error("Node 24+ required, found " + process.version); process.exit(1) }'

# The service sandbox can only write to directories that already exist.
mkdir -p "$HOME/.local/state/sparky-bonzai-bridge" \
         "$HOME/workspace/inbox/bonzai" \
         "$HOME/workspace/outbox/bonzai" \
         "$HOME/.config/sparky-bonzai-bridge"
chmod 700 "$HOME/.local/state/sparky-bonzai-bridge" "$HOME/.config/sparky-bonzai-bridge"

[ -d "$APP_DIR/node_modules/@modelcontextprotocol" ] || (cd "$APP_DIR" && npm ci --omit=dev --silent)

mkdir -p "$UNIT_DIR"
sed -e "s|@NODE@|$NODE|g" -e "s|@APP_DIR@|$APP_DIR|g" \
  "$APP_DIR/deploy/sparky-bonzai-bridge.service" > "$UNIT_DIR/sparky-bonzai-bridge.service"

systemctl --user daemon-reload
systemctl --user enable --now sparky-bonzai-bridge.service
systemctl --user restart sparky-bonzai-bridge.service
sleep 1
systemctl --user --no-pager --lines=5 status sparky-bonzai-bridge.service || true

PORT="$(grep -E '^BRIDGE_PORT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 || true)"
echo
echo "Health: curl -s http://127.0.0.1:${PORT:-8795}/healthz"
echo "Expose it on your tailnet (run in Windows PowerShell):"
echo "  tailscale serve --bg --https ${PORT:-8795} http://127.0.0.1:${PORT:-8795}"
