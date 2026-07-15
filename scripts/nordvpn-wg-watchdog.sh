#!/bin/sh
# NordVPN WireGuard watchdog (cron one-shot, run every minute)
# Proactively resets the WireGuard peer before WG REKEY_AFTER_TIME (120s)
# to avoid simultaneous-initiation deadlock.
#
# When GW is down: removes the peer to silence Handshake Initiations
# (prevents server-side rate limiting). Attempts one reset every DOWN_BACKOFF
# seconds — giving the server true silence between attempts.
#
# Escalation: if the GW stays down for more than ESCALATION_TIME seconds
# (default: 600 = 10 min), fetches a new NordVPN server from the public API
# and rotates to it directly — no operator intervention required.
#
# Deploy: copy to OPNsense router, add cron via System → Settings → Cron

WG_IFACE="tun_wg1"
WG_GW="10.5.0.1"       # tun_wg1 peer-side gateway IP
MONITOR_IP="1.1.1.1"   # dpinger monitor target for NORDVPNWG_GW
GW_NAME="NORDVPNWG_GW"
COUNTRY_ID="228"
RESET_FILE="/var/db/nordvpn-wg-last-reset"
DOWN_FILE="/var/db/nordvpn-wg-down-since"
ESCALATE_FILE="/var/db/nordvpn-wg-last-escalation"
PEER_CONF="/var/db/nordvpn-wg-peer.conf"
MAX_SESSION=85
DOWN_BACKOFF=300
ESCALATION_TIME=500

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

# Ensure the host route for the GW monitor IP exists through the WG tunnel.
# OPNsense adds this on WG apply but direct wg set calls don't trigger it.
# Without it dpinger routes probes via WAN and always sees 100% loss.
ensure_monitor_route() {
    netstat -rn | grep -q "^${MONITOR_IP}" && return 0
    route add -host "$MONITOR_IP" "$WG_GW" 2>/dev/null \
        && logger -t nordvpn-watchdog "monitor route added: ${MONITOR_IP} via ${WG_GW}"
}

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
    get_peer_info || { logger -t nordvpn-watchdog "no peer info, cannot reset"; return 1; }
    local ep_ip
    ep_ip=$(echo "$ENDPOINT" | cut -d: -f1)
    [ -n "$ep_ip" ] && pfctl -k "$ep_ip" 2>/dev/null
    wg set "$WG_IFACE" peer "$PEER_PK" remove 2>/dev/null
    wg set "$WG_IFACE" peer "$PEER_PK" \
        endpoint "$ENDPOINT" \
        allowed-ips "0.0.0.0/0,::/0" \
        persistent-keepalive 25
    ensure_monitor_route
    printf "PEER_PK=%s\nENDPOINT=%s\nALLOWED_IPS=0.0.0.0/0,::/0\n" \
        "$PEER_PK" "$ENDPOINT" > "$PEER_CONF"
    chmod 600 "$PEER_CONF"
    echo "$NOW" > "$RESET_FILE"
}

