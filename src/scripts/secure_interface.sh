#!/bin/bash
# Secure a LAN Interface (VLAN or Bridge)
# Usage: secure_interface.sh <iface> <portal_ip> <portal_port>
# This script is IDEMPOTENT (safe to run multiple times)

IFACE=$1
PORTAL_IP=$2
PORTAL_PORT=$3

if [ -z "$IFACE" ] || [ -z "$PORTAL_IP" ] || [ -z "$PORTAL_PORT" ]; then
    echo "Usage: $0 <iface> <portal_ip> <portal_port>"
    exit 1
fi

# Helper to add rule only if it doesn't exist
ensure_rule() {
    local table=$1
    local chain=$2
    shift 2
    local rule="$@"
    
    iptables -t $table -C $chain $rule 2>/dev/null
    if [ $? -ne 0 ]; then
        iptables -t $table -A $chain $rule
        # echo "Added rule: -t $table -A $chain $rule"
    fi
}

echo "Securing Interface: $IFACE"

# Ensure required chains exist (idempotent)
iptables -t mangle -L internet_users >/dev/null 2>&1
if [ $? -ne 0 ]; then
    iptables -t mangle -N internet_users 2>/dev/null || true
fi
iptables -L traffic_acct >/dev/null 2>&1
if [ $? -ne 0 ]; then
    iptables -N traffic_acct 2>/dev/null || true
    # Ensure it is hooked to FORWARD
    iptables -C FORWARD -j traffic_acct 2>/dev/null || iptables -I FORWARD -j traffic_acct
fi

# 1. Mangle - Capture traffic for accounting & authorization
ensure_rule mangle PREROUTING -i $IFACE -j internet_users

# 2. NAT - DNS Interception (Force all DNS to local)
ensure_rule nat PREROUTING -i $IFACE -p udp --dport 53 -j DNAT --to-destination $PORTAL_IP:53
ensure_rule nat PREROUTING -i $IFACE -p tcp --dport 53 -j DNAT --to-destination $PORTAL_IP:53

# 3. NAT - HTTP Redirection (Captive Portal)
# Redirect HTTP requests (TCP 80) from UNMARKED (unauthorized) packets to the local portal
ensure_rule nat PREROUTING -i $IFACE -p tcp --dport 80 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT

# Redirect DIRECT requests to Portal IP
ensure_rule nat PREROUTING -i $IFACE -d $PORTAL_IP -p tcp --dport 80 -j REDIRECT --to-port $PORTAL_PORT

# 4. Filter - Allow DNS & Portal Access
ensure_rule filter INPUT -i $IFACE -p udp --dport 53 -j ACCEPT
ensure_rule filter INPUT -i $IFACE -p tcp --dport 53 -j ACCEPT
ensure_rule filter INPUT -i $IFACE -p tcp --dport $PORTAL_PORT -j ACCEPT

# 5. Filter - Drop unauthorized traffic (Walled Garden)
ensure_rule filter FORWARD -i $IFACE -m mark ! --mark 99 -j DROP

echo "Interface $IFACE Secured."
