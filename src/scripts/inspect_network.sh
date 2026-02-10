#!/bin/bash

echo "========================================================"
echo "          PisoWifi Network Inspector"
echo "========================================================"
echo ""

echo "--- 1. Bridges ---"
if command -v brctl >/dev/null 2>&1; then
    brctl show
else
    # Fallback for systems without brctl
    for br in $(ip link show type bridge | awk -F: '{print $2}'); do
        echo "Bridge: $br"
        ip link show master $br
    done
fi
echo ""

echo "--- 2. VLANs ---"
# Show details (-d) of vlan type links
ip -d link show type vlan
echo ""

echo "--- 3. Wireless Interfaces ---"
if command -v iw >/dev/null 2>&1; then
    iw dev
else
    echo "iw command not found, listing wlan interfaces via ip link:"
    ip link show | grep wlan
fi
echo ""

echo "--- 4. All Interfaces & IPs ---"
ip -4 addr show
echo ""

echo "--- 5. Routing Table ---"
ip route show
echo ""

echo "========================================================"
