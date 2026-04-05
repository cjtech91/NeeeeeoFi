#!/bin/bash

# Configuration
# Use first argument as WAN_IF, default to eth0 if not set
WAN_IF="${1:-eth0}"      
# Use second argument as PORTAL_IP, default to 10.0.0.1
PORTAL_IP="${2:-10.0.0.1}"

# Calculate Subnet (Assume /24) - e.g. 10.0.0.1 -> 10.0.0.0/24
SUBNET="${PORTAL_IP%.*}.0/24"

LAN_IF="br0"     # Use the Bridge Interface
PORTAL_PORT="3000"

echo "Initializing Firewall with WAN: $WAN_IF and LAN: $LAN_IF"

# 1. Enable IP Forwarding
# Critical for routing traffic between LAN and WAN
sysctl -w net.ipv4.ip_forward=1 > /dev/null
echo 1 > /proc/sys/net/ipv4/ip_forward

# 2. Flush existing rules
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X

# Set Default Policies
iptables -P INPUT ACCEPT
iptables -P OUTPUT ACCEPT
iptables -P FORWARD DROP

# 3. Create a chain for authorized users
iptables -t mangle -N internet_users

# 3.1 Create a chain for traffic accounting
# We use the FILTER table's FORWARD chain for this, as it sees packets in both directions after routing decision
iptables -N traffic_acct
iptables -I FORWARD -j traffic_acct

# 4. Allow authorized users (MARK packets with 99)
# Users added to this chain will be marked as "Authorized"
# The default policy of this chain is to return (do nothing), effectively blocking unless matched.

# 5. NAT (Masquerade) - Share internet from WAN to LAN
# Enable Source NAT for outbound traffic from our subnet (10.0.0.0/24)
# This is more robust than specifying -o $WAN_IF because it works even if WAN changes
iptables -t nat -A POSTROUTING -s $SUBNET ! -d $SUBNET -j MASQUERADE

# Backup rule: Masquerade anything going out the WAN interface (just in case)
iptables -t nat -A POSTROUTING -o $WAN_IF -j MASQUERADE

# 5.1 Ensure Established connections are always allowed (Performance + Reliability)
iptables -A FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# 5.2 Allow Authorized Users (Marked with 99)
iptables -A FORWARD -m mark --mark 99 -j ACCEPT

# 6. Apply Security Rules to LAN Interface (br0)
bash $(dirname "$0")/secure_interface.sh $LAN_IF $PORTAL_IP $PORTAL_PORT

# 7. Redirect HTTP (80) traffic destined for ANY local IP (WAN/VPN/LAN) to Portal Port (3000)
# This allows remote access via http://<ip>/admin without :3000
iptables -t nat -A PREROUTING -p tcp --dport 80 -m addrtype --dst-type LOCAL -j REDIRECT --to-port $PORTAL_PORT

# 7.1 Explicitly Allow Remote Access (SSH & Portal) from ANY Interface (WAN/ZeroTier)
# This ensures you can manage the system remotely even if default policy changes
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --dport $PORTAL_PORT -j ACCEPT

echo "Firewall initialized. Walled Garden active."
