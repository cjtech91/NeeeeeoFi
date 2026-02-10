#!/bin/bash

# Configuration
WAN_IF="${1:-eth0}"
PORTAL_IP="${2:-10.0.0.1}"
BRIDGE_IF="br0"

echo "Initializing Network Bridge..."

# 0. Auto-Detect WAN Interface if passed interface (e.g. eth0) does not exist
# This prevents the script from bridging the ACTUAL WAN interface (e.g. enp3s0) and killing the connection
if ! ip link show "$WAN_IF" > /dev/null 2>&1; then
    echo "⚠️  WAN Interface '$WAN_IF' not found. Attempting auto-detection..."
    
    # Try 1: Find interface with default route
    DETECTED_WAN=$(ip route show default | awk '/default/ {print $5}' | head -n 1)
    
    # Try 2: Find any interface with an IP address (excluding lo, br0, wlan*, docker*)
    if [ -z "$DETECTED_WAN" ]; then
         DETECTED_WAN=$(ip -4 addr show | grep -vE 'lo|br0|wlan|docker' | grep -oP '(?<=inet\s)\d+(\.\d+){3}.*global' -B 2 | grep -oP '^\d+: \K[^:@]+' | head -n 1)
    fi

    if [ -n "$DETECTED_WAN" ]; then
        echo "✅ Detected active interface: $DETECTED_WAN. Using it as WAN."
        WAN_IF="$DETECTED_WAN"
    else
        echo "❌ Could not detect active WAN interface. Keeping default '$WAN_IF' (Dangerous if incorrect)."
    fi
fi

# 0. Preparation: Unblock WiFi
rfkill unblock wifi 2>/dev/null || true

# SAFETY CHECK: If wlan0 has an IP, it is likely the WAN/Upstream.
# Do NOT kill wpa_supplicant and do NOT add it to the bridge.
WLAN_IP=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}')
if [ -n "$WLAN_IP" ] && [ "$WAN_IF" != "wlan0" ]; then
    echo "⚠️  WARNING: wlan0 has an IP ($WLAN_IP) but WAN_IF is set to $WAN_IF."
    echo "   Assuming wlan0 is actually the WAN interface to prevent lockout."
    WAN_IF="wlan0"
fi

# Kill wpa_supplicant ONLY if WAN is not wireless
# If WAN is wlan0, we need wpa_supplicant to stay connected to upstream WiFi
if [[ "$WAN_IF" != wlan* ]] && [[ "$WAN_IF" != wlx* ]]; then
    echo "WAN is not wireless ($WAN_IF). Killing wpa_supplicant to free up WiFi for AP mode..."
    killall wpa_supplicant 2>/dev/null || true
else
    echo "WAN is wireless ($WAN_IF). Keeping wpa_supplicant alive."
fi

# Disable NetworkManager for WiFi and USB Ethernet interfaces if present
if command -v nmcli >/dev/null 2>&1; then
    # WiFi
    WIFI_IFS=$(ls /sys/class/net/wl* 2>/dev/null)
    for IF in $WIFI_IFS; do
        echo "Setting $IF as unmanaged by NetworkManager..."
        nmcli dev set $IF managed no 2>/dev/null || true
    done
    
    # USB Ethernet (enx*)
    USB_ETH_IFS=$(ls /sys/class/net/enx* 2>/dev/null)
    for IF in $USB_ETH_IFS; do
        echo "Setting $IF as unmanaged by NetworkManager..."
        nmcli dev set $IF managed no 2>/dev/null || true
    done
fi

# 1. Wait for WLAN interface (Optional - skip if not present)
echo "Checking for wireless interface..."
WIFI_IF=""
# Wait max 10s for USB WiFi to initialize (reduced from 45s)
for i in {1..10}; do
    # Check for wlan* OR wlx* (USB WiFi)
    if ls /sys/class/net/wlan* 1> /dev/null 2>&1; then
        WIFI_IF=$(ls /sys/class/net/wlan* | head -n 1)
        echo "Wireless interface found: $WIFI_IF"
        break
    elif ls /sys/class/net/wlx* 1> /dev/null 2>&1; then
        WIFI_IF=$(ls /sys/class/net/wlx* | head -n 1)
        echo "Wireless interface found: $WIFI_IF"
        break
    fi
    echo "Waiting for WiFi device... ($i/10)"
    sleep 1
