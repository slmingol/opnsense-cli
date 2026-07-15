#!/bin/sh
# Wildcard cert renewal via acme.sh + opnsense-cli import
#
# Usage:
#   DOMAIN=lamolabs.org CERT_NAME=wildcard-lamolabs make cert-renew-wildcard
#   or run directly:
#   ./scripts/renew-wildcard-cert.sh
#
# Required env vars:
#   DOMAIN      - base domain (e.g. lamolabs.org) — cert will be *.DOMAIN
#   CERT_NAME   - name to use in OPNsense certificate manager
#
# Optional env vars:
#   ACME_SH     - path to acme.sh (default: ~/.acme.sh/acme.sh)
#   ACME_HOME   - acme.sh home dir (default: ~/.acme.sh)
#   STAGING     - set to 1 to use Let's Encrypt staging (for testing)
#   DNS_HOOK    - acme.sh DNS plugin (default: dns_cf for Cloudflare)
#                 Other examples: dns_aws, dns_gd (GoDaddy), dns_nsone
#
# DNS provider credentials (passed through to acme.sh as env vars):
#   For Cloudflare:  CF_Token, CF_Account_ID (or CF_Key + CF_Email)
#   For Route53:     AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#   See: https://github.com/acmesh-official/acme.sh/wiki/dnsapi

set -e

DOMAIN="${DOMAIN:?DOMAIN is required (e.g. lamolabs.org)}"
CERT_NAME="${CERT_NAME:?CERT_NAME is required (name in OPNsense cert manager)}"
ACME_SH="${ACME_SH:-$HOME/.acme.sh/acme.sh}"
ACME_HOME="${ACME_HOME:-$HOME/.acme.sh}"
DNS_HOOK="${DNS_HOOK:-dns_cf}"
WILDCARD="*.$DOMAIN"

CERT_DIR="$ACME_HOME/$WILDCARD"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

# ---------------------------------------------------------------------------
# 1. Verify acme.sh is installed
# ---------------------------------------------------------------------------
if [ ! -x "$ACME_SH" ]; then
  log "ERROR: acme.sh not found at $ACME_SH"
  log "Install: curl https://get.acme.sh | sh"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Issue or renew the wildcard cert
# ---------------------------------------------------------------------------
log "Renewing $WILDCARD via $DNS_HOOK ..."

STAGING_FLAG=""
[ "${STAGING:-0}" = "1" ] && STAGING_FLAG="--staging"

"$ACME_SH" --issue \
  --dns "$DNS_HOOK" \
  -d "$WILDCARD" \
  -d "$DOMAIN" \
  --home "$ACME_HOME" \
  $STAGING_FLAG \
  || {
    # acme.sh exits 2 when cert is not yet due for renewal — treat as success
    code=$?
    [ $code -eq 2 ] && log "Cert not yet due for renewal — still valid." && exit 0
    log "ERROR: acme.sh failed (exit $code)"
    exit $code
  }

# ---------------------------------------------------------------------------
# 3. Locate the issued cert and key
# ---------------------------------------------------------------------------
CERT_FILE="$CERT_DIR/$WILDCARD.cer"
KEY_FILE="$CERT_DIR/$WILDCARD.key"

if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  log "ERROR: cert/key not found in $CERT_DIR"
  log "Expected: $CERT_FILE"
  log "          $KEY_FILE"
  exit 1
fi

log "Cert:  $CERT_FILE"
log "Key:   $KEY_FILE"

# ---------------------------------------------------------------------------
# 4. Import into OPNsense via opnsense-cli
# ---------------------------------------------------------------------------
log "Importing $CERT_NAME into OPNsense ..."

# Resolve project root relative to this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

node "$PROJECT_ROOT/cli.js" cert:import \
  --name "$CERT_NAME" \
  --cert "$CERT_FILE" \
  --key  "$KEY_FILE"

log "Import complete."

# ---------------------------------------------------------------------------
# 5. Optional: reload HAProxy so the new cert takes effect immediately
#    Uncomment if your HAProxy frontend references this cert by name.
# ---------------------------------------------------------------------------
# log "Reloading HAProxy ..."
# node "$PROJECT_ROOT/cli.js" haproxy:reload  # add this command if needed

log "Done. Verify in OPNsense: System → Trust → Certificates"
