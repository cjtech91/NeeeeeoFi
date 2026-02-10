#!/bin/bash

# Piso Wifi Installation Script
# Run this on the Orange Pi / Server

echo "🚀 Starting Piso Wifi Installation..."

# 1. Update System
echo "📦 Updating System Repositories..."
apt-get update

# 2. Install System Dependencies (Build tools for better-sqlite3, Network tools)
echo "🛠 Installing System Utilities..."
apt-get install -y curl build-essential python3 iproute2 iptables dnsmasq git ppp pppoe bridge-utils hostapd iw net-tools pciutils usbutils

# 3. Install Node.js (v18)
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "🟢 Installing Node.js v18 & npm..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    
    # Fallback: If npm is still missing (unlikely with nodesource, but possible on some images)
    if ! command -v npm &> /dev/null; then
        echo "⚠️ npm still missing. Attempting explicit install..."
        apt-get install -y npm
    fi
    # Refresh shell hash to find new commands
    hash -r
else
    echo "✅ Node.js is already installed: $(node -v)"
    # Verify npm works
    if ! command -v npm &> /dev/null; then
        echo "⚠️ Node exists but npm is missing. Fixing..."
        apt-get install -y npm
    else
        echo "✅ npm is already installed: $(npm -v)"
    fi
fi

# 4. Install PM2 (Process Manager)
if ! command -v pm2 &> /dev/null; then
    echo "🔄 Installing PM2..."
    npm install -g pm2
else
    echo "✅ PM2 is already installed."
fi

# 5. Install Project Dependencies
echo "📚 Installing Project Dependencies..."
# Ensure we are in the project directory
cd "$(dirname "$0")"

# 5.1 Enable Hostapd (WiFi Access Point)
echo "🌍 Setting Timezone to Asia/Manila..."
timedatectl set-timezone Asia/Manila || true

echo "📡 Enabling WiFi Access Point (hostapd)..."
systemctl unmask hostapd 2>/dev/null || true
systemctl enable hostapd 2>/dev/null || true

# 5.2 Create Default hostapd config if missing
if [ ! -f "/etc/hostapd/hostapd.conf" ]; then
    echo "📝 Creating default hostapd configuration..."
    mkdir -p /etc/hostapd
    cat > /etc/hostapd/hostapd.conf <<EOF
interface=wlan0
bridge=br0
driver=nl80211
ssid=NeoFi_Built-In_WiFi
hw_mode=g
channel=6
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=password123
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP
EOF
    # Update /etc/default/hostapd
    if [ -f "/etc/default/hostapd" ]; then
        sed -i 's|#DAEMON_CONF=""|DAEMON_CONF="/etc/hostapd/hostapd.conf"|g' /etc/default/hostapd
        sed -i 's|DAEMON_CONF=""|DAEMON_CONF="/etc/hostapd/hostapd.conf"|g' /etc/default/hostapd
    fi
fi

# Remove existing node_modules to ensure clean install if needed (optional)
# rm -rf node_modules

# Install dependencies (with build flags for sqlite)
npm install --build-from-source

# 6. Setup Permissions
echo "🔐 Setting Script Permissions..."
chmod +x src/scripts/*.sh

echo "🚀 Starting Server..."
# Stop existing processes
pm2 delete all 2>/dev/null || true
# Start with PM2
pm2 start ecosystem.config.js
# Save list
pm2 save
# Setup startup (this tries to auto-detect and run)
pm2 startup | bash 2>/dev/null || echo "⚠️  Could not auto-setup startup. Run 'pm2 startup' manually if needed."

echo "✨ Installation Complete!"
echo "Server is running on port 3000 (managed by PM2)"
pm2 list