done

if [ -z "$WIFI_IF" ]; then
    echo "⚠️ No wireless interface found. Skipping WiFi-specific setup."
    echo "Assuming Ethernet-only mode or external AP."
fi

# 1. Create Bridge if not exists
if ! ip link show "$BRIDGE_IF" > /dev/null 2>&1; then
    ip link add name "$BRIDGE_IF" type bridge || brctl addbr "$BRIDGE_IF"
    echo "Created bridge $BRIDGE_IF"
fi

# 1.1 Enable Spanning Tree Protocol (STP)
# Critical for avoiding loops when bridging multiple interfaces (wlan0 + eth1)
ip link set "$BRIDGE_IF" type bridge stp_state 1 2>/dev/null || brctl stp "$BRIDGE_IF" on
echo "Enabled STP on $BRIDGE_IF"

# 2. Detect LAN Interfaces (Exclude WAN, lo, and the bridge itself)
# Get all interfaces
ALL_IFS=$(ls /sys/class/net/)

for IF in $ALL_IFS; do
    # Skip Loopback, WAN, Bridge
    if [ "$IF" == "lo" ] || [ "$IF" == "$WAN_IF" ] || [ "$IF" == "$BRIDGE_IF" ]; then
        continue
    fi

    # Skip Wireless Interfaces (Hostapd will handle them, and Station mode cannot be bridged easily)
    if [[ "$IF" == wlan* ]] || [[ "$IF" == wlx* ]]; then
        echo "Skipping wireless interface $IF (reserved for Hostapd)"
        continue
    fi

    # Filter for Physical Interfaces only to avoid bridging Docker/Virtual adapters
    # Allow: eth* (Ethernet), enx* (USB Ethernet), usb* (USB Ethernet legacy)
    #        enp* (PCIe Ethernet - Common on Ubuntu/PCs), eno* (Onboard Ethernet)
    if [[ "$IF" != eth* ]] && [[ "$IF" != enx* ]] && [[ "$IF" != usb* ]] && [[ "$IF" != enp* ]] && [[ "$IF" != eno* ]]; then
        echo "Skipping likely virtual interface: $IF"
        continue
    fi

    echo "Adding $IF to bridge..."
    
    # Robust Interface Addition (Down -> Master -> Up)
    # Ensure interface is clean before adding
    ip link set $IF down
    ip addr flush dev $IF
    
    # Force unmanage if nmcli exists
    if command -v nmcli >/dev/null 2>&1; then
        nmcli dev set $IF managed no 2>/dev/null || true
    fi

    # Add to bridge (try ip link, fallback to brctl)
    if ! ip link set $IF master $BRIDGE_IF 2>/dev/null; then
        brctl addif $BRIDGE_IF $IF 2>/dev/null
    fi
    
    # Bring up
    ip link set $IF up promisc on
done

# Wait for interfaces to settle
sleep 2

# 3. Configure Bridge IP
ip addr flush dev $BRIDGE_IF
ip addr add $PORTAL_IP/24 dev $BRIDGE_IF
ip link set $BRIDGE_IF up
sleep 2

# 4. Enable IP Forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward

echo "Network Bridge $BRIDGE_IF configured with IP $PORTAL_IP"

# 5. Ensure Hostapd is running (if installed)
# Restarting hostapd ensures it binds correctly to the bridge/interface
if systemctl list-unit-files | grep -q hostapd; then
    echo "Restarting Hostapd..."
    systemctl restart hostapd || true
    sleep 5
    if ! systemctl is-active --quiet hostapd; then
        echo "Hostapd failed to start. Retrying..."
        systemctl restart hostapd || true
    fi
fi
