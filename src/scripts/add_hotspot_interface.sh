#!/bin/bash

# add_hotspot_interface.sh
# Configures a network interface to act as a Hotspot (Captive Portal Gatekeeper)
# Usage: ./add_hotspot_interface.sh <INTERFACE> <PORTAL_IP>

IFACE=$1
PORTAL_IP=$2
CIDR=$3
INTERNET_UP=$4
PORTAL_PORT="3000"

if [ -z "$IFACE" ] || [ -z "$PORTAL_IP" ]; then
    echo "Usage: $0 <interface> <portal_ip> [cidr]"
    exit 1
fi

# Default CIDR to 24 if not provided
if [ -z "$CIDR" ]; then
    CIDR="24"
fi

echo "Configuring Hotspot rules for $IFACE ($PORTAL_IP/$CIDR)..."

enable_redirect="auto"
if [ "$INTERNET_UP" = "1" ]; then
    enable_redirect="yes"
elif [ "$INTERNET_UP" = "0" ]; then
    enable_redirect="no"
else
    if ping -c 1 -W 1 8.8.8.8 >/dev/null 2>&1; then
        enable_redirect="yes"
    else
        enable_redirect="no"
    fi
fi

# Ensure IP forwarding is enabled (needed for NAT and captive portal flows)
sysctl -w net.ipv4.ip_forward=1 > /dev/null 2>&1 || true
echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null || true

# 0. Ensure Interface has IP and is UP
ip link set $IFACE up
# Enable route_localnet to allow redirection to localhost
# Use /proc/sys directly to handle interface names with dots (e.g. enp1s0.300) safely
if [ -f "/proc/sys/net/ipv4/conf/$IFACE/route_localnet" ]; then
    echo 1 > "/proc/sys/net/ipv4/conf/$IFACE/route_localnet"
else
    sysctl -w net.ipv4.conf.$IFACE.route_localnet=1 > /dev/null 2>&1
fi

# Check if IP is already assigned
if ! ip addr show $IFACE | grep -q "$PORTAL_IP"; then
    echo "Assigning IP $PORTAL_IP/$CIDR to $IFACE..."
    ip addr add $PORTAL_IP/$CIDR dev $IFACE 2>/dev/null || true
else
    echo "IP $PORTAL_IP already assigned to $IFACE."
fi

# ============================================
# CRITICAL: Ensure internet_users chain exists
# This chain is normally created by init_firewall.sh
# But for VLANs added later, we need to ensure it exists
# ============================================
if ! iptables -t mangle -L internet_users -n 2>/dev/null; then
    echo "Creating internet_users chain in mangle table..."
    iptables -t mangle -N internet_users 2>/dev/null || true
fi

# ============================================
# CRITICAL: Ensure FORWARD allows mark 99 traffic
# Without this, authorized clients can't access internet
# ============================================
if ! iptables -C FORWARD -m mark --mark 99 -j ACCEPT 2>/dev/null; then
    echo "Adding FORWARD ACCEPT rule for authorized users (mark 99)..."
    iptables -A FORWARD -m mark --mark 99 -j ACCEPT
fi

# ============================================
# CRITICAL: Ensure ESTABLISHED/RELATED traffic is allowed
# This allows return traffic for active connections
# ============================================
if ! iptables -C FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null; then
    echo "Adding FORWARD rule for ESTABLISHED/RELATED traffic..."
    iptables -I FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
fi

# 1. Add to Internet Users Chain (Packet Marking check)
# Check if rule already exists to avoid duplicates
if ! iptables -t mangle -C PREROUTING -i $IFACE -j internet_users 2>/dev/null; then
    echo "Adding $IFACE to internet_users chain..."
    iptables -t mangle -A PREROUTING -i $IFACE -j internet_users
fi

# 1.1 Enable NAT for this subnet (Crucial for VLANs if global WAN NAT misses them)
if ! iptables -t nat -C POSTROUTING -s $PORTAL_IP/$CIDR ! -d $PORTAL_IP/$CIDR -j MASQUERADE 2>/dev/null; then
    echo "Enabling NAT for subnet $PORTAL_IP/$CIDR..."
    iptables -t nat -A POSTROUTING -s $PORTAL_IP/$CIDR ! -d $PORTAL_IP/$CIDR -j MASQUERADE
fi

# 2. DNS Interception (Force all DNS to local dnsmasq)
if ! iptables -t nat -C PREROUTING -i $IFACE -p udp --dport 53 -j DNAT --to-destination $PORTAL_IP:53 2>/dev/null; then
    iptables -t nat -A PREROUTING -i $IFACE -p udp --dport 53 -j DNAT --to-destination $PORTAL_IP:53
