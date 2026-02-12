# ESP8266 Sub Vendo Firmware

This firmware allows an ESP8266 to function as a Sub Vendo device for the NeoFi system.

## Features
- **WiFi Management**: Connects to the main NeoFi network.
- **Coin Acceptor Interface**: Handles coin pulses via interrupt.
- **Relay Control**: Activates the vending machine relay.
- **Web Interface**: Captive portal for initial configuration.
- **Admin Integration**: Managed via the NeoFi Admin Panel.

## Hardware Requirements
- ESP8266 Development Board (e.g., NodeMCU, Wemos D1 Mini)
- Coin Acceptor (configured for pulse output)
- Relay Module (active high/low configurable)
- Power Supply (5V/12V depending on setup)

## Pin Configuration (Default)
- **Coin Signal Pin**: GPIO 12 (D6) - Input, Pull-up
- **Relay Control Pin**: GPIO 14 (D5) - Output
- **Standby LED**: GPIO 2 (D4) - Built-in LED (Active Low) / Factory Reset (Ground to Reset)
- **Insert LED**: GPIO 0 (D3) - Output (Active Low)

*Note: Pins are configurable via the Admin Panel after initial setup. Ensure GPIO 0 is not pulled LOW during boot.*

## Installation
1. **Install Arduino IDE**: Download and install the latest Arduino IDE.
2. **Install ESP8266 Board Support**:
   - Open Arduino IDE > File > Preferences.
   - Add `http://arduino.esp8266.com/stable/package_esp8266com_index.json` to "Additional Boards Manager URLs".
   - Go to Tools > Board > Boards Manager, search for "esp8266", and install "esp8266 by ESP8266 Community".
3. **Select Board**: Tools > Board > ESP8266 Boards > Generic ESP8266 Module (or your specific board like NodeMCU 1.0).
4. **Open Firmware**: Open `esp8266_subvendo.ino` in Arduino IDE.
5. **Compile & Upload**: Connect your ESP8266 via USB and click the Upload button.

## Setup
1. Power on the ESP8266.
2. Connect to the WiFi network named `SubVendo_Setup_XXXXXX`.
3. A configuration portal should open automatically (or visit `192.168.4.1`).
4. Enter the **Sub Vendo Key** (found in NeoFi Admin Panel > Sub Vendo).
5. Configure WiFi credentials for the main network.
6. Save and Reboot.
7. The device should appear in the NeoFi Admin Panel "Waiting List" for approval.
