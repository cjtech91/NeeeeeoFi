# 🚀 Piso Wifi Deployment Guide

This guide covers the complete setup and deployment process for your Ubuntu-based Piso Wifi system.

## 📋 System Requirements

### Hardware
- **Single Board Computer**: Orange Pi, Raspberry Pi, or any x86 Mini PC.
- **Network**: 
  - **Interface 1 (WAN)**: Internet Source (Ethernet `eth0` or WiFi Client).
  - **Interface 2 (Hotspot)**: Access Point for users (WiFi AP `wlan0` or USB LAN).

### Software (OS)
- **Operating System**: Ubuntu 20.04/22.04 LTS or Armbian.
- **User**: Root access is recommended for network management (`iptables`, `dnsmasq`).

---

## 🛠 Initial Server Setup (First Time Only)

Before deploying the code, ensure your Orange Pi/Server has the necessary system tools. Connect via SSH (MobaXterm) and run:

```bash
# 1. Update System
apt update && apt upgrade -y

# 2. Install System Utilities
apt install -y curl build-essential python3 iproute2 iptables dnsmasq git

# 3. Install ZeroTier (VPN)
# ZEROTIER ACTIVATION
curl -s https://install.zerotier.com | sudo bash

# 4. Install Node.js (v18+)
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# 5. Install PM2 (Process Manager)
npm install -g pm2
```

---

## 📦 Deployment Methods

### Method A: One-Click Deploy (Windows)
We have included a script `upload.bat` that automates packing, uploading, and restarting the server.

1.  **Open `upload.bat`** in a text editor to verify settings:
    ```bat
    set USER=root
    set 20.0.0.230=/root/linux_pisowifi
    ```
2.  **Run `upload.bat`** (Double-click).
3.  Enter your Orange Pi's **IP Address** when prompted.
4.  Enter your **SSH Password** (if not using keys).

*The script will automatically install dependencies and start the app using PM2.*

### Method B: Manual Deploy (MobaXterm)
If you prefer manual control:

1.  Open **MobaXterm** and SSH into your server.
2.  Navigate to `/root/` or your home directory.
3.  **Drag and drop** the `linux_pisowifi` folder from Windows to the MobaXterm file browser.
4.  Run the installation commands:

```bash
cd linux_pisowifi

# Install Dependencies
npm install

# Make scripts executable
chmod +x src/scripts/*.sh
```

---

## ⚙️ Configuration

### 1. Network Interface Setup
By default, the system assumes `wlan0` is your Hotspot interface. If you are using a different interface (e.g., `eth1` or `ra0`), edit `src/services/networkService.js`:

```javascript
// src/services/networkService.js
const HOTSPOT_INTERFACE = 'wlan0'; // Change this to your AP interface
const WAN_INTERFACE = 'eth0';      // Change this to your Internet source
```

### 2. Database
The system uses SQLite. The database file `database.sqlite` is automatically created in the project root on the first run.
- **Users Table**: Stores mac addresses, time remaining, etc.
- **Sales Table**: Tracks income.
- **Admin Table**: Stores admin credentials.

---

## 💾 Backing Up System (Flashable Image)

If you want to create a clone of your configured system that can be flashed to other SD cards using Balena Etcher, follow these steps.

**Requirement**: You need an **External USB Drive** configured with enough space to hold the image temporarily.

1.  **Mount your USB Drive** (e.g., to `/mnt/usb`).
2.  **Run the Backup Script**:
    ```bash
    cd /root/linux_pisowifi
    sudo bash src/scripts/create_backup_image.sh
    ```
3.  **Follow the Prompts**:
    - Select your source drive (usually `/dev/mmcblk0` or `/dev/sdX`).
    - Enter the destination path on your USB drive (e.g., `/mnt/usb/piso_backup.img`).

The script will:
1.  Create a raw copy of your SD card.
2.  Automatically use **PiShrink** to remove all empty space (reducing a 64GB card image to just ~2-3GB of actual data).
3.  Produce a `.img` file ready for Balena Etcher.

### Method 2: Network Backup (No USB Drive Required)

If you don't have a USB drive or it's not detected, you can stream the backup directly to your Windows PC over the network.

1.  **Open Command Prompt (cmd.exe)** on your Windows PC.
    *   **⚠️ IMPORTANT:** Do NOT use PowerShell. PowerShell corrupts binary files when using `>`. You MUST use standard Command Prompt.
2.  **Run these commands**:
    ```cmd
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@20.0.0.224 "dd if=/dev/mmcblk0 bs=1M status=progress | gzip -" > NeoFi_Zero3_Fixed.img.gz 
    ```
3.  **Enter your SSH password**.

**Why this is good:**
- **No USB needed**: Saves directly to your computer.
- **Small File Size**: The `gzip` command compresses the empty space, so a 16GB card with only 2GB of data will result in a ~1-2GB file.
- **Flash Ready**: Balena Etcher can flash `.img.gz` files directly!

---

## ▶️ Running the System (Production Mode)

For production (live deployment), we use **PM2** to manage the process, ensure it starts on boot, and handle automatic restarts.

### 🚀 Automatic Installation (Recommended)
We have provided a script that sets up everything for you (PM2, Startup Hooks, Production Environment).

Run this single command:
```bash
sudo bash src/scripts/install_service.sh
```

**What this script does:**
1.  Starts the app using `ecosystem.config.js` in **Production Mode**.
    *   *Note: In production, the app runs on Port 3000 to match firewall redirection rules.*
2.  Configures PM2 to auto-start on system boot (`pm2 startup`).
3.  Saves the current process list.

### 🛠 Manual Start (Advanced)
If you prefer to run it manually without the script:

```bash
# Start in Production Mode (Uses ecosystem.config.js)
pm2 start ecosystem.config.js --env production

# Save for Autostart
pm2 save
pm2 startup
```

### 📊 Manage the Service
Once running, use these standard PM2 commands:

```bash
# View Status
pm2 status

# View Real-time Logs (Essential for troubleshooting)
pm2 logs

# Restart the System
pm2 restart piso-wifi

# Stop the System
pm2 stop piso-wifi
```

---

## 🔍 Troubleshooting

### 1. Error: "Could not locate the bindings file" or "opening dependency file ... No such file"
This is a common build error on ARM devices (Orange Pi/Raspberry Pi) due to a race condition in the build system.

**Fix 1: Update Build Tools (Recommended)**
```bash
# Update the build tool globally to the latest version
npm install -g node-gyp

# Clean the project
rm -rf node_modules package-lock.json

# Reinstall (this often fixes the race condition)
npm install
```

**Fix 2: Force Single-Threaded Build**
If Fix 1 fails, try forcing a single-threaded build to avoid file conflicts:
```bash
npm install --jobs=1
```

### 2. Captive Portal Not Popping Up
- Ensure `dnsmasq` is running and configured to point DNS requests to the server IP.
- Check if clients are getting an IP address (DHCP).
- Verify `iptables` rules are applied:
  ```bash
  iptables -L -t nat
  ```

### 3. "Permission Denied" Errors
- The system interacts with kernel-level networking (`iptables`). **You must run the app as root** or with `sudo`.

### 4. Admin Login Failed
- Default credentials are set in the database initialization.
- You can manually reset the admin password by deleting `database.sqlite` (warning: this deletes all data) or using a SQLite browser to edit the `admins` table.

---

## 🌐 Accessing the System

- **Client Portal**: `http://10.0.0.1:3000/portal` (or your Hotspot Gateway IP)
- **Admin Panel**: `http://10.0.0.1:3000/admin`
