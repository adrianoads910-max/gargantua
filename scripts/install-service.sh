#!/usr/bin/env bash
# Starts Gargantua with your session (Linux, systemd user service), on http://127.0.0.1:4848
#   bash scripts/install-service.sh            install (or update) and start
#   bash scripts/install-service.sh --remove   stop and uninstall
set -euo pipefail
NAME=gargantua
UNIT="$HOME/.config/systemd/user/$NAME.service"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${GARGANTUA_PORT:-4848}"

if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now "$NAME.service" 2>/dev/null || true
  rm -f "$UNIT"; systemctl --user daemon-reload
  echo "removed $UNIT"; exit 0
fi

NODE="$(command -v node)" || { echo "node not found on PATH"; exit 1; }
CLAUDE_DIR="$(dirname "$(command -v claude 2>/dev/null || echo "$HOME/.local/bin/claude")")"
mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<UNIT
[Unit]
Description=Gargantua (galaxy of Claude Code sessions)
After=network.target

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$NODE $DIR/bin/gargantua.js --no-open --port $PORT
# systemd does not read your shell profile: node (nvm) and claude must be on this PATH for transmissions
Environment=PATH=$(dirname "$NODE"):$CLAUDE_DIR:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=3
# a transmission (claude -p) keeps running if the server restarts
KillMode=process

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable "$NAME.service" >/dev/null
systemctl --user restart "$NAME.service"
echo "installed $UNIT → http://127.0.0.1:$PORT"
