#!/bin/sh
# Run config history pruning and log the result.
# Designed for use with cron — sources .env, then runs the prune command.
#
# Note: OPNsense 26.x does not expose a config backup REST API.
# This script will print the web UI URL instead of pruning.
# Manage config history at: Diagnostics → Configuration History
#
# Required env vars (or set via .env):
#   OPNSENSE_HOST, OPNSENSE_API_KEY, OPNSENSE_API_SECRET
#
# Optional env vars:
#   KEEP_LAST    - keep this many most-recent revisions (default: 20)
#   OLDER_THAN   - delete revisions older than this many days
#   LOG_FILE     - where to append output (default: /tmp/opnsense-config-prune.log)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="${LOG_FILE:-/tmp/opnsense-config-prune.log}"

# Load .env if present
if [ -f "$PROJECT_ROOT/.env" ]; then
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
fi

KEEP_LAST="${KEEP_LAST:-20}"
OLDER_THAN="${OLDER_THAN:-}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }

log "Starting config history prune (keep_last=$KEEP_LAST${OLDER_THAN:+, older_than=${OLDER_THAN}d})"

ARGS=""
if [ -n "$KEEP_LAST" ];  then ARGS="$ARGS --keep-last $KEEP_LAST"; fi
if [ -n "$OLDER_THAN" ]; then ARGS="$ARGS --older-than $OLDER_THAN"; fi

# shellcheck disable=SC2086
node "$PROJECT_ROOT/cli.js" config:history-prune $ARGS 2>&1 | tee -a "$LOG_FILE"

log "Done."
