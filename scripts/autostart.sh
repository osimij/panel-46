#!/bin/zsh
# Keeps Panel running in the background on this Mac: it starts when you log in
# and comes back by itself if it ever stops. Then http://127.0.0.1:4646 just works.
#
#   scripts/autostart.sh install     start now and at every login
#   scripts/autostart.sh restart     rebuild and restart after changing the code
#   scripts/autostart.sh status      is it running?
#   scripts/autostart.sh uninstall   stop, and don't start at login any more
set -euo pipefail

LABEL="com.panel46.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/Panel"
ROOT="${0:A:h:h}"
DOMAIN="gui/$(id -u)"
BUN="$(command -v bun)"

write_plist() {
  mkdir -p "$LOGS" "${PLIST:h}"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$BUN</string><string>server/index.ts</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <!-- yt-dlp and ffmpeg come from Homebrew; launchd doesn't read your shell's PATH. -->
    <key>PATH</key><string>${BUN:h}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/server.log</string>
</dict>
</plist>
EOF
}

case "${1:-status}" in
  install)
    (cd "$ROOT" && "$BUN" run build >/dev/null)
    write_plist
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Panel now runs in the background: http://127.0.0.1:4646"
    ;;
  restart)
    (cd "$ROOT" && "$BUN" run build >/dev/null)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "Restarted"
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl print "$DOMAIN/$LABEL" | grep -E "^\s+(state|pid) =" || true
    else
      echo "Not installed"
    fi
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Panel no longer starts by itself"
    ;;
  *)
    echo "usage: $0 install|restart|status|uninstall" >&2
    exit 1
    ;;
esac