# Fetch lowest-load NordVPN WireGuard server from public API.
# Uses curl (available on OPNsense) + PHP for JSON parsing.
# Writes NEW_IP and NEW_PK variables on success; returns 1 on failure.
fetch_best_server() {
    local json url
    url="https://api.nordvpn.com/v1/servers?filters%5Bservers_groups%5D%5Bidentifier%5D=legacy_nordlynx&filters%5Bservers_countries%5D%5Bid%5D=${COUNTRY_ID}&limit=20"
    json=$(fetch -qo - "$url" 2>/dev/null) || return 1

    local result
    result=$(echo "$json" | php -r "
\$servers = json_decode(stream_get_contents(STDIN), true);
if (!is_array(\$servers)) exit(1);
usort(\$servers, function(\$a, \$b) { return \$a['load'] - \$b['load']; });
foreach (\$servers as \$s) {
    \$ip = \$s['station'] ?? '';
    \$pk = '';
    foreach (\$s['technologies'] ?? [] as \$t) {
        if (\$t['identifier'] === 'wireguard_udp') {
            foreach (\$t['metadata'] ?? [] as \$m) {
                if (\$m['name'] === 'public_key') { \$pk = \$m['value']; }
            }
        }
    }
    if (\$ip && \$pk) { echo \$ip . ' ' . \$pk; exit(0); }
}
exit(1);
" 2>/dev/null) || return 1

    NEW_IP=$(echo "$result" | awk '{print $1}')
    NEW_PK=$(echo "$result" | awk '{print $2}')
    [ -n "$NEW_IP" ] && [ -n "$NEW_PK" ]
}

# Escalate: rotate to a new NordVPN server fetched from the public API.
do_escalate() {
    logger -t nordvpn-watchdog "escalation: fetching new server from NordVPN API"

    if ! fetch_best_server; then
        logger -t nordvpn-watchdog "escalation failed: could not fetch server list"
        return 1
    fi

    local old_pk
    old_pk=$(wg show "$WG_IFACE" peers 2>/dev/null | head -1)
    [ -n "$old_pk" ] && [ "$old_pk" != "$NEW_PK" ] && {
        pfctl -k "$(wg show "$WG_IFACE" endpoints 2>/dev/null | awk '{print $2}' | cut -d: -f1)" 2>/dev/null
        wg set "$WG_IFACE" peer "$old_pk" remove 2>/dev/null
    }

    wg set "$WG_IFACE" peer "$NEW_PK" \
        endpoint "${NEW_IP}:51820" \
        allowed-ips "0.0.0.0/0,::/0" \
        persistent-keepalive 25
    ensure_monitor_route

    printf "PEER_PK=%s\nENDPOINT=%s:51820\nALLOWED_IPS=0.0.0.0/0,::/0\n" \
        "$NEW_PK" "$NEW_IP" > "$PEER_CONF"
    chmod 600 "$PEER_CONF"

    echo "$NOW" > "$RESET_FILE"
    echo "$NOW" > "$ESCALATE_FILE"
    echo "$NOW" > "$DOWN_FILE"  # reset timer — give new server ESCALATION_TIME before next escalation

    logger -t nordvpn-watchdog "escalation complete: new endpoint ${NEW_IP}:51820 (pk=${NEW_PK})"
}

if [ "$GW_STATUS" = "online" ]; then
    rm -f "$DOWN_FILE"
    ensure_monitor_route
    if [ "$AGE" -gt "$MAX_SESSION" ]; then
        logger -t nordvpn-watchdog "proactive reset: age=${AGE}s"
        do_reset && logger -t nordvpn-watchdog "proactive reset complete"
    fi
else
    # GW is down — remove peer to silence Initiations, use backoff
    if [ ! -f "$DOWN_FILE" ]; then
        remove_peer
        echo "$NOW" > "$DOWN_FILE"
        echo "$NOW" > "$RESET_FILE"
        logger -t nordvpn-watchdog "GW down: peer removed, backoff started"
        exit 0
    fi

    DOWN_SINCE=$(cat "$DOWN_FILE")
    DOWN_AGE=$((NOW - DOWN_SINCE))

    # Escalation check: if down longer than ESCALATION_TIME, rotate server.
    # DOWN_FILE is never reset during reactive resets so this accumulates correctly.
    if [ "$DOWN_AGE" -ge "$ESCALATION_TIME" ]; then
        logger -t nordvpn-watchdog "GW down ${DOWN_AGE}s — escalating to new server"
        do_escalate
        exit 0
    fi

    # Use AGE (time since RESET_FILE) for the per-attempt backoff,
    # not DOWN_AGE — keeps escalation and backoff timers independent.
    if [ "$AGE" -lt "$DOWN_BACKOFF" ]; then
        # Grace period: if we just escalated, keep the new peer up so the GW
        # monitor has time to register recovery (takes ~30-60s). Without this,
        # the next cron run removes the freshly-set escalation peer before
        # OPNsense can declare the gateway online.
        if [ -f "$ESCALATE_FILE" ]; then
            ESC_AGE=$(( NOW - $(cat "$ESCALATE_FILE") ))
            if [ "$ESC_AGE" -lt "$DOWN_BACKOFF" ]; then
                exit 0
            fi
        fi
        # In backoff — keep peer removed so server gets true silence
        remove_peer
        exit 0
    fi

    # Backoff expired — attempt one fresh handshake.
    # Do NOT reset DOWN_FILE so escalation timer keeps accumulating.
    logger -t nordvpn-watchdog "reactive reset after ${DOWN_AGE}s down (${AGE}s since last reset)"
    do_reset && logger -t nordvpn-watchdog "reactive reset: peer re-added, awaiting handshake"
fi
