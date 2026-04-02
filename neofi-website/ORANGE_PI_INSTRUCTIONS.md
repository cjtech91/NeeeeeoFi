# Orange Pi Specific Instructions

Orange Pi devices (and Armbian OS) often manage networks differently than Raspberry Pi OS.

## 1. Interface Names
Orange Pi might not use `wlan0` or `eth0`.
- Check interfaces: `ip addr`
- Adjust `setup_neofi_complete.sh` to match your interface names (e.g., `wlx...`, `enx...`).

## 2. Network Manager (nmcli)
Armbian heavily relies on NetworkManager. Our script attempts to disable it for the hotspot interface, but on Orange Pi, you might need to use `nmcli` to explicitly ignore the device.

```bash
nmcli dev set wlan0 managed no
```

## 3. GPIO & Hardware
If your PisoWifi uses GPIO for coin acceptors:
- Orange Pi GPIO pinout differs from Raspberry Pi.
- You may need `WiringOP` library instead of `rpi-gpio`.
- Check `src/services/gpioService.js` (if exists) and adapt pin numbers.

## 4. Installation Tweaks
If `setup_neofi_complete.sh` fails on Orange Pi:
1. **Manually Install Deps:**
   ```bash
   sudo apt update
   sudo apt install hostapd dnsmasq nodejs npm
   ```
2. **Configure AP Manually:**
   Use `armbian-config` tool -> Network -> Hotspot (if available) as an easier alternative, then point the captive portal DNS to it.

## 5. Serial/UART Access
Orange Pi usually supports Serial Console (UART) for debugging if SSH fails.
- Connect USB-to-TTL adapter to UART pins (GND, TX, RX).
- Baud rate: 115200.