fi
if ! iptables -t nat -C PREROUTING -i $IFACE -p tcp --dport 53 -j DNAT --to-destination $PORTAL_IP:53 2>/dev/null; then
    iptables -t nat -A PREROUTING -i $IFACE -p tcp --dport 53 -j DNAT --to-destination $PORTAL_IP:53
fi

# 3. HTTP Redirection (Captive Portal)
# Redirect HTTP requests from unauthorized users (no mark 99) to Portal
if [ "$enable_redirect" = "yes" ]; then
    if ! iptables -t nat -C PREROUTING -i $IFACE -p tcp --dport 80 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT 2>/dev/null; then
        echo "Adding HTTP redirect rule for $IFACE..."
        iptables -t nat -A PREROUTING -i $IFACE -p tcp --dport 80 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT
    fi
else
    while iptables -t nat -C PREROUTING -i $IFACE -p tcp --dport 80 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT 2>/dev/null; do
        iptables -t nat -D PREROUTING -i $IFACE -p tcp --dport 80 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT 2>/dev/null || break
    done
fi

# Redirect explicit requests to the Gateway IP to Portal Port
if ! iptables -t nat -C PREROUTING -i $IFACE -d $PORTAL_IP -p tcp --dport 80 -j REDIRECT --to-port $PORTAL_PORT 2>/dev/null; then
    iptables -t nat -A PREROUTING -i $IFACE -d $PORTAL_IP -p tcp --dport 80 -j REDIRECT --to-port $PORTAL_PORT
fi

# 3.1 HTTPS Redirection for captive portal detection
# Many modern browsers/devices check HTTPS first - redirect to portal
if [ "$enable_redirect" = "yes" ]; then
    if ! iptables -t nat -C PREROUTING -i $IFACE -p tcp --dport 443 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT 2>/dev/null; then
        echo "Adding HTTPS redirect rule for $IFACE..."
        iptables -t nat -A PREROUTING -i $IFACE -p tcp --dport 443 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT
    fi
else
    while iptables -t nat -C PREROUTING -i $IFACE -p tcp --dport 443 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT 2>/dev/null; do
        iptables -t nat -D PREROUTING -i $IFACE -p tcp --dport 443 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT 2>/dev/null || break
    done
fi

# 4. Input Access (Allow DNS and Portal)
if ! iptables -C INPUT -i $IFACE -p udp --dport 53 -j ACCEPT 2>/dev/null; then
    iptables -A INPUT -i $IFACE -p udp --dport 53 -j ACCEPT
fi
if ! iptables -C INPUT -i $IFACE -p tcp --dport 53 -j ACCEPT 2>/dev/null; then
    iptables -A INPUT -i $IFACE -p tcp --dport 53 -j ACCEPT
fi
if ! iptables -C INPUT -i $IFACE -p tcp --dport $PORTAL_PORT -j ACCEPT 2>/dev/null; then
    iptables -A INPUT -i $IFACE -p tcp --dport $PORTAL_PORT -j ACCEPT
fi
if ! iptables -C INPUT -i $IFACE -p tcp --dport 80 -j ACCEPT 2>/dev/null; then
    iptables -A INPUT -i $IFACE -p tcp --dport 80 -j ACCEPT
fi
if ! iptables -C INPUT -i $IFACE -p tcp --dport 443 -j ACCEPT 2>/dev/null; then
    iptables -A INPUT -i $IFACE -p tcp --dport 443 -j ACCEPT
fi

# 5. Drop Unauthorized Forwarding (Walled Garden Enforcement)
# Insert near the top so it can't be bypassed by later custom ACCEPT rules.
# For br0, keep position 2 so any pre-inserted allow rules (e.g. walled garden ACCEPT) can stay at position 1.
DROP_POS=1
if [ "$IFACE" = "br0" ]; then
    DROP_POS=2
fi
while iptables -C FORWARD -i $IFACE -m mark ! --mark 99 -j DROP 2>/dev/null; do
    iptables -D FORWARD -i $IFACE -m mark ! --mark 99 -j DROP 2>/dev/null || break
done
echo "Adding walled garden DROP rule for $IFACE (insert at $DROP_POS)..."
iptables -I FORWARD $DROP_POS -i $IFACE -m mark ! --mark 99 -j DROP

echo "Hotspot rules applied for $IFACE."
echo "  - DNS interception: YES"
echo "  - HTTP redirect: $([ "$enable_redirect" = "yes" ] && echo YES || echo NO)"
echo "  - HTTPS redirect: $([ "$enable_redirect" = "yes" ] && echo YES || echo NO)"
echo "  - NAT/Masquerade: YES"
echo "  - Walled Garden: YES"
