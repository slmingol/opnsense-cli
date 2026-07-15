#!/bin/sh
# ProtonVPN WireGuard watchdog (cron one-shot, run every minute)
# Proactively resets the WireGuard peer before WG REKEY_AFTER_TIME (120s)
# to avoid simultaneous-initiation deadlock with ProtonVPN servers.
#
# When GW is down: removes the peer to silence Handshake Initiations
# (prevents server-side rate limiting). Attempts one reset every DOWN_BACKOFF
# seconds — giving the server true silence between attempts.
#
# Deploy: copy to OPNsense router, add cron via System → Settings → Cron

WG_IFACE="tun_wg1"
GW_NAME="PROTONVPN_GW"
RESET_FILE="/var/db/protonvpn-wg-last-reset"
DOWN_FILE="/var/db/protonvpn-wg-down-since"
PEER_CONF="/var/db/protonvpn-wg-peer.conf"
MAX_SESSION=85
DOWN_BACKOFF=300

NOW=$(date +%s)

GW_STATUS=$(php -r "
require_once('/usr/local/etc/inc/plugins.inc.d/gateway.inc');
require_once('/usr/local/etc/inc/gwlb.inc');
\$gws = return_gateways_status(true);
echo \$gws['${GW_NAME}']['status'] ?? 'unknown';
" 2>/dev/null)

if [ -f "$RESET_FILE" ]; then
    LAST=$(cat "$RESET_FILE")
    AGE=$((NOW - LAST))
else
    AGE=9999
fi

get_peer_info() {
    PEER_PK=$(wg show "$WG_IFACE" peers 2>/dev/null | head -1)
    ENDPOINT=$(wg show "$WG_IFACE" endpoints 2>/dev/null | awk '{print $2}')
    if [ -z "$PEER_PK" ] || [ -z "$ENDPOINT" ]; then
        if [ -f "$PEER_CONF" ]; then
            . "$PEER_CONF"
        else
            return 1
        fi
    fi
    return 0
}

remove_peer() {
    local pk
    pk=$(wg show "$WG_IFACE" peers 2>/dev/null | head -1)
    [ -z "$pk" ] && return 0
    local ep_ip
    ep_ip=$(wg show "$WG_IFACE" endpoints 2>/dev/null | awk '{print $2}' | cut -d: -f1)
    [ -n "$ep_ip" ] && pfctl -k "$ep_ip" 2>/dev/null
    wg set "$WG_IFACE" peer "$pk" remove 2>/dev/null
}

do_reset() {
    get_peer_info || { logger -t protonvpn-watchdog "no peer info, cannot reset"; return 1; }
    local ep_ip
    ep_ip=$(echo "$ENDPOINT" | cut -d: -f1)
    [ -n "$ep_ip" ] && pfctl -k "$ep_ip" 2>/dev/null
    wg set "$WG_IFACE" peer "$PEER_PK" remove 2>/dev/null
    wg set "$WG_IFACE" peer "$PEER_PK" \
        endpoint "$ENDPOINT" \
        allowed-ips "0.0.0.0/0,::/0" \
        persistent-keepalive 25
    printf "PEER_PK=%s\nENDPOINT=%s\nALLOWED_IPS=0.0.0.0/0,::/0\n" \
        "$PEER_PK" "$ENDPOINT" > "$PEER_CONF"
    chmod 600 "$PEER_CONF"
    echo "$NOW" > "$RESET_FILE"
}

if [ "$GW_STATUS" = "online" ]; then
    rm -f "$DOWN_FILE"
    if [ "$AGE" -gt "$MAX_SESSION" ]; then
        logger -t protonvpn-watchdog "proactive reset: age=${AGE}s"
        do_reset && logger -t protonvpn-watchdog "proactive reset complete"
    fi
else
    # GW is down — remove peer to silence Initiations, use backoff
    if [ ! -f "$DOWN_FILE" ]; then
        remove_peer
        echo "$NOW" > "$DOWN_FILE"
        logger -t protonvpn-watchdog "GW down: peer removed, backoff started"
        exit 0
    fi

    DOWN_SINCE=$(cat "$DOWN_FILE")
    DOWN_AGE=$((NOW - DOWN_SINCE))

    if [ "$DOWN_AGE" -lt "$DOWN_BACKOFF" ]; then
        # In backoff — keep peer removed so server gets true silence
        remove_peer
        exit 0
    fi

    # 300s backoff expired — attempt one fresh handshake
    logger -t protonvpn-watchdog "reactive reset after ${DOWN_AGE}s down"
    do_reset && logger -t protonvpn-watchdog "reactive reset: peer re-added, awaiting handshake"
    # Reset DOWN_FILE: next cron removes peer if handshake fails,
    # giving server another 300s of silence before next attempt.
    echo "$NOW" > "$DOWN_FILE"
fi
