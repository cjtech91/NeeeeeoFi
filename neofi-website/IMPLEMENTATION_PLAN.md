# NeoFi PisoWifi - Implementation Plan

## 1. Hardware Requirements
- **Raspberry Pi** (3B, 3B+, 4, or 5) OR **Orange Pi** (Zero 2, 3 LTS, etc.)
- **MicroSD Card** (16GB+ recommended)
- **Ethernet Cable** (for internet source)
- **Power Supply** (5V, 2.5A+ recommended)

## 2. Operating System Setup
- Recommended: **Ubuntu Server 22.04 LTS** or **Raspberry Pi OS Lite (64-bit)**
- For Orange Pi: **Armbian** or **Ubuntu Server** provided by vendor.

### Initial Setup
1. Flash OS to SD Card.
2. Boot device.
3. Login (default creds usually `ubuntu`/`ubuntu` or `root`/`1234`).
4. **Crucial:** Ensure SSH is enabled and you have internet access.

## 3. Installation Steps
1. **Clone/Copy Project Files:**
   Use the provided `upload.bat` (Windows) or `scp` to transfer files to the device.
   ```bash
   upload.bat
   ```

2. **Run Installer:**
   SSH into the device and run the setup script. This script will now automatically:
   - Install all system dependencies (Node.js, PM2, etc.)
   - Configure the WiFi Access Point (SSID: NeoFi_PisoWifi)
   - Setup the Captive Portal service to start on boot
   - Configure the firewall and DNS
   
   ```bash
   cd ~/neofi_pisowifi
   chmod +x setup_neofi_complete.sh
   sudo ./setup_neofi_complete.sh
   ```

3. **Verify Hotspot:**
   - SSID: `NeoFi_PisoWifi`
   - IP: `10.0.0.1`
   - Connect with a phone and check if Captive Portal loads.

## 4. Maintenance & Troubleshooting
- **Restart Services:**
  ```bash
  sudo systemctl restart hostapd dnsmasq
  ```
- **Check Logs:**
  ```bash
  journalctl -u hostapd -f
  journalctl -u neofi-portal -f
  ```
- **Reset Network:**
  If you lose access, connect Monitor+Keyboard and run:
  ```bash
  sudo iptables -F
  sudo systemctl restart ssh
  ```

## 5. Deployment Checklist
- [ ] OS Installed & Updated
- [ ] Dependencies Installed (Node.js, hostapd, dnsmasq)
- [ ] Static IP (10.0.0.1) Configured on wlan0
- [ ] DHCP Server (dnsmasq) Running
- [ ] Captive Portal Service Running
- [ ] Firewall/NAT Rules Applied
- [ ] System Reboots Successfully with Auto-Start
