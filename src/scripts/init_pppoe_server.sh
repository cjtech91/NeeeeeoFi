#!/bin/bash

# PPPoE Server Control Script
# Usage: ./init_pppoe_server.sh [start|stop|restart] [interface] [local_ip] [remote_ip_start] [remote_count] [dns1] [dns2]

ACTION=${1:-start}
IFACE=${2:-br0}
LOCAL_IP=${3:-10.10.10.1}
REMOTE_START=${4:-10.10.10.2}
REMOTE_COUNT=${5:-50} # Number of IPs to hand out
DNS1=${6:-8.8.8.8}
DNS2=${7:-8.8.4.4}
WAN_IFACE=${8:-eth0}
EXPIRED_POOL=${9:-172.15.10.0/24}

OPTIONS_FILE="/etc/ppp/pppoe-server-options"
PID_FILE="/var/run/pppoe-server.pid"

start_server() {
    echo "Starting PPPoE Server on $IFACE with WAN $WAN_IFACE (Expired Pool: $EXPIRED_POOL)..."

    # Ensure Kernel Modules
    modprobe pppoe
    modprobe pppox
    modprobe ppp_generic

    # Resolve script path for ip-up
    SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
    IP_UP_SCRIPT="$SCRIPT_DIR/pppoe_ip_up.sh"
    chmod +x "$IP_UP_SCRIPT"

    # Create Options File
    cat > $OPTIONS_FILE <<EOF
# PPPoE Server Options
# require-chap    <-- Removed to allow PAP/CHAP negotiation
# login           <-- Removed to avoid system user lookup
lcp-echo-interval 10
lcp-echo-failure 2
ms-dns $DNS1
ms-dns $DNS2
netmask 255.255.255.0
default-asyncmap
ip-up-script $IP_UP_SCRIPT
EOF

    # Ensure IP forwarding
    echo 1 > /proc/sys/net/ipv4/ip_forward

    # Stop existing if any
    killall pppoe-server > /dev/null 2>&1

    # Start Server
    # -I : Interface
    # -L : Local IP
    # -R : Remote IP Start
    # -N : Number of IPs
    # -O : Options file
    # -k : Use kernel-mode PPPoE (Important for performance and MAC_REMOTE variable)
    pppoe-server -k -I $IFACE -L $LOCAL_IP -R $REMOTE_START -N $REMOTE_COUNT -O $OPTIONS_FILE

    if [ $? -eq 0 ]; then
        echo "PPPoE Server started successfully."
        # Add firewall rule to allow forwarding from ppp+ interfaces
        iptables -I FORWARD -i ppp+ -j ACCEPT
        iptables -I FORWARD -o ppp+ -j ACCEPT
        iptables -t nat -A POSTROUTING -s ${LOCAL_IP%.*}.0/24 -o $WAN_IFACE -j MASQUERADE
        
        # --- Expired Pool (Non-Payment) Redirect Rules ---
        echo "Configuring Expired Pool Rules for $EXPIRED_POOL..."
        
        # Cleanup old rules first to prevent duplicates/conflicts
        # We ignore errors (|| true) in case rules don't exist
        iptables -t nat -D PREROUTING -s $EXPIRED_POOL -p tcp --dport 80 -j DNAT --to-destination ${EXPIRED_GW}:3000 2>/dev/null || true
        iptables -D FORWARD -s $EXPIRED_POOL -j REJECT --reject-with icmp-proto-unreachable 2>/dev/null || true
        iptables -D FORWARD -s $EXPIRED_POOL -p udp -j REJECT --reject-with icmp-port-unreachable 2>/dev/null || true
        iptables -D FORWARD -s $EXPIRED_POOL -p tcp -j REJECT --reject-with tcp-reset 2>/dev/null || true
        iptables -D FORWARD -s $EXPIRED_POOL -p udp --dport 53 -j ACCEPT 2>/dev/null || true
        iptables -D FORWARD -s $EXPIRED_POOL -p tcp --dport 53 -j ACCEPT 2>/dev/null || true
        iptables -D INPUT -s $EXPIRED_POOL -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
        iptables -D INPUT -s $EXPIRED_POOL -p udp --dport 53 -j ACCEPT 2>/dev/null || true
        
        # Ensure Interface has an IP in the Expired Subnet (Gateway)
        EXPIRED_NET=$(echo $EXPIRED_POOL | cut -d'/' -f1 | cut -d'.' -f1-3) # 172.15.10
        EXPIRED_GW="${EXPIRED_NET}.1"
        
        echo "Adding Expired Gateway IP $EXPIRED_GW to $IFACE..."
        ip addr add $EXPIRED_GW/24 dev $IFACE 2>/dev/null || true
        
        # 1. MASQUERADE Expired Pool (Crucial for DNS and external checks)
        # Without this, DNS queries to 8.8.8.8 will fail because the reply can't return.
        iptables -t nat -I POSTROUTING -s $EXPIRED_POOL -o $WAN_IFACE -j MASQUERADE

        # 2. ALLOW DNS (Critical for Captive Portal Detection)
        # Instead of forcing local DNS, we ALLOW access to the WAN DNS (e.g. 8.8.8.8)
        # This ensures the OS can resolve 'connectivitycheck.gstatic.com' etc.
        iptables -I FORWARD -s $EXPIRED_POOL -p udp --dport 53 -j ACCEPT
        iptables -I FORWARD -s $EXPIRED_POOL -p tcp --dport 53 -j ACCEPT
        
        # Also allow Input to Local DNS if they use it
        iptables -I INPUT -s $EXPIRED_POOL -p udp --dport 53 -j ACCEPT
        
        # 3. Redirect HTTP (80) to Portal (Port 3000)
        # Redirect to the Gateway IP on the expired subnet
        # We use -I to ensure this runs before any generic NAT rules
        iptables -t nat -I PREROUTING -s $EXPIRED_POOL -p tcp --dport 80 -j DNAT --to-destination ${EXPIRED_GW}:3000
        
        # 4. Allow access to Portal Port (3000)
        iptables -I INPUT -s $EXPIRED_POOL -p tcp --dport 3000 -j ACCEPT

        # 5. Reject everything else (The "Wall")
        # These must be inserted BEFORE the ACCEPT rules in the chain?
        # NO: -I inserts at TOP (Line 1).
        # So we must execute REJECTs FIRST, so they end up at the BOTTOM of the inserted block?
        # Wait:
        # Exec 1: REJECT (Pos 1)
        # Exec 2: ACCEPT DNS (Pos 1) -> REJECT moves to Pos 2.
        # This matches the script order below!
        
        # However, to be safe and clear, we used -I above for Accepts.
        # If we use -I now for Rejects, they will go to Pos 1, ABOVE the Accepts!
        # That would block DNS.
        # FIX: We should use -A (Append) for Rejects? 
        # No, -A appends to the END of the chain (after all other system rules).
        # We want these Rejects to be effective for this source, but after the Accepts.
        
        # Strategy: Insert REJECTs *first*, then Insert ACCEPTs.
        # Let's re-order the execution in this script.
        
        # -- RESET --
        # Delete the ACCEPTs we just added above to re-do the order correctly
        iptables -D FORWARD -s $EXPIRED_POOL -p udp --dport 53 -j ACCEPT 2>/dev/null || true
        iptables -D FORWARD -s $EXPIRED_POOL -p tcp --dport 53 -j ACCEPT 2>/dev/null || true
        
        # Step A: Insert REJECTS (They will end up at the bottom of our block)
        iptables -I FORWARD -s $EXPIRED_POOL -j REJECT --reject-with icmp-proto-unreachable
        iptables -I FORWARD -s $EXPIRED_POOL -p udp -j REJECT --reject-with icmp-port-unreachable
        iptables -I FORWARD -s $EXPIRED_POOL -p tcp -j REJECT --reject-with tcp-reset
        
        # Step B: Insert ACCEPTS (They will end up at the TOP, above Rejects)
        iptables -I FORWARD -s $EXPIRED_POOL -p udp --dport 53 -j ACCEPT
        iptables -I FORWARD -s $EXPIRED_POOL -p tcp --dport 53 -j ACCEPT
    else
        echo "Failed to start PPPoE Server."
        exit 1
    fi
}

stop_server() {
    echo "Stopping PPPoE Server..."
    killall pppoe-server > /dev/null 2>&1
    # Clean up firewall rules (simplistic, might need more specific cleanup)
    # iptables -D FORWARD -i ppp+ -j ACCEPT 2>/dev/null
    # iptables -D FORWARD -o ppp+ -j ACCEPT 2>/dev/null
}

case "$ACTION" in
    start)
        start_server
        ;;
    stop)
        stop_server
        ;;
    restart)
        stop_server
        sleep 2
        start_server
        ;;
    *)
        echo "Usage: $0 {start|stop|restart} ..."
        exit 1
esac
