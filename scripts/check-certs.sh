#!/bin/sh
# Run cert expiry check and log the result.
# Designed for use with cron — sources .env, then runs cert:check.
#
# Required env vars (or set via .env):
#   OPNSENSE_HOST, OPNSENSE_API_KEY, OPNSENSE_API_SECRET
#
# Optional env vars:
#   EXPIRING  - days threshold (default: 30)
#   LOG_FILE  - where to append output (default: /tmp/opnsense-cert-check.log)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="${LOG_FILE:-/tmp/opnsense-cert-check.log}"

if [ -f "$PROJECT_ROOT/.env" ]; then
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
fi

EXPIRING="${EXPIRING:-30}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }

log "Starting cert check (expiring within ${EXPIRING}d)"

node "$PROJECT_ROOT/cli.js" cert:check --expiring "$EXPIRING" 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]:-$?}

if [ "$EXIT_CODE" -eq 0 ]; then
  log "All certs OK."
else
  log "WARNING: one or more certs expire within ${EXPIRING} days!"
fi

exit "$EXIT_CODE"
