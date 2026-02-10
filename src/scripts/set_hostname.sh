#!/bin/bash

# Script to set system hostname
# Usage: ./set_hostname.sh [new_hostname]
# Run as root

NEW_HOSTNAME=${1:-"NeoFI"}
CURRENT_HOSTNAME=$(hostname)

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

if [[ ! "$NEW_HOSTNAME" =~ ^[a-zA-Z0-9-]+$ ]]; then
    echo "Error: Hostname can only contain alphanumeric characters and hyphens."
    exit 1
fi

if [ "$CURRENT_HOSTNAME" == "$NEW_HOSTNAME" ]; then
    echo "Hostname is already set to $NEW_HOSTNAME."
    exit 0
fi

echo "Changing hostname from $CURRENT_HOSTNAME to $NEW_HOSTNAME..."

# 1. Set via hostnamectl (Systemd) if available
if command -v hostnamectl &> /dev/null; then
    hostnamectl set-hostname "$NEW_HOSTNAME"
    echo "Set via hostnamectl."
else
    hostname "$NEW_HOSTNAME"
    echo "Set via hostname command."
fi

# 2. Update /etc/hostname
echo "$NEW_HOSTNAME" > /etc/hostname
echo "Updated /etc/hostname."

# 3. Update /etc/hosts
# Replace the line containing the old hostname with the new one
if [ -n "$CURRENT_HOSTNAME" ] && grep -q "$CURRENT_HOSTNAME" /etc/hosts; then
    sed -i "s/$CURRENT_HOSTNAME/$NEW_HOSTNAME/g" /etc/hosts
    echo "Updated /etc/hosts (replaced old hostname)."
else
    # If old hostname not found or empty, ensure 127.0.1.1 maps to new hostname
    if grep -q "127.0.1.1" /etc/hosts; then
        sed -i "s/^127.0.1.1.*/127.0.1.1\t$NEW_HOSTNAME/g" /etc/hosts
        echo "Updated /etc/hosts (modified 127.0.1.1 entry)."
    else
        echo -e "127.0.1.1\t$NEW_HOSTNAME" >> /etc/hosts
        echo "Updated /etc/hosts (added 127.0.1.1 entry)."
    fi
fi

# 4. Restart Networking (Optional/Safe attempt)
# This helps propagate the name to DHCP clients without full reboot in some cases
if command -v systemctl &> /dev/null; then
    systemctl restart systemd-hostnamed || true
fi

echo "✅ Hostname updated successfully to '$NEW_HOSTNAME'."
echo "Note: The new hostname will be fully reflected in Mikrotik DHCP leases after a reboot or lease renewal."
