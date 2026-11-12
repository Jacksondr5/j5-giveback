#!/usr/bin/env bash
# Installs the two scheduled jobs as systemd user timers, or removes them.
#
#   ops/install.sh              install or update, then start the timers
#   ops/install.sh --uninstall  stop the timers and remove the units
#
# The units are written to ~/.config/systemd/user with this checkout's path
# filled in, so the installed copies are local to the machine and are not
# committed. The jobs then run the scripts in ops/bin straight from this checkout:
# pull the repository and the jobs are up to date. If the checkout moves, run this again.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNITS=(giveback-refresh.service giveback-refresh.timer giveback-backup.service giveback-backup.timer)
TIMERS=(giveback-refresh.timer giveback-backup.timer)

if [ "${1:-}" = "--uninstall" ]; then
  systemctl --user disable --now "${TIMERS[@]}" 2>/dev/null || true
  for unit in "${UNITS[@]}"; do rm -f "$UNIT_DIR/$unit"; done
  systemctl --user daemon-reload
  echo "Removed the giveback timers. Backups and ~/.config/j5-giveback/env were left alone."
  exit 0
fi

if [ ! -f "${GIVEBACK_ENV_FILE:-$HOME/.config/j5-giveback/env}" ]; then
  echo "Missing ${GIVEBACK_ENV_FILE:-$HOME/.config/j5-giveback/env}." >&2
  echo "Create it first with GIVEBACK_URL, GIVEBACK_AGENT_SECRET and GIVEBACK_REFRESH_SECRET (see README.md)." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"
for unit in "${UNITS[@]}"; do
  # "|" as the sed delimiter: a path never contains one in practice, and it does contain "/".
  sed "s|@REPO@|$REPO|g" "$REPO/ops/systemd/$unit" > "$UNIT_DIR/$unit"
done
chmod +x "$REPO/ops/bin/refresh.sh" "$REPO/ops/bin/backup.sh"

systemctl --user daemon-reload
systemctl --user enable --now "${TIMERS[@]}"

echo "Installed. Next runs:"
systemctl --user list-timers "${TIMERS[@]}" --no-pager | sed -n '1,3p'
echo
echo "Timers run only while this user has a session, unless lingering is on:"
echo "  loginctl enable-linger \"\$USER\""
