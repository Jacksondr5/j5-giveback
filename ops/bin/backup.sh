#!/usr/bin/env bash
# Saves a full export of the dashboard and deletes copies older than the retention period.
# Run daily by giveback-backup.timer.
#
# The dashboard is the only copy of this data. An export holds everything,
# private fields included, so it is written readable by its owner only and
# must never be committed or shared.
#
#   GIVEBACK_BACKUP_DIR   where to keep exports  (default: ~/.local/share/j5-giveback/backups)
#   GIVEBACK_BACKUP_DAYS  how many days to keep  (default: 30)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
umask 077

dir="${GIVEBACK_BACKUP_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/j5-giveback/backups}"
days="${GIVEBACK_BACKUP_DAYS:-30}"
mkdir -p "$dir"

out="$dir/export-$(date -u +%Y%m%dT%H%M%SZ).json"
# Write to a temporary name first, so a failed export never leaves a file that looks complete.
giveback export --raw --out "$out.tmp"
mv "$out.tmp" "$out"

find "$dir" -name 'export-*.json' -mtime +"$days" -delete
