#!/bin/bash

# Configuration
LAN_IF="br0"  # Listen on the Bridge
PORTAL_IP="${1:-10.0.0.1}"

# Calculate DHCP Range based on IP (Assumes /24)
PREFIX=$(echo $PORTAL_IP | cut -d'.' -f1-3)
DHCP_RANGE="${PREFIX}.10,${PREFIX}.250,12h"

# 1. Ensure Bridge IP is set (Redundant safety check)
# Wait for interface to be ready (Max 10s)
for i in {1..10}; do
    if ip addr show $LAN_IF | grep -q $PORTAL_IP; then
        echo "Interface $LAN_IF is ready with IP $PORTAL_IP"
        break
    fi
    echo "Waiting for $LAN_IF to have IP $PORTAL_IP... ($i/10)"
    ip addr add $PORTAL_IP/24 dev $LAN_IF 2>/dev/null
    ip link set $LAN_IF up 2>/dev/null
    sleep 1
done

# 2. Stop conflicting services (systemd-resolved)
systemctl stop systemd-resolved
systemctl disable systemd-resolved
# Unlink resolv.conf if it points to systemd-resolved
if [ -L /etc/resolv.conf ]; then
    rm /etc/resolv.conf
    echo "nameserver 8.8.8.8" > /etc/resolv.conf
fi

# 3. Create Dnsmasq Config

# Cleanup stale VLAN configs (prevent startup errors)
# Only remove vlan_*.conf to preserve other custom configs (like Walled Garden)
rm -f /etc/dnsmasq.d/vlan_*.conf

cat > /etc/dnsmasq.conf <<EOF
# Run as root to allow ipset updates
user=root
# Listen on Bridge and allow other interfaces via config files
interface=$LAN_IF
bind-dynamic
dhcp-range=$DHCP_RANGE
dhcp-authoritative
domain-needed
bogus-priv
# Do NOT resolve everything to portal. Allow real DNS resolution.
# address=/#/$PORTAL_IP
# Only resolve local portal domain to local IP
address=/pisowifi.local/$PORTAL_IP
address=/portal/$PORTAL_IP
server=8.8.8.8
server=8.8.4.4
domain=pisowifi.local
dhcp-option=3,$PORTAL_IP
dhcp-option=6,$PORTAL_IP
# RFC 8908 Captive Portal API
dhcp-option=114,http://$PORTAL_IP/portal
conf-dir=/etc/dnsmasq.d
log-queries
log-dhcp
EOF

# Ensure config directory exists
mkdir -p /etc/dnsmasq.d

# 4. Restart Dnsmasq
echo "Validating Dnsmasq config..."
dnsmasq --test
if [ $? -ne 0 ]; then
    echo "Dnsmasq config check failed!"
    exit 1
fi

echo "Stopping existing Dnsmasq instances..."
killall dnsmasq 2>/dev/null || true
sleep 1

echo "Starting Dnsmasq..."
systemctl restart dnsmasq || /etc/init.d/dnsmasq restart

echo "DNSmasq initialized on $LAN_IF. All DNS queries redirected to $PORTAL_IP"
