#!/usr/bin/env bash
# Asks the dashboard to re-read the state of every open upstream thread from GitHub.
# Run every 15 minutes by giveback-refresh.timer. Lakebed has no scheduler of its own.
#
# The site URL and the refresh secret come from ~/.config/j5-giveback/env
# (or GIVEBACK_ENV_FILE), which scripts/giveback reads itself.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
giveback refresh
