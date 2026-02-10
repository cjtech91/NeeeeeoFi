#!/bin/bash

# add_hotspot_interface.sh
# Configures a network interface to act as a Hotspot (Captive Portal Gatekeeper)
# Usage: ./add_hotspot_interface.sh <INTERFACE> <PORTAL_IP>

IFACE=$1
PORTAL_IP=$2
CIDR=$3
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
    ip addr add $PORTAL_IP/$CIDR dev $IFACE
else
    echo "IP $PORTAL_IP already assigned to $IFACE."
fi

# 1. Add to Internet Users Chain (Packet Marking check)
# Check if rule already exists to avoid duplicates
if ! iptables -t mangle -C PREROUTING -i $IFACE -j internet_users 2>/dev/null; then
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
if ! iptables -t nat -C PREROUTING -i $IFACE -p tcp --dport 80 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT 2>/dev/null; then
    iptables -t nat -A PREROUTING -i $IFACE -p tcp --dport 80 -m mark ! --mark 99 -j REDIRECT --to-port $PORTAL_PORT
fi

# Redirect explicit requests to the Gateway IP to Portal Port
if ! iptables -t nat -C PREROUTING -i $IFACE -d $PORTAL_IP -p tcp --dport 80 -j REDIRECT --to-port $PORTAL_PORT 2>/dev/null; then
    iptables -t nat -A PREROUTING -i $IFACE -d $PORTAL_IP -p tcp --dport 80 -j REDIRECT --to-port $PORTAL_PORT
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

# 5. Drop Unauthorized Forwarding (Walled Garden Enforcement)
if ! iptables -C FORWARD -i $IFACE -m mark ! --mark 99 -j DROP 2>/dev/null; then
    iptables -A FORWARD -i $IFACE -m mark ! --mark 99 -j DROP
fi

echo "Hotspot rules applied for $IFACE."
